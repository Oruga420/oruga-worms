/**
 * Frozen worms retain their rotation slots. At TurnStart their scheduled turn is consumed and
 * one frozenTurns is removed before resolving. Unlike a seal, a freeze must not be passed over
 * when an unfrozen teammate exists, or the frozen worm would never get a chance to thaw.
 * The ordinary phase cycle advances without recursive selection, even when everyone is frozen.
 */

import { activeTeamOf, activeWormOf, appendLog, findWorm, replaceWorm, resetInactivity } from './ledger.ts';
import type { MatchState } from './state.ts';
import type { HeldOut } from './turn.ts';

/** Membership for status inspection; never use this predicate to bypass rotation slots. */
export function frozenWorms(state: MatchState): HeldOut {
  const frozen = new Set<string>();
  for (const team of state.teams) for (const worm of team.worms) if (worm.alive && worm.frozenTurns > 0) frozen.add(worm.id);
  return (wormId) => frozen.has(wormId);
}

/** The worm whose turn is starting is frozen: its turn is lost outright, one frozenTurns spent. */
export function activeWormFrozen(state: MatchState): boolean {
  const worm = activeWormOf(state);
  return worm !== undefined && worm.frozenTurns > 0;
}

/**
 * The turn starting belongs to a frozen worm: it is taken on the spot, no banner, straight to
 * Resolving like a sealed turn. Null when the active worm is free; `pruned` is `state` unchanged,
 * kept only so the call site reads the same as takeSealedTurn's.
 */
export function takeFrozenTurn(state: MatchState): { readonly pruned: MatchState; readonly taken: MatchState | null } {
  const team = activeTeamOf(state);
  const worm = activeWormOf(state);
  if (team === undefined || worm === undefined || worm.frozenTurns <= 0) return { pruned: state, taken: null };
  const ref = findWorm(state, worm.id);
  if (ref === null) return { pruned: state, taken: null };
  const thawed = replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, frozenTurns: ref.worm.frozenTurns - 1 });
  const taken = appendLog(resetInactivity(thawed), 'turn.skip', `${worm.name} is frozen solid and loses the turn`);
  return { pruned: state, taken };
}
