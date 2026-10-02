/**
 * The rest between a team's supers. A team that uses a super (registry isSuper: the Ryuko Ranbu,
 * the Kamehameha, Gear 5, the Freezer, the Saibaman seed and the anime row's techniques) sits
 * out supers for its next turn: with teams A, B and C, A uses one, B and C play, A plays without
 * a super, B and C play again, and only then may A use another. Any weapon that is not a super is
 * open the whole time.
 *
 * The ledger keeps it as a count on the team, superRest: how many of its own turn ends must pass
 * before it may use a super again. A super sets it to two (the end of the turn it was used in and
 * the end of the next), and every TurnEnd of the team takes one off. Pure functions over TeamState.
 */

import type { TeamState } from './state.ts';

/** Own turns a team sits out supers for after using one. */
export const SUPER_REST_TURNS = 1;

/** The team may not use a super this turn. */
export function superResting(team: Pick<TeamState, 'superRest'>): boolean {
  return team.superRest > 0;
}

/** The team used a super: the rest of this turn and its next SUPER_REST_TURNS turns are super free. */
export function restAfterSuper(team: TeamState): TeamState {
  return { ...team, superRest: SUPER_REST_TURNS + 1 };
}

/** One of the team's turns has ended. */
export function restTurnEnded(team: TeamState): TeamState {
  return team.superRest === 0 ? team : { ...team, superRest: team.superRest - 1 };
}
