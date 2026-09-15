/**
 * Phase entry functions of the match reducer (architecture.md section E, reconciled to the
 * ultraplan rev 2 tuning card). Every function returns a new state and never mutates. The
 * reducer in machine.ts dispatches events; this module owns what happens on the way into each
 * phase: TurnStart (rotation, wind roll, timers), HotSeat, Active (45 s timer), Retreat,
 * Resolving (inactivity and absolute caps), TurnEnd (deaths, shot window, crate roll),
 * SuddenDeathCheck and MatchEnd (final scores).
 */

import { canDropCrate, rollScheduledCrate } from './crates.ts';
import type { MatchConfig, MatchDeps } from './deps.ts';
import { activeTeamOf, appendLog, findTeamIndex, findWorm, replaceWorm, updateTeam, withTimers, ZERO_TIMERS, type MatchLogKind } from './ledger.ts';
import { canTransition } from './phases.ts';
import { startRetreat } from './retreat.ts';
import { finalizeScores, scoreKill, scoreShotClosed } from './scoring.ts';
import { makeWindState, WIND_STEP_MAX, WIND_STEP_MIN, type MatchPhase, type MatchState, type PendingDeath, type SettleReason } from './state.ts';
import { applySuddenDeathCheck } from './sudden-death.ts';
import { selectNextTurn } from './turn.ts';
import { outcome } from './win.ts';

/** Moves to `to` when the transition table allows it; an illegal request leaves the state untouched. */
export function transition(state: MatchState, to: MatchPhase): MatchState {
  return canTransition(state.phase, to) ? { ...state, phase: to } : state;
}

/** Fresh turn: full turn timer and no open shot. Between shotgun barrels the timer keeps running. */
export function enterActive(state: MatchState, config: MatchConfig, freshTurn: boolean): MatchState {
  const timers = freshTurn
    ? { ...state.timers, turnRemainingMs: config.turnMs, hotSeatRemainingMs: 0 }
    : { ...state.timers, hotSeatRemainingMs: 0 };
  const next: MatchState = { ...state, timers, shot: freshTurn ? null : state.shot };
  return transition(next, 'Active');
}

export function enterHotSeat(state: MatchState, ms: number): MatchState {
  const next = withTimers(state, { hotSeatRemainingMs: Math.max(0, ms) });
  return appendLog(transition(next, 'HotSeat'), 'hotseat', `Hot seat, ${ms} ms to swap seats`);
}

export function enterRetreat(state: MatchState, ms: number): MatchState {
  const next: MatchState = { ...state, timers: startRetreat(state.timers, ms) };
  return transition(next, 'Retreat');
}

export function enterResolving(state: MatchState): MatchState {
  const next = withTimers(state, { retreatRemainingMs: 0, resolveElapsedMs: 0, resolveInactiveMs: 0 });
  return transition({ ...next, settle: null }, 'Resolving');
}

/** Any pre resolve phase ends the turn through Resolving so the bodies settle before TurnEnd reads the ledger. */
export function leaveTurn(state: MatchState, kind: MatchLogKind, text: string): MatchState {
  return enterResolving(appendLog(state, kind, text));
}

/** Closes the active team's shot window into shotsHit and bestShot. */
function closeShotWindow(state: MatchState): MatchState {
  if (state.shot === null) return state;
  const damage = state.shot.damage;
  const closed = updateTeam(state, state.activeTeamIndex, (team) => ({ ...team, score: scoreShotClosed(team.score, damage) }));
  return { ...closed, shot: null };
}

/** Kill credit goes to the last enemy team that hit the worm this turn; self and environmental deaths credit nobody. */
export function killCreditFor(state: MatchState, wormId: string, victimTeamId: string): string | null {
  const last = state.lastHitBy[wormId];
  return last !== undefined && last !== victimTeamId ? last : null;
}

