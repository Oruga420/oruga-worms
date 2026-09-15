/**
 * Turn rotation (prior-art.md Part B: rotation by team order, then sequential worm select inside
 * the team, skipping dead worms and dead teams). Pure lookups over the ledger; the reducer
 * applies the selection at TurnStart.
 *
 * The hot seat delay is only for keyboard swaps: it applies when the incoming team is human and
 * at least two human teams are still alive. A CPU turn, or a human alone against CPUs, starts at
 * once.
 */

import type { MatchConfig } from './deps.ts';
import type { TeamState } from './state.ts';

export interface TurnSelection {
  readonly teamIndex: number;
  readonly wormIndex: number;
}

export function teamHasLivingWorm(team: TeamState): boolean {
  return team.worms.some((worm) => worm.alive);
}

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}

/**
 * Next team after `current` (wrapping) with a living worm; `current` itself is the last
 * candidate, so a lone surviving team keeps its turns. -1 when no team has a living worm.
 * `current` may be -1 before the first turn.
 */
export function nextTeamIndex(teams: readonly TeamState[], current: number): number {
  const count = teams.length;
  if (count === 0) return -1;
  for (let step = 1; step <= count; step += 1) {
    const index = wrap(current + step, count);
    const team = teams[index];
    if (team !== undefined && teamHasLivingWorm(team)) return index;
  }
  return -1;
}

/** Next living worm after the team's activeWormIndex (wrapping); -1 when none is alive. */
export function nextWormIndex(team: TeamState): number {
  const count = team.worms.length;
  if (count === 0) return -1;
  for (let step = 1; step <= count; step += 1) {
    const index = wrap(team.activeWormIndex + step, count);
    const worm = team.worms[index];
    if (worm !== undefined && worm.alive) return index;
  }
  return -1;
}

export function selectNextTurn(teams: readonly TeamState[], currentTeamIndex: number): TurnSelection | null {
  const teamIndex = nextTeamIndex(teams, currentTeamIndex);
  const team = teams[teamIndex];
  if (teamIndex < 0 || team === undefined) return null;
  const wormIndex = nextWormIndex(team);
  if (wormIndex < 0) return null;
  return Object.freeze({ teamIndex, wormIndex });
}

export function countLivingHumanTeams(teams: readonly TeamState[]): number {
  return teams.filter((team) => team.controller === 'human' && teamHasLivingWorm(team)).length;
}

export function hotSeatMsFor(teams: readonly TeamState[], teamIndex: number, config: MatchConfig): number {
  const team = teams[teamIndex];
  if (team === undefined || team.controller !== 'human') return 0;
  return countLivingHumanTeams(teams) >= 2 ? config.hotSeatMs : 0;
}
