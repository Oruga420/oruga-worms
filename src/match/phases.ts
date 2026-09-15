/**
 * Match phases and the legal transition table (architecture.md section E, reconciled to
 * ultraplan.html rev 2, which adds HotSeat between TurnStart and Active: "hotSeatMs 5 s in the
 * state machine between turns"). Boot, the menus and the game over screen live outside the
 * match; MatchEnd is the terminal phase and accepts nothing.
 *
 * Every turn ending path converges on Resolving so bodies always settle before TurnEnd reads the
 * ledger: the fire and retreat path, a timed out or skipped turn, and a forfeited one (surrender,
 * active worm drowned or at 0 hp). TurnStart, TurnEnd and SuddenDeathCheck are presentation
 * phases: they exit on BannerDone, which the game loop sends at once when there is nothing to
 * show. Surrender can end the match from any phase, hence MatchEnd everywhere.
 */

import { MATCH_PHASES, type MatchPhase } from './state.ts';

export { MATCH_PHASES };
export type { MatchPhase };

export const PHASE_TRANSITIONS: Readonly<Record<MatchPhase, readonly MatchPhase[]>> = Object.freeze({
  TurnStart: Object.freeze<readonly MatchPhase[]>(['HotSeat', 'Active', 'Resolving', 'MatchEnd']),
  HotSeat: Object.freeze<readonly MatchPhase[]>(['Active', 'Resolving', 'MatchEnd']),
  Active: Object.freeze<readonly MatchPhase[]>(['Firing', 'Resolving', 'MatchEnd']),
  Firing: Object.freeze<readonly MatchPhase[]>(['Active', 'Retreat', 'Resolving', 'MatchEnd']),
  Retreat: Object.freeze<readonly MatchPhase[]>(['Resolving', 'MatchEnd']),
  Resolving: Object.freeze<readonly MatchPhase[]>(['TurnEnd', 'MatchEnd']),
  TurnEnd: Object.freeze<readonly MatchPhase[]>(['SuddenDeathCheck', 'MatchEnd']),
  SuddenDeathCheck: Object.freeze<readonly MatchPhase[]>(['TurnStart', 'MatchEnd']),
  MatchEnd: Object.freeze<readonly MatchPhase[]>([]),
});

/** Phases in which the active team still holds the turn; the turn ends from any of them through Resolving. */
export const PRE_RESOLVE_PHASES: readonly MatchPhase[] = Object.freeze([
  'TurnStart',
  'HotSeat',
  'Active',
  'Firing',
  'Retreat',
]);

/** Phases that exit on BannerDone once the game loop has shown what there is to show. */
export const BANNER_PHASES: readonly MatchPhase[] = Object.freeze(['TurnStart', 'TurnEnd', 'SuddenDeathCheck']);

export function canTransition(from: MatchPhase, to: MatchPhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function isTerminalPhase(phase: MatchPhase): boolean {
  return PHASE_TRANSITIONS[phase].length === 0;
}

export function isPreResolvePhase(phase: MatchPhase): boolean {
  return PRE_RESOLVE_PHASES.includes(phase);
}

export function isBannerPhase(phase: MatchPhase): boolean {
  return BANNER_PHASES.includes(phase);
}

export function isMatchPhase(value: unknown): value is MatchPhase {
  return typeof value === 'string' && (MATCH_PHASES as readonly string[]).includes(value);
}
