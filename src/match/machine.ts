/**
 * The match reducer (architecture.md section E): reduce(state, event, deps) returns a new frozen
 * MatchState and never mutates its input. Physics bodies are mutated in the tick loop; this
 * ledger is rebuilt at phase boundaries from the events the loop and the sim send.
 *
 * Phase flow: TurnStart (banner) -> HotSeat (human keyboard swap only) -> Active (45 s) ->
 * Firing -> Active again while shots remain, else Retreat -> Resolving (rest or a cap) ->
 * TurnEnd (deaths, points, crate roll) -> SuddenDeathCheck -> TurnStart, or MatchEnd when at
 * most one team is left. A timed out, skipped or forfeited turn goes straight to Resolving.
 *
 * Deaths: a worm at 0 hp is queued and dies at TurnEnd (Worms rule), drowning kills at once,
 * surrender kills the whole team at once. The active worm dying or drowning forfeits the turn.
 * MatchEnd ignores every event.
 */

import { getWeapon, isSuper } from '../weapons/registry.ts';
import { healthCrateAmount, rollCrateWeapon, rollPower } from './crates.ts';
import { takeFrozenTurn } from './freeze.ts';
import type { MatchDeps } from './deps.ts';
import type {
  CratePickedEvent,
  DamageAppliedEvent,
  FireCompletedEvent,
  FireStartedEvent,
  MatchEvent,
  SkipTurnEvent,
  SurrenderEvent,
  WormSealedEvent,
  WormSpawnedEvent,
} from './events.ts';
import { deepFreeze } from './immutable.ts';
import {
  activeTeamOf,
  activeWormOf,
  appendLog,
  findTeamIndex,
  findWorm,
  isActiveWorm,
  replaceTeam,
  replaceWorm,
  resetInactivity,
  updateTeam,
} from './ledger.ts';
import {
  applyDeath,
  enterActive,
  enterHotSeat,
  enterMatchEnd,
  enterResolving,
  enterRetreat,
  enterSuddenDeathCheck,
  enterTurnStart,
  killCreditFor,
  leaveTurn,
  settleResolving,
  transition,
} from './machine-phases.ts';
import { isPreResolvePhase } from './phases.ts';
import { retreatMsFor } from './retreat.ts';
import { applyRoomExchange, coveragePctFromAngle } from './room.ts';
import { addSeal, takeSealedTurn } from './seals.ts';
import { restAfterSuper, superResting } from './super-rest.ts';
import { scoreDamage, scoreShotClosed, scoreShotFired } from './scoring.ts';
import { saibamanAmmoTable } from './setup.ts';
import { makeWindState, type DeathCause, type MatchState } from './state.ts';
import type { TeamState, WormState } from './state.ts';
import { hotSeatMsFor } from './turn.ts';
import { isTeamAlive, matchDecided } from './win.ts';

export { enterTurnStart } from './machine-phases.ts';

export function reduce(state: MatchState, event: MatchEvent, deps: MatchDeps): MatchState {
  if (state.phase === 'MatchEnd') return state;
  return deepFreeze(dispatch(state, event, deps));
}

function dispatch(state: MatchState, event: MatchEvent, deps: MatchDeps): MatchState {
  switch (event.type) {
    case 'TimerTick':
      return onTimerTick(state, event, deps);
    case 'BannerDone':
      return onBannerDone(state, deps);
    case 'FireStarted':
      return onFireStarted(state, event);
    case 'FireCompleted':
      return onFireCompleted(state, event, deps);
    case 'RetreatDone':
      return state.phase === 'Retreat' ? enterResolving(state) : state;
    case 'ActivityPing':
      return resetInactivity(state);
    case 'DamageApplied':
      return onDamageApplied(state, event);
    case 'WormDied':
      return onWormDied(state, event.wormId);
    case 'WormDrowned':
      return onWormDrowned(state, event.wormId);
    case 'WormSpawned':
      return onWormSpawned(state, event, deps);
    case 'WormSealed':
      return onWormSealed(state, event);
    case 'AllBodiesAtRest':
      return state.phase === 'Resolving' ? settleResolving(state, 'rest', deps) : state;
    case 'CrateLanded':
      return onCrateLanded(state);
    case 'CratePicked':
      return onCratePicked(state, event, deps);
    case 'CrateDestroyed':
      return onCrateDestroyed(state, event.wasCounted ?? true);
    case 'SkipTurn':
      return onSkipTurn(state, event);
    case 'Surrender':
      return onSurrender(state, event);
    case 'WindRolled':
      return { ...state, wind: makeWindState(event.step) };
    case 'FreezeApplied':
      return onFreezeApplied(state, event.casterId, event.turns);
    case 'ShieldApplied':
      return onShieldApplied(state, event.casterId, event.durability, event.ownTurns);
    case 'RoomCast':
      return Number.isFinite(event.angleDeg) ? applyRoomExchange(state, event.casterId, coveragePctFromAngle(event.angleDeg)) : state;
  }
}

