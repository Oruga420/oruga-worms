/**
 * The Tesoro del Cielo's seals in the ledger. The cast (sim/techniques/treasure.ts) reports the worm
 * it sealed (WormSealed); from then on, whenever the sealed worm's team comes up to play, the turn is
 * taken from it: every seal still holding on the team strikes once, and the turn goes straight to
 * Resolving. The controller plays each strike in the sim, where the caster pays its toll and the
 * last strike takes the sealed worm's life, so the ledger books both the way it books any damage.
 *
 * A seal holds while its caster and its target are both alive: either dying first breaks it, and the
 * team plays its turns again. Pure functions over MatchState, like the rest of the reducer.
 */

import type { WormSealedEvent } from './events.ts';
import { activeTeamOf, appendLog, findWorm, resetInactivity } from './ledger.ts';
import type { MatchState, Seal, SealStrike } from './state.ts';

/** The most strikes a seal may carry: the treasure takes the senses, and a worm has only so many. */
export const MAX_SEAL_HITS = 6;

function alive(state: MatchState, wormId: string): boolean {
  return findWorm(state, wormId)?.worm.alive === true;
}

/** A seal still holds: its caster and the worm it sealed are both alive. */
export function sealHolds(state: MatchState, seal: Seal): boolean {
  return alive(state, seal.casterId) && alive(state, seal.targetId);
}

/** The seals still holding on a worm. */
export function sealsOn(state: MatchState, wormId: string): readonly Seal[] {
  return state.seals.filter((seal) => seal.targetId === wormId && sealHolds(state, seal));
}

/** A seal holds on one of the team's worms: its next turn is the treasure's. */
export function teamSealed(state: MatchState, teamId: string): boolean {
  return state.seals.some((seal) => seal.targetTeamId === teamId && sealHolds(state, seal));
}

/** A worm sealed by the cast joins the ledger's seals; a report about worms that are not both alive and on different teams changes nothing. */
export function addSeal(state: MatchState, event: WormSealedEvent): MatchState {
  const caster = findWorm(state, event.casterId);
  const target = findWorm(state, event.targetId);
  if (caster === null || target === null || !caster.worm.alive || !target.worm.alive || caster.team.id === target.team.id) return state;
  if (!Number.isInteger(event.hits) || event.hits < 1 || event.hits > MAX_SEAL_HITS || !Number.isFinite(event.hitToll) || event.hitToll < 0) return state;
  const seal: Seal = {
    weaponId: event.weaponId,
    casterId: caster.worm.id,
    casterTeamId: caster.team.id,
    targetId: target.worm.id,
    targetTeamId: target.team.id,
    hits: event.hits,
    hitsLeft: event.hits,
    hitToll: event.hitToll,
  };
  const next: MatchState = { ...state, seals: [...state.seals, seal] };
  return appendLog(resetInactivity(next), 'seal', `${target.worm.name} is sealed by ${caster.worm.name}: ${target.team.name} loses its next ${event.hits} turns`);
}

/** Drops the seals that no longer hold, with a line in the log for each. */
export function pruneSeals(state: MatchState): MatchState {
  const broken = state.seals.filter((seal) => !sealHolds(state, seal));
  if (broken.length === 0) return state;
  let next: MatchState = { ...state, seals: state.seals.filter((seal) => sealHolds(state, seal)) };
  for (const seal of broken) {
    const target = findWorm(state, seal.targetId)?.worm.name ?? seal.targetId;
    next = appendLog(next, 'seal.broken', `The seal on ${target} is broken`);
  }
  return next;
}

/**
 * The team whose turn is starting is sealed: the turn is the treasure's. Every seal on it strikes
 * once (the last one of a seal kills), the strikes are left for the controller to play, and the
 * seals that have struck their last are spent. Null when no seal holds on the team; the broken ones
 * are dropped either way, so the caller keeps `pruned`.
 */
export function takeSealedTurn(state: MatchState): { readonly pruned: MatchState; readonly taken: MatchState | null } {
  const pruned = pruneSeals(state);
  const team = activeTeamOf(pruned);
  if (team === undefined) return { pruned, taken: null };
  const striking = pruned.seals.filter((seal) => seal.targetTeamId === team.id);
  if (striking.length === 0) return { pruned, taken: null };
  const strikes: SealStrike[] = striking.map((seal) => ({
    weaponId: seal.weaponId,
    casterId: seal.casterId,
    casterTeamId: seal.casterTeamId,
    targetId: seal.targetId,
    hit: seal.hits - seal.hitsLeft + 1,
    fatal: seal.hitsLeft <= 1,
    hitToll: seal.hitToll,
  }));
  const seals = pruned.seals.map((seal) => (striking.includes(seal) ? { ...seal, hitsLeft: seal.hitsLeft - 1 } : seal)).filter((seal) => seal.hitsLeft > 0);
  let taken: MatchState = { ...pruned, seals, strikes };
  for (const strike of strikes) {
    const target = findWorm(pruned, strike.targetId)?.worm.name ?? strike.targetId;
    taken = appendLog(taken, 'seal.strike', strike.fatal ? `The treasure takes ${target}'s last sense` : `The treasure takes a sense from ${target} (${strike.hit})`);
  }
  return { pruned, taken };
}
