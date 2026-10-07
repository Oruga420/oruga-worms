/**
 * The rest between a worm's supers. A worm that uses a super (registry isSuper: the Ryuko Ranbu,
 * the Kamehameha, Gear 5, the Freezer, the Saibaman seed and the anime row's techniques) sits out
 * supers for its own next turn: its team mates are not held back, and any weapon that is not a
 * super is open to it the whole time.
 *
 * The ledger keeps it as a count on the worm, superRest: how many of its own turn ends must pass
 * before it may use a super again. A super sets it to two (the end of the turn it was used in and
 * the end of the worm's next), and every TurnEnd of the worm's own turn takes one off. Pure
 * functions over WormState.
 */

import type { WormState } from './state.ts';

/** Own turns a worm sits out supers for after using one. */
export const SUPER_REST_TURNS = 1;

/** The worm may not use a super this turn. */
export function superResting(worm: Pick<WormState, 'superRest'>): boolean {
  return worm.superRest > 0;
}

/** The worm used a super: the rest of this turn and its next SUPER_REST_TURNS turns are super free. */
export function restAfterSuper(worm: WormState): WormState {
  return { ...worm, superRest: SUPER_REST_TURNS + 1 };
}

/** One of the worm's own turns has ended. */
export function restTurnEnded(worm: WormState): WormState {
  return worm.superRest === 0 ? worm : { ...worm, superRest: worm.superRest - 1 };
}