/** time_stop: every living worm but the caster owes the ledger one skipped own turn (match/turn.ts). */
function onFreezeApplied(state: MatchState, casterId: string, turns: number): MatchState {
  if (!Number.isInteger(turns) || turns <= 0) return state;
  const source = findWorm(state, casterId);
  if (source === null || !source.worm.alive || source.worm.hp <= 0) return state;
  let next = state;
  for (const team of state.teams) {
    for (const worm of team.worms) {
      if (!worm.alive || worm.id === casterId) continue;
      const ref = findWorm(next, worm.id);
      if (ref === null) continue;
      next = replaceWorm(next, ref.teamIndex, ref.wormIndex, { ...ref.worm, frozenTurns: ref.worm.frozenTurns + turns });
    }
  }
  const caster = findWorm(next, casterId);
  return appendLog(resetInactivity(next), 'freeze.applied', `${caster?.worm.name ?? casterId} stops the world`);
}

/** force_field: the caster gets a damage buffer that clears after its own next turn. */
function onShieldApplied(state: MatchState, casterId: string, durability: number, ownTurns: number): MatchState {
  const ref = findWorm(state, casterId);
  if (ref === null || !ref.worm.alive || !Number.isFinite(durability) || durability <= 0 || !Number.isInteger(ownTurns) || ownTurns < 0) return state;
  const next = replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, shieldDurability: durability, shieldExpiresAtOwnTurn: ref.worm.turns + Math.max(0, ownTurns) });
  return appendLog(resetInactivity(next), 'shield.applied', `${ref.worm.name} raises a force field`);
}

function onBannerDone(state: MatchState, deps: MatchDeps): MatchState {
  switch (state.phase) {
    case 'TurnStart': {
      // A team with a worm sealed by the Tesoro del Cielo loses the turn to the treasure's strike.
      const { pruned, taken } = takeSealedTurn(state);
      if (taken !== null) return leaveTurn(taken, 'turn.sealed', `${activeTeamOf(taken)?.name ?? '?'} loses the turn to the Tesoro del Cielo`);
      // A worm time_stop still holds loses its turn outright: no banner, straight to Resolving.
      const frozen = takeFrozenTurn(pruned);
      if (frozen.taken !== null) return enterResolving(frozen.taken);
      const ms = hotSeatMsFor(pruned.teams, pruned.activeTeamIndex, deps.config);
      return ms > 0 ? enterHotSeat(pruned, ms) : enterActive(pruned, deps.config, true);
    }
    case 'TurnEnd':
      return matchDecided(state) ? enterMatchEnd(state) : enterSuddenDeathCheck(state, deps.config);
    case 'SuddenDeathCheck':
      return enterTurnStart(state, deps);
    default:
      return state;
  }
}

