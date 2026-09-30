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

import { getWeapon } from '../weapons/registry.ts';
import { healthCrateAmount, rollCrateWeapon, rollPower } from './crates.ts';
import type { MatchDeps } from './deps.ts';
import type {
  CratePickedEvent,
  DamageAppliedEvent,
  FireCompletedEvent,
  FireStartedEvent,
  MatchEvent,
  SkipTurnEvent,
  SurrenderEvent,
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
  }
}

function onBannerDone(state: MatchState, deps: MatchDeps): MatchState {
  switch (state.phase) {
    case 'TurnStart': {
      const ms = hotSeatMsFor(state.teams, state.activeTeamIndex, deps.config);
      return ms > 0 ? enterHotSeat(state, ms) : enterActive(state, deps.config, true);
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
  if (ammo !== undefined && state.turn < (getWeapon(event.weaponId).delayTurns ?? 0)) return appendLog(state, 'fire.rejected', `${event.weaponId} is not unlocked yet`);
  if (ammo === undefined) return appendLog(state, 'fire.rejected', `Unknown weapon ${event.weaponId}`);
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
    worms: current.worms.map((w) => w.id === worm.id && firstShot && ammo > 0
      ? { ...w, ammo: { ...w.ammo, [event.weaponId]: ammo - 1 } } : w),
    score: scoreShotFired(previous === null ? current.score : scoreShotClosed(current.score, previous.damage)),
  }));
  const next: MatchState = {
    ...scored,
    shot: { weaponId: event.weaponId, shotsRemaining: event.shotsRemaining, damage: 0 },
  };
  return appendLog(transition(next, 'Firing'), 'fire', `${team.name} fires ${event.weaponId}`);
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

function onDamageApplied(state: MatchState, event: DamageAppliedEvent): MatchState {
  if (!Number.isFinite(event.amount) || event.amount <= 0) return state;
  const ref = findWorm(state, event.wormId);
  if (ref === null || !ref.worm.alive) return state;
  const effective = Math.min(event.amount, ref.worm.hp);
  if (effective <= 0) return resetInactivity(state);
  const hp = ref.worm.hp - effective;
  let next = replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, hp });
  if (event.sourceTeamId !== null) next = bookDamage(next, event.sourceTeamId, ref.team.id, event.wormId, effective);
  next = appendLog(resetInactivity(next), 'damage', event.toll === true ? `${ref.worm.name} pays ${effective} for its super` : `${ref.worm.name} takes ${effective}`);
  if (hp > 0) return next;
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
    const worm: WormState = { id: event.wormId, name, hp, maxHp: hp, alive: true, x: event.x, y: event.y, ammo: saibamanAmmoTable() };
    return { ...team, worms: [...team.worms, worm] };
  });
  return appendLog(resetInactivity(next), 'worm.spawned', `${name} sprouts for ${state.teams[teamIndex]?.name ?? event.teamId}`);
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
