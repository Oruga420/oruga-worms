/**
 * Win detection (architecture.md section E): the match ends when one team is alive (winner) or
 * none is (draw). A team is alive while any of its worms is; surrender kills a whole team at
 * once. Pure reads over the ledger, used by the reducer at TurnEnd and by the end screen.
 */

import type { MatchState, TeamState } from './state.ts';

export type MatchOutcome =
  | { readonly kind: 'ongoing' }
  | { readonly kind: 'winner'; readonly teamId: string }
  | { readonly kind: 'draw' };

const ONGOING: MatchOutcome = Object.freeze({ kind: 'ongoing' });
const DRAW: MatchOutcome = Object.freeze({ kind: 'draw' });

export function isTeamAlive(team: TeamState): boolean {
  return team.worms.some((worm) => worm.alive);
}

export function aliveTeams(state: MatchState): readonly TeamState[] {
  return state.teams.filter(isTeamAlive);
}

/** True when at most one team is left: the reducer moves to MatchEnd. */
export function matchDecided(state: MatchState): boolean {
  return aliveTeams(state).length <= 1;
}

export function outcome(state: MatchState): MatchOutcome {
  const alive = aliveTeams(state);
  const only = alive[0];
  if (alive.length === 0) return DRAW;
  if (alive.length === 1 && only !== undefined) return Object.freeze({ kind: 'winner', teamId: only.id });
  return ONGOING;
}

/** The winning team, or null while the match is ongoing or ended in a draw. */
export function winner(state: MatchState): TeamState | null {
  const alive = aliveTeams(state);
  const only = alive[0];
  return alive.length === 1 && only !== undefined ? only : null;
}

export function isDraw(state: MatchState): boolean {
  return aliveTeams(state).length === 0;
}