function onFireStarted(state: MatchState, event: FireStartedEvent): MatchState {
  if (state.phase !== 'Active') return state;
  const team = activeTeamOf(state);
  if (team === undefined) return state;
  const worm = activeWormOf(state);
  if (worm === undefined) return state;
  const ammo = worm.ammo[event.weaponId];
  // The scheme delay is the worm's own: it counts the turns this worm has had, not the match's.
  if (ammo !== undefined && worm.turns < (getWeapon(event.weaponId).delayTurns ?? 0)) return appendLog(state, 'fire.rejected', `${event.weaponId} is not unlocked yet for ${worm.name}`);
  if (ammo === undefined) return appendLog(state, 'fire.rejected', `Unknown weapon ${event.weaponId}`);
  // One super a turn, and none on the worm's next: the worm rests its supers (match/super-rest.ts).
  const superShot = isSuper(getWeapon(event.weaponId));
  if (superShot && superResting(worm)) return appendLog(state, 'fire.rejected', `${worm.name} rests its supers this turn`);
  if (!Number.isInteger(event.shotsRemaining) || event.shotsRemaining < 0) {
    return appendLog(state, 'fire.rejected', 'shotsRemaining must be a non negative integer');
  }
  const previous = state.shot;
  if (previous !== null && previous.shotsRemaining > 0 && previous.weaponId !== event.weaponId) {
    return appendLog(state, 'fire.rejected', `Weapon locked to ${previous.weaponId} until its shots are spent`);
  }
  const firstShot = previous === null || previous.shotsRemaining === 0;
  if (firstShot && ammo === 0) return appendLog(state, 'fire.rejected', `No ${event.weaponId} ammo left`);
  const scored = updateTeam(state, state.activeTeamIndex, (current) => ({
    ...current,
    worms: current.worms.map((w) => {
      if (w.id !== worm.id) return w;
      const spent = firstShot && ammo > 0 ? { ...w, ammo: { ...w.ammo, [event.weaponId]: ammo - 1 } } : w;
      return superShot ? restAfterSuper(spent) : spent;
    }),
    score: scoreShotFired(previous === null ? current.score : scoreShotClosed(current.score, previous.damage)),
  }));
  const next: MatchState = {
    ...scored,
    // A fresh identity for this one shot: every barrel of a multi shot weapon gets its own, so only
    // the pellets or hits inside ONE of them share a shield break or an immortality charge.
    attackSeq: scored.attackSeq + 1,
    shot: { weaponId: event.weaponId, shotsRemaining: event.shotsRemaining, damage: 0 },
  };
  const fired = appendLog(transition(next, 'Firing'), 'fire', `${team.name} fires ${event.weaponId}`);
  return superShot ? appendLog(fired, 'super.rest', `${worm.name} rests its supers next turn`) : fired;
}

function onFireCompleted(state: MatchState, event: FireCompletedEvent, deps: MatchDeps): MatchState {
  if (state.phase !== 'Firing' || state.shot === null) return state;
  // A worm that paid for its super with its last health gets no retreat: the move was its last.
  const active = activeWormOf(state);
  if (active !== undefined && active.hp <= 0) return leaveTurn(state, 'turn.forfeit', `${active.name} gave its last health for ${state.shot.weaponId}`);
  // Another barrel owed, or a utility that keeps the turn (jetpack, parachute, girder): back to
  // Active on the same clock. Every shot used to fall through to the retreat, so opening a
  // parachute ended the turn.
  if (state.shot.shotsRemaining > 0 || event.keepsTurn === true) return enterActive(state, deps.config, false);
  const ms = retreatMsFor(state.shot.weaponId, deps.config, event.airborne === true);
  if (ms <= 0) return leaveTurn(state, 'retreat', `${state.shot.weaponId} ends the turn at once`);
  return appendLog(enterRetreat(state, ms), 'retreat', `Retreat ${ms} ms`);
}

/**
 * The sim's own one hit kill magic number (sim/techniques/common.ts KILL_DAMAGE, sim/devour.ts
 * SWALLOW_DAMAGE, sim/hex.ts BURST_DAMAGE): a request of this size or more is an execute
 * (Antares, Gear 5, the Freezer, the Galaxian Explosion, the Explosión Final, adamantium_claws),
 * which a force field blocks outright instead of merely absorbing by the numbers.
 */
const EXECUTE_DAMAGE = 1_000_000;

/** Lethal attacks the unique immortality pickup survives, each at 1 hp, before the next one kills outright. */
const IMMORTALITY_CHARGES = 3;

/**
 * Which attack a worm's shield or immortality last answered, so a multi pellet shotgun blast or a
 * hitscan burst only ever costs one shield break or one immortality charge: stable for as long as
 * the same shot stays open (match/state.ts ShotState), then changes with the next one.
 */
function attackKey(state: MatchState): string | null {
  // Outside an open shot each environmental impact is a separate attack, not the last fired shot.
  return state.shot === null ? null : String(state.attackSeq);
}

