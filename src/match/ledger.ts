/**
 * Ledger helpers shared by the reducer modules: log ring, worm and team lookups, immutable
 * replacements and timer patches. Everything returns a new state; nothing here freezes, the
 * reducer freezes once at the end of each reduce call.
 */

import {
  MATCH_LOG_CAP,
  type MatchLogEntry,
  type MatchState,
  type MatchTimers,
  type TeamState,
  type WormState,
} from './state.ts';

/** Closed list of log kinds so the HUD and the tests can switch on them. */
export type MatchLogKind =
  | 'turn.start'
  | 'turn.timeout'
  | 'turn.skip'
  | 'turn.forfeit'
  | 'hotseat'
  | 'fire'
  | 'fire.rejected'
  | 'retreat'
  | 'resolve'
  | 'damage'
  | 'death.queued'
  | 'death.killed'
  | 'death.drowned'
  | 'crate.drop'
  | 'crate.landed'
  | 'crate.picked'
  | 'crate.weapon'
  | 'crate.destroyed'
  | 'surrender'
  | 'suddenDeath.start'
  | 'suddenDeath.water'
  | 'match.end';

export const ZERO_TIMERS: MatchTimers = Object.freeze({
  turnRemainingMs: 0,
  hotSeatRemainingMs: 0,
  retreatRemainingMs: 0,
  resolveElapsedMs: 0,
  resolveInactiveMs: 0,
});

/** Appends one entry, dropping the oldest when the ring is full. */
export function appendLog(
  state: MatchState,
  kind: MatchLogKind,
  text: string,
  forceSettled?: boolean,
): MatchState {
  const entry: MatchLogEntry =
    forceSettled === undefined
      ? { turn: state.turn, kind, text }
      : { turn: state.turn, kind, text, forceSettled };
  const overflow = state.log.length - MATCH_LOG_CAP + 1;
  const kept = overflow > 0 ? state.log.slice(overflow) : state.log;
  return { ...state, log: [...kept, entry] };
}

export interface WormRef {
  readonly teamIndex: number;
  readonly wormIndex: number;
  readonly team: TeamState;
  readonly worm: WormState;
}

export function findWorm(state: MatchState, wormId: string): WormRef | null {
  for (let teamIndex = 0; teamIndex < state.teams.length; teamIndex += 1) {
    const team = state.teams[teamIndex];
    if (team === undefined) continue;
    const wormIndex = team.worms.findIndex((worm) => worm.id === wormId);
    const worm = team.worms[wormIndex];
    if (wormIndex >= 0 && worm !== undefined) return { teamIndex, wormIndex, team, worm };
  }
  return null;
}

export function findTeamIndex(state: MatchState, teamId: string): number {
  return state.teams.findIndex((team) => team.id === teamId);
}

export function replaceTeam(state: MatchState, teamIndex: number, team: TeamState): MatchState {
  return { ...state, teams: state.teams.map((current, index) => (index === teamIndex ? team : current)) };
}

export function updateTeam(
  state: MatchState,
  teamIndex: number,
  update: (team: TeamState) => TeamState,
): MatchState {
  const team = state.teams[teamIndex];
  return team === undefined ? state : replaceTeam(state, teamIndex, update(team));
}

export function replaceWorm(
  state: MatchState,
  teamIndex: number,
  wormIndex: number,
  worm: WormState,
): MatchState {
  return updateTeam(state, teamIndex, (team) => ({
    ...team,
    worms: team.worms.map((current, index) => (index === wormIndex ? worm : current)),
  }));
}

export function withTimers(state: MatchState, patch: Partial<MatchTimers>): MatchState {
  return { ...state, timers: { ...state.timers, ...patch } };
}

/** Resolving only: a bounce, carve, spawn, damage event or crate landing restarts the inactivity clock. */
export function resetInactivity(state: MatchState): MatchState {
  return state.phase === 'Resolving' ? withTimers(state, { resolveInactiveMs: 0 }) : state;
}

export function activeTeamOf(state: MatchState): TeamState | undefined {
  return state.teams[state.activeTeamIndex];
}

export function activeWormOf(state: MatchState): WormState | undefined {
  const team = activeTeamOf(state);
  return team?.worms[team.activeWormIndex];
}

export function isActiveWorm(state: MatchState, wormId: string): boolean {
  return activeWormOf(state)?.id === wormId;
}
