/**
 * TimerTick handling per phase. The round clock advances on every tick in every phase; the
 * phase clocks are: HotSeat countdown, Active turn timer (Firing keeps counting it down for the
 * shotgun's second barrel but never expires it), Retreat countdown, and the two Resolving caps
 * of the tuning card: inactivity (8 s, reset by activity, paused on controlled descents) and
 * the absolute ceiling (45 s). A cap firing force settles the turn.
 */

import type { MatchDeps } from './deps.ts';
import type { TimerTickEvent } from './events.ts';
import { withTimers } from './ledger.ts';
import { enterActive, enterResolving, leaveTurn, settleResolving } from './machine-phases.ts';
import { retreatExpired, tickRetreat } from './retreat.ts';
import type { MatchState } from './state.ts';

export function onTimerTick(state: MatchState, event: TimerTickEvent, deps: MatchDeps): MatchState {
  if (!Number.isFinite(event.dtMs) || event.dtMs < 0) return state;
  const dt = event.dtMs;
  const clocked: MatchState = { ...state, roundElapsedMs: state.roundElapsedMs + dt };
  switch (clocked.phase) {
    case 'HotSeat':
      return tickHotSeat(clocked, dt, deps);
    case 'Active':
      return tickActive(clocked, dt);
    case 'Firing':
      return withTimers(clocked, { turnRemainingMs: Math.max(0, clocked.timers.turnRemainingMs - dt) });
    case 'Retreat':
      return tickRetreatPhase(clocked, dt);
    case 'Resolving':
      return tickResolving(clocked, dt, event.controlledDescent === true, deps);
    default:
      return clocked;
  }
}

function tickHotSeat(state: MatchState, dt: number, deps: MatchDeps): MatchState {
  const remaining = Math.max(0, state.timers.hotSeatRemainingMs - dt);
  const next = withTimers(state, { hotSeatRemainingMs: remaining });
  return remaining === 0 ? enterActive(next, deps.config, true) : next;
}

function tickActive(state: MatchState, dt: number): MatchState {
  const remaining = Math.max(0, state.timers.turnRemainingMs - dt);
  const next = withTimers(state, { turnRemainingMs: remaining });
  return remaining === 0 ? leaveTurn(next, 'turn.timeout', 'Turn timer expired') : next;
}

function tickRetreatPhase(state: MatchState, dt: number): MatchState {
  const timers = tickRetreat(state.timers, dt);
  const next: MatchState = { ...state, timers };
  return retreatExpired(timers) ? enterResolving(next) : next;
}

function tickResolving(state: MatchState, dt: number, controlledDescent: boolean, deps: MatchDeps): MatchState {
  const elapsed = state.timers.resolveElapsedMs + dt;
  const inactive = controlledDescent ? state.timers.resolveInactiveMs : state.timers.resolveInactiveMs + dt;
  const next = withTimers(state, { resolveElapsedMs: elapsed, resolveInactiveMs: inactive });
  if (elapsed >= deps.config.resolve.absoluteMs) return settleResolving(next, 'absolute', deps);
  if (inactive >= deps.config.resolve.inactivityMs) return settleResolving(next, 'inactivity', deps);
  return next;
}
