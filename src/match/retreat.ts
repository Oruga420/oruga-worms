/**
 * Retreat window after the last shot of a turn (tuning card: 3 s on the ground, 5 s on a
 * controlled descent; prior-art.md Part B: Dynamite and Mine always give at least 5 s, Teleport
 * and Skip Go end the turn at once).
 *
 * The per weapon rules live in a small table here because src/weapons is in flight. Phase 2.3
 * replaces RETREAT_RULES with WeaponDef.retreatMs from the registry; retreatMsFor keeps its
 * signature so the reducer does not change.
 */

import type { WeaponId } from '../weapons/types.ts';
import type { MatchConfig } from './deps.ts';
import type { MatchTimers } from './state.ts';

export interface RetreatRule {
  /** Floor on the window: the ground or air value applies when it is longer. */
  readonly minMs?: number;
  /** Exact window, overriding everything; 0 ends the turn without a retreat. */
  readonly fixedMs?: number;
}

/** "Dynamite and Mine always give at least 5 s" (prior-art.md Part B, scheme table). */
export const PLACED_WEAPON_MIN_RETREAT_MS = 5_000;

export const RETREAT_RULES: Readonly<Partial<Record<WeaponId, RetreatRule>>> = Object.freeze({
  dynamite: Object.freeze({ minMs: PLACED_WEAPON_MIN_RETREAT_MS }),
  mine: Object.freeze({ minMs: PLACED_WEAPON_MIN_RETREAT_MS }),
  teleport: Object.freeze({ fixedMs: 0 }),
  skip_go: Object.freeze({ fixedMs: 0 }),
});

export function retreatMsFor(weaponId: WeaponId, config: MatchConfig, airborne = false): number {
  const rule = RETREAT_RULES[weaponId];
  if (rule?.fixedMs !== undefined) return rule.fixedMs;
  const base = airborne ? config.retreatAirMs : config.retreatGroundMs;
  return rule?.minMs !== undefined ? Math.max(base, rule.minMs) : base;
}

export function startRetreat(timers: MatchTimers, ms: number): MatchTimers {
  return { ...timers, retreatRemainingMs: Math.max(0, ms) };
}

export function tickRetreat(timers: MatchTimers, dtMs: number): MatchTimers {
  return { ...timers, retreatRemainingMs: Math.max(0, timers.retreatRemainingMs - dtMs) };
}

export function retreatExpired(timers: MatchTimers): boolean {
  return timers.retreatRemainingMs <= 0;
}