/**
 * force_field: an execute is blocked outright and the shield breaks with it; ordinary damage is a
 * numeric buffer, absorbed up to whatever durability is left. No shield, no change.
 */
function shieldMitigate(worm: WormState, requested: number): { readonly damage: number; readonly shieldDurability: number } {
  if (worm.shieldDurability <= 0) return { damage: requested, shieldDurability: 0 };
  if (requested >= EXECUTE_DAMAGE) return { damage: 0, shieldDurability: 0 };
  const absorbed = Math.min(requested, worm.shieldDurability);
  return { damage: requested - absorbed, shieldDurability: worm.shieldDurability - absorbed };
}

function onDamageApplied(state: MatchState, event: DamageAppliedEvent): MatchState {
  if (!Number.isFinite(event.amount) || event.amount <= 0) return state;
  const ref = findWorm(state, event.wormId);
  if (ref === null || !ref.worm.alive) return state;
  // A toll by share (Antares) is that share of what the worm has, rounded up.
  const share = event.tollShare;
  const requested = share !== undefined && Number.isFinite(share) && share > 0 ? Math.min(event.amount, Math.ceil(ref.worm.hp * Math.min(1, share))) : event.amount;
  // A worm's own toll, and drowning (its own event entirely), never look at its shield or its
  // immortality: the price of a super, like the water, is paid in full.
  const protect = event.toll !== true;
  const mitigated = protect ? shieldMitigate(ref.worm, requested) : { damage: requested, shieldDurability: ref.worm.shieldDurability };
  const effective = Math.min(mitigated.damage, ref.worm.hp);
  const shieldChanged = mitigated.shieldDurability !== ref.worm.shieldDurability;
  if (effective <= 0) {
    if (!shieldChanged) return resetInactivity(state);
    const absorbed = replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, shieldDurability: mitigated.shieldDurability });
    return appendLog(resetInactivity(absorbed), 'damage', `${ref.worm.name}'s force field takes the blow`);
  }
  const wouldDie = effective >= ref.worm.hp;
  const key = attackKey(state);
  // Already spared once this very attack (a second pellet of the same burst), or a fresh charge to spend.
  const alreadyProtected = key !== null && ref.worm.lastProtectedAttack === key;
  const saving = protect && wouldDie && (alreadyProtected || ref.worm.immortalityCharges > 0);
  const hp = saving ? 1 : ref.worm.hp - effective;
  const dealt = ref.worm.hp - hp;
  const immortalityCharges = saving && !alreadyProtected ? ref.worm.immortalityCharges - 1 : ref.worm.immortalityCharges;
  const lastProtectedAttack = saving ? key : ref.worm.lastProtectedAttack;
  let next = replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, hp, shieldDurability: mitigated.shieldDurability, immortalityCharges, lastProtectedAttack });
  if (event.sourceTeamId !== null) next = bookDamage(next, event.sourceTeamId, ref.team.id, event.wormId, dealt);
  const text = event.toll === true ? `${ref.worm.name} pays ${dealt} for its super` : saving ? `${ref.worm.name} cheats death at 1 hp` : `${ref.worm.name} takes ${dealt}`;
  next = appendLog(resetInactivity(next), 'damage', text);
  if (saving || hp > 0) return next;
  const queued = queueDeath(next, event.wormId, 'killed');
  // Its last health went on the price of the super it is firing: it finishes the move, and the turn
  // ends when the shot closes (onFireCompleted), not under the move.
  if (event.toll === true) return queued;
  return forfeitIfActive(queued, event.wormId, `${ref.worm.name} is at 0 hp`);
}

/** Points for the source team, the last hit ledger and the open shot window of the active team. */
function bookDamage(
  state: MatchState,
  sourceTeamId: string,
  victimTeamId: string,
  wormId: string,
  effective: number,
): MatchState {
  const toEnemy = sourceTeamId !== victimTeamId;
  const sourceIndex = findTeamIndex(state, sourceTeamId);
  const scored = updateTeam(state, sourceIndex, (team) => ({
    ...team,
    score: scoreDamage(team.score, effective, toEnemy),
  }));
  const withHit: MatchState = { ...scored, lastHitBy: { ...scored.lastHitBy, [wormId]: sourceTeamId } };
  const active = activeTeamOf(withHit);
  if (!toEnemy || withHit.shot === null || active === undefined || active.id !== sourceTeamId) return withHit;
  return { ...withHit, shot: { ...withHit.shot, damage: withHit.shot.damage + effective } };
}