/** Marks the worm dead, credits the kill and logs it. Idempotent for a worm already dead. */
export function applyDeath(state: MatchState, death: PendingDeath): MatchState {
  const ref = findWorm(state, death.wormId);
  if (ref === null || !ref.worm.alive) return state;
  let next = replaceWorm(state, ref.teamIndex, ref.wormIndex, { ...ref.worm, alive: false, hp: 0 });
  if (death.creditTeamId !== null && death.creditTeamId !== ref.team.id) {
    const creditIndex = findTeamIndex(next, death.creditTeamId);
    next = updateTeam(next, creditIndex, (team) => ({ ...team, score: scoreKill(team.score) }));
  }
  next = { ...next, pendingDeaths: next.pendingDeaths.filter((pending) => pending.wormId !== death.wormId) };
  const kind: MatchLogKind = death.cause === 'drowned' ? 'death.drowned' : 'death.killed';
  const verb = death.cause === 'drowned' ? 'drowns' : 'is gone';
  return appendLog(next, kind, `${ref.worm.name} ${verb}`);
}

function enterTurnEnd(state: MatchState, deps: MatchDeps): MatchState {
  let next = closeShotWindow(state);
  for (const death of next.pendingDeaths) next = applyDeath(next, death);
  next = { ...next, pendingDeaths: [] };
  const pendingDrop = next.crateDrop !== null;
  const every = deps.config.crates.dropEveryTurns;
  next = { ...next, turnsSinceCrateDrop: next.turnsSinceCrateDrop + 1 };
  if (every > 0 && next.turnsSinceCrateDrop >= every && !pendingDrop && canDropCrate(next.cratesOnMap, deps.config)) {
    const drop = rollScheduledCrate(deps.rng, deps.config, next.suddenDeath);
    next = appendLog({ ...next, crateDrop: drop, turnsSinceCrateDrop: 0 }, 'crate.drop', `A ${drop} supply crate is parachuting in`);
  }
  return transition(next, 'TurnEnd');
}

/** Ends Resolving: records how it ended (a cap means the sim must detonate what is still live) and moves to TurnEnd. */
export function settleResolving(state: MatchState, reason: SettleReason, deps: MatchDeps): MatchState {
  const forceSettled = reason !== 'rest';
  const settled: MatchState = { ...state, settle: { forceSettled, reason, elapsedMs: state.timers.resolveElapsedMs } };
  const text = forceSettled ? `Force settled after ${state.timers.resolveElapsedMs} ms (${reason} cap)` : 'All bodies at rest';
  return enterTurnEnd(appendLog(settled, 'resolve', text, forceSettled), deps);
}

export function enterSuddenDeathCheck(state: MatchState, config: MatchConfig): MatchState {
  return transition(applySuddenDeathCheck(state, config), 'SuddenDeathCheck');
}

export function enterMatchEnd(state: MatchState): MatchState {
  const final = finalizeScores(state);
  const result = outcome(final);
  const text = result.kind === 'winner' ? `${final.teams.find((t) => t.id === result.teamId)?.name ?? result.teamId} wins` : 'Draw';
  return appendLog({ ...final, phase: 'MatchEnd', shot: null }, 'match.end', text);
}

/**
 * Rotation, wind roll and a clean slate for the new turn. Called by setup for the first turn
 * (with activeTeamIndex one before the starting team) and by the reducer after every
 * SuddenDeathCheck. No living worm anywhere ends the match instead.
 */
export function enterTurnStart(state: MatchState, deps: MatchDeps): MatchState {
  const selection = selectNextTurn(state.teams, state.activeTeamIndex);
  if (selection === null) return enterMatchEnd(state);
  const wrapped = state.turn > 0 && selection.teamIndex <= state.activeTeamIndex;
  const withSelection = updateTeam(state, selection.teamIndex, (team) => ({ ...team, activeWormIndex: selection.wormIndex }));
  const next: MatchState = {
    ...withSelection,
    phase: 'TurnStart',
    activeTeamIndex: selection.teamIndex,
    turn: state.turn + 1,
    round: wrapped ? state.round + 1 : state.round,
    wind: makeWindState(deps.rng.nextInt(WIND_STEP_MIN, WIND_STEP_MAX)),
    timers: { ...ZERO_TIMERS, turnRemainingMs: deps.config.turnMs },
    lastHitBy: {},
    shot: null,
    settle: null,
  };
  const team = activeTeamOf(next);
  const worm = team?.worms[selection.wormIndex];
  return appendLog(next, 'turn.start', `Turn ${next.turn}: ${team?.name ?? '?'}, ${worm?.name ?? '?'} (wind ${next.wind.step})`);
}
