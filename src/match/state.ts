/**
 * Match ledger (architecture.md section E, reconciled to ultraplan.html rev 2).
 *
 * Physics bodies are pooled and mutated inside the tick loop. MatchState is the immutable ledger
 * rebuilt by the pure reducer in match/machine.ts at phase boundaries. Wind is a discrete step
 * index (21 steps, -10..10) plus a derived fraction of gravity; the hot seat and the resolve
 * inactivity timers live here so the state machine can enforce the caps of the tuning card.
 */

import type { WeaponId } from '../weapons/types.ts';
import type { CpuDifficulty, CpuPersonality } from '../ai/contract.ts';
import type { Size } from '../config/constants.ts';
import { GAME_CONFIG } from '../config/game-config.ts';

export const MATCH_PHASES = [
  'TurnStart',
  'HotSeat',
  'Active',
  'Firing',
  'Retreat',
  'Resolving',
  'TurnEnd',
  'SuddenDeathCheck',
  'MatchEnd',
] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export const WIND_STEP_MIN = -10;
export const WIND_STEP_MAX = 10;
export const WIND_STEP_COUNT = WIND_STEP_MAX - WIND_STEP_MIN + 1;

export interface WindState {
  /** Integer -10..10, positive blows right. Rerolled every turn. */
  readonly step: number;
  /** Force on a bazooka shell as a fraction of gravity: step 10 is 1.19, step -10 is -1.19. */
  readonly fraction: number;
}

export function clampWindStep(step: number): number {
  return Math.min(WIND_STEP_MAX, Math.max(WIND_STEP_MIN, Math.round(step)));
}

export function windFractionFromStep(step: number): number {
  return (clampWindStep(step) / WIND_STEP_MAX) * GAME_CONFIG.wind.maxFractionOfGravity;
}

export function makeWindState(step: number): WindState {
  const clamped = clampWindStep(step);
  return Object.freeze({ step: clamped, fraction: windFractionFromStep(clamped) });
}

export type TeamColorIndex = 0 | 1 | 2 | 3;
export type TeamController = 'human' | 'cpu';
/** Voice bank id, validated against the audio manifest. */
export type VoiceId = string;

export interface CpuTeamSettings {
  readonly difficulty: CpuDifficulty;
  readonly personality: CpuPersonality;
}

export interface WormState {
  readonly id: string;
  /** At most 16 printable characters (security requirements). */
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  /** Snapshot of the body position at the last phase boundary, world px. */
  readonly x: number;
  readonly y: number;
  /** Personal inventory; -1 means infinite. */
  readonly ammo: Readonly<Record<WeaponId, number>>;
}

export interface TeamScore {
  readonly damageDealt: number;
  readonly selfDamage: number;
  readonly kills: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly bestShot: number;
  readonly points: number;
}

export interface TeamState {
  readonly id: string;
  /** At most 16 printable characters (security requirements). */
  readonly name: string;
  readonly colorIndex: TeamColorIndex;
  readonly controller: TeamController;
  readonly cpu?: CpuTeamSettings;
  readonly worms: readonly WormState[];
  readonly activeWormIndex: number;
  readonly score: TeamScore;
  readonly voice: VoiceId;
}

/** Countdowns and elapsed clocks the reducer advances, all in ms. */
export interface MatchTimers {
  readonly turnRemainingMs: number;
  /** HotSeat phase countdown (config hotSeatMs). */
  readonly hotSeatRemainingMs: number;
  readonly retreatRemainingMs: number;
  /** Time in Resolving since entry; force settle at config resolve.absoluteMs. */
  readonly resolveElapsedMs: number;
  /**
   * Time in Resolving since the last bounce, carve, damage event or spawn; force settle at
   * config resolve.inactivityMs. Controlled descents (parachute, jetpack) do not advance it.
   */
  readonly resolveInactiveMs: number;
}

/** One line of the match log ring (capped at MATCH_LOG_CAP entries). */
export interface MatchLogEntry {
  readonly turn: number;
  readonly kind: string;
  readonly text: string;
  /** Set on 'resolve' entries: true when a cap ended the Resolving phase instead of rest. */
  readonly forceSettled?: boolean;
}

export const MATCH_LOG_CAP = 200;

export const CRATE_TYPES = ['weapon', 'health', 'utility'] as const;
export type CrateType = (typeof CRATE_TYPES)[number];

/**
 * The shot window: opened by FireStarted, closed by the next FireStarted or at TurnEnd. Enemy
 * damage dealt inside the window feeds shotsHit and bestShot; shotsRemaining tells Firing
 * whether to return to Active (shotgun, longbow) or to open the retreat.
 */
export interface ShotState {
  readonly weaponId: WeaponId;
  readonly shotsRemaining: number;
  readonly damage: number;
}

export type DeathCause = 'killed' | 'drowned';

/**
 * A worm at 0 hp waits here until TurnEnd, when it dies (Worms rule: worms at 0 hp explode
 * between turns, one at a time). Drowning is instant and never queues.
 */
export interface PendingDeath {
  readonly wormId: string;
  readonly cause: DeathCause;
  /** Team credited with the kill; null for self kills and environmental deaths. */
  readonly creditTeamId: string | null;
}

export type SettleReason = 'rest' | 'inactivity' | 'absolute';

/**
 * How the last Resolving phase ended. forceSettled true means a cap fired: the sim must detonate
 * every live projectile and animal before TurnEnd reads the ledger (tuning card semantics).
 */
export interface SettleOutcome {
  readonly forceSettled: boolean;
  readonly reason: SettleReason;
  readonly elapsedMs: number;
}

export interface MatchState {
  readonly phase: MatchPhase;
  readonly seed: number;
  readonly round: number;
  readonly turn: number;
  readonly activeTeamIndex: number;
  readonly teams: readonly TeamState[];
  readonly wind: WindState;
  readonly waterY: number;
  readonly suddenDeath: boolean;
  /** Wall clock of the round; sudden death starts at config roundMs. */
  readonly roundElapsedMs: number;
  readonly timers: MatchTimers;
  readonly log: readonly MatchLogEntry[];
  /** World size in world px, validated by setup against config/constants bounds. */
  readonly world: Size;
  /** Crates landed on the map and not yet picked up or destroyed. */
  readonly cratesOnMap: number;
  /** Crate rolled at TurnEnd that the sim still has to drop; CrateLanded clears it. */
  readonly crateDrop: CrateType | null;
  /** Completed turns since the last scheduled supply drop; retained while the map is full. */
  readonly turnsSinceCrateDrop: number;
  readonly pendingDeaths: readonly PendingDeath[];
  /** wormId to the team that damaged it last this turn, for kill credit; cleared at TurnStart. */
  readonly lastHitBy: Readonly<Record<string, string>>;
  readonly shot: ShotState | null;
  readonly settle: SettleOutcome | null;
}