function queueDeath(state: MatchState, wormId: string, cause: DeathCause): MatchState {
  const ref = findWorm(state, wormId);
  if (ref === null || !ref.worm.alive) return state;
  if (state.pendingDeaths.some((death) => death.wormId === wormId)) return state;
  const zeroed = ref.worm.hp === 0 ? state : replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, hp: 0 });
  const death = { wormId, cause, creditTeamId: killCreditFor(state, wormId, ref.team.id) };
  const queued: MatchState = { ...zeroed, pendingDeaths: [...zeroed.pendingDeaths, death] };
  return appendLog(resetInactivity(queued), 'death.queued', `${ref.worm.name} is done for`);
}

/** The active worm losing its life mid turn ends the turn; the bodies still settle in Resolving. */
function forfeitIfActive(state: MatchState, wormId: string, text: string): MatchState {
  return isActiveWorm(state, wormId) && isPreResolvePhase(state.phase) ? leaveTurn(state, 'turn.forfeit', text) : state;
}

function onWormDied(state: MatchState, wormId: string): MatchState {
  const queued = queueDeath(state, wormId, 'killed');
  return queued === state ? state : forfeitIfActive(queued, wormId, 'active worm died');
}

function onWormDrowned(state: MatchState, wormId: string): MatchState {
  const ref = findWorm(state, wormId);
  if (ref === null || !ref.worm.alive) return state;
  const death = { wormId, cause: 'drowned' as const, creditTeamId: killCreditFor(state, wormId, ref.team.id) };
  return forfeitIfActive(applyDeath(state, death), wormId, 'active worm drowned');
}

/**
 * A Saibaman came out of the ground: it joins its team at the end of the roster, so the team's
 * rotation reaches it after the worms already there, with its share of a worm's health, a name of
 * its own and the Saibaman loadout (the unlimited weapons). A second report of the same worm, or
 * one for a team that is not in the match, changes nothing.
 */
function onWormSpawned(state: MatchState, event: WormSpawnedEvent, deps: MatchDeps): MatchState {
  const teamIndex = findTeamIndex(state, event.teamId);
  if (teamIndex < 0 || findWorm(state, event.wormId) !== null) return state;
  const share = Number.isFinite(event.hpShare) && event.hpShare > 0 ? Math.min(1, event.hpShare) : 1;
  const hp = Math.max(1, Math.round(deps.config.wormHp * share));
  let name = '';
  const next = updateTeam(state, teamIndex, (team) => {
    name = `Saiba ${team.worms.filter((w) => w.id.includes('-saiba-')).length + 1}`;
    const worm: WormState = {
      id: event.wormId,
      name,
      hp,
      maxHp: hp,
      alive: true,
      x: event.x,
      y: event.y,
      ammo: saibamanAmmoTable(),
      superRest: 0,
      turns: 0,
      frozenTurns: 0,
      shieldDurability: 0,
      shieldExpiresAtOwnTurn: 0,
      immortalityCharges: 0,
      lastProtectedAttack: null,
    };
    return { ...team, worms: [...team.worms, worm] };
  });
  return appendLog(resetInactivity(next), 'worm.spawned', `${name} sprouts for ${state.teams[teamIndex]?.name ?? event.teamId}`);
}

/** The Tesoro del Cielo closed on a worm: the ledger keeps the seal (match/seals.ts). Only while the cast's turn is live. */
function onWormSealed(state: MatchState, event: WormSealedEvent): MatchState {
  if (!isPreResolvePhase(state.phase) && state.phase !== 'Resolving') return state;
  return addSeal(state, event);
}

function onCrateLanded(state: MatchState): MatchState {
  const landed: MatchState = { ...state, cratesOnMap: state.cratesOnMap + 1, crateDrop: null };
  return appendLog(resetInactivity(landed), 'crate.landed', `Crate landed, ${landed.cratesOnMap} on the map`);
}

