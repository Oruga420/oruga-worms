/**
 * The Tesoro del Cielo's seals in the ledger. The cast (sim/techniques/treasure.ts) reports the worm
 * it sealed (WormSealed); from then on that worm sits its turns out, not its team: the rotation
 * passes over it (sealedWorms) and the team plays with its other worms, and at the end of each of
 * the team's turns every seal on it strikes once (strikeAtTurnEnd). Only when the sealed worms are
 * all the team has left is the turn itself taken (takeSealedTurn): the seals strike and the turn
 * goes straight to Resolving. The controller plays each strike in the sim, where the caster pays
 * its toll and the last strike takes the sealed worm's life, so the ledger books both the way it
 * books any damage.
 *
 * A seal holds while its caster and its target are both alive: either dying first breaks it, and the
 * worm plays its turns again. Pure functions over MatchState, like the rest of the reducer.
 */

import type { WormSealedEvent } from './events.ts';
import { activeTeamOf, activeWormOf, appendLog, findWorm, resetInactivity } from './ledger.ts';
import type { MatchState, Seal, SealStrike } from './state.ts';
import type { HeldOut } from './turn.ts';

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

/** The worms a seal holds on, for the rotation to pass over while their teams have others to play. */
export function sealedWorms(state: MatchState): HeldOut {
  const sealed = new Set(state.seals.filter((seal) => sealHolds(state, seal)).map((seal) => seal.targetId));
  return (wormId) => sealed.has(wormId);
}

/** The worm whose turn it is sits it out: a seal holds on it, so every worm its team has left is sealed. */
export function activeWormSealed(state: MatchState): boolean {
  const worm = activeWormOf(state);
  return worm !== undefined && sealsOn(state, worm.id).length > 0;
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
 * Every seal on the team strikes once: the strikes are left for the controller to play (the last
 * one of a seal kills), and the seals that have struck their last are spent.
 */
function strikeTeam(state: MatchState, teamId: string): MatchState {
  const striking = state.seals.filter((seal) => seal.targetTeamId === teamId);
  const strikes: SealStrike[] = striking.map((seal) => ({
    weaponId: seal.weaponId,
    casterId: seal.casterId,
    casterTeamId: seal.casterTeamId,
    targetId: seal.targetId,
    hit: seal.hits - seal.hitsLeft + 1,
    fatal: seal.hitsLeft <= 1,
    hitToll: seal.hitToll,
  }));
  const seals = state.seals.map((seal) => (striking.includes(seal) ? { ...seal, hitsLeft: seal.hitsLeft - 1 } : seal)).filter((seal) => seal.hitsLeft > 0);
  let next: MatchState = { ...state, seals, strikes };
  for (const strike of strikes) {
    const target = findWorm(state, strike.targetId)?.worm.name ?? strike.targetId;
    next = appendLog(next, 'seal.strike', strike.fatal ? `The treasure takes ${target}'s last sense` : `The treasure takes a sense from ${target} (${strike.hit})`);
  }
  return next;
}

/**
 * The worm whose turn is starting is sealed, so its team has no other to play: the turn is the
 * treasure's, and every seal on the team strikes. Null when the worm is free; the broken seals are
 * dropped either way, so the caller keeps `pruned`.
 */
export function takeSealedTurn(state: MatchState): { readonly pruned: MatchState; readonly taken: MatchState | null } {
  const pruned = pruneSeals(state);
  const team = activeTeamOf(pruned);
  if (team === undefined || !activeWormSealed(pruned)) return { pruned, taken: null };
  return { pruned, taken: strikeTeam(pruned, team.id) };
}

/**
 * The turn is settling: if the team that played it has a worm sealed and the treasure has not
 * struck this turn yet (a taken turn already has), every seal on the team strikes now. Null when
 * nothing strikes; the broken seals are dropped either way, so the caller keeps `pruned`.
 */
export function strikeAtTurnEnd(state: MatchState): { readonly pruned: MatchState; readonly struck: MatchState | null } {
  if (state.strikes.length > 0) return { pruned: state, struck: null };
  const pruned = pruneSeals(state);
  const team = activeTeamOf(pruned);
  if (team === undefined || !pruned.seals.some((seal) => seal.targetTeamId === team.id)) return { pruned, struck: null };
  return { pruned, struck: strikeTeam(pruned, team.id) };
}