function onCratePicked(state: MatchState, event: CratePickedEvent, deps: MatchDeps): MatchState {
  const ref = findWorm(state, event.wormId);
  let next: MatchState = { ...state, cratesOnMap: Math.max(0, state.cratesOnMap - 1) };
  if (ref !== null && ref.worm.alive) {
    const weaponId = event.weaponId;
    if (event.crate === 'health') {
      const amount =
        event.amount !== undefined && Number.isFinite(event.amount) && event.amount > 0
          ? event.amount
          : healthCrateAmount(deps.config);
      next = replaceWorm(next, ref.teamIndex, ref.wormIndex, { ...ref.worm, hp: ref.worm.hp + amount });
    } else if (event.crate === 'immortality') {
      // Globally unique: immortalityEverDropped already went true the instant this was rolled
      // (match/machine-phases.ts enterTurnEnd), so no second one can ever follow.
      if (state.immortalityClaimed !== true) {
        next = replaceWorm(next, ref.teamIndex, ref.wormIndex, { ...ref.worm, immortalityCharges: IMMORTALITY_CHARGES });
        next = appendLog({ ...next, immortalityClaimed: true, immortalityEverDropped: true }, 'immortality.claimed', `${ref.worm.name} cannot be killed outright 3 times over`);
      }
    } else {
      // The sim does not know the roster, so a crate arrives without a weapon: roll one here,
      // weighted by crateWeight, from the kind the crate promises. Before this the weapon crate
      // was collected and granted nothing, and the utility crate was not handled at all. A power
      // orb recharges a super instead, one this worm has spent when it has any.
      const granted = weaponId ?? (event.crate === 'power' ? rollPower(deps.rng, ref.worm.ammo) : rollCrateWeapon(deps.rng, event.crate, ref.worm.ammo));
      if (granted !== null && granted !== undefined) {
        const count = ref.worm.ammo[granted];
        if (count !== undefined && count >= 0) {
          next = replaceWorm(next, ref.teamIndex, ref.wormIndex, { ...ref.worm, ammo: { ...ref.worm.ammo, [granted]: count + 1 } });
        }
        next = appendLog(next, 'crate.weapon', `${ref.worm.name} gets ${granted}`);
      }
    }
  }
  const who = ref === null ? 'someone' : ref.worm.name;
  return appendLog(resetInactivity(next), 'crate.picked', `${who} picks up a ${event.crate} crate`);
}

function onCrateDestroyed(state: MatchState, wasCounted: boolean): MatchState {
  const next: MatchState = wasCounted
    ? { ...state, cratesOnMap: Math.max(0, state.cratesOnMap - 1) }
    : { ...state, crateDrop: null };
  return appendLog(resetInactivity(next), 'crate.destroyed', `Crate destroyed, ${next.cratesOnMap} on the map`);
}

function onSkipTurn(state: MatchState, event: SkipTurnEvent): MatchState {
  if (state.phase !== 'Active') return state;
  return event.reason === 'lostControl'
    ? leaveTurn(state, 'turn.forfeit', 'Lost control')
    : leaveTurn(state, 'turn.skip', 'Turn skipped');
}

function onSurrender(state: MatchState, event: SurrenderEvent): MatchState {
  const teamIndex = findTeamIndex(state, event.teamId);
  const team = state.teams[teamIndex];
  if (team === undefined || !isTeamAlive(team)) return state;
  const ids = new Set(team.worms.map((worm) => worm.id));
  const dead: TeamState = { ...team, worms: team.worms.map((worm) => ({ ...worm, alive: false, hp: 0 })) };
  const removed = replaceTeam(state, teamIndex, dead);
  const next = appendLog(
    { ...removed, pendingDeaths: removed.pendingDeaths.filter((death) => !ids.has(death.wormId)) },
    'surrender',
    `${team.name} surrenders`,
  );
  if (matchDecided(next)) return enterMatchEnd(next);
  if (teamIndex === next.activeTeamIndex && isPreResolvePhase(next.phase)) {
    return leaveTurn(next, 'turn.forfeit', `${team.name} forfeits the turn`);
  }
  return next;
}

import { onTimerTick } from './machine-tick.ts';
