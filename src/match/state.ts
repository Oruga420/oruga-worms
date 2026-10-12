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
  /** Own turn ends to pass before the worm may use a super again (match/super-rest.ts); 0 when it may. */
  readonly superRest: number;
  /**
   * Own turns started, the current one included. The scheme delays (WeaponDef.delayTurns) count
   * these, so every worm waits its own opening turn before its supers, techniques, seed, air
   * strike and jetpack open, however far into the match it first comes up.
   */
  readonly turns: number;
  /** Own upcoming turns time_stop still owes this worm (match/turn.ts): each one is auto skipped and decremented. */
  readonly frozenTurns: number;
  /** force_field's damage buffer; 0 means no shield up. Absorbs ordinary damage up to this, and blocks one execute outright. */
  readonly shieldDurability: number;
  /** The shield clears once this worm's own `turns` passes this value (set to turns + ownTurns at cast). */
  readonly shieldExpiresAtOwnTurn: number;
  /** >0 only on the one worm holding the match's unique immortality pickup; each charge survives one lethal attack at 1 hp. */
  readonly immortalityCharges: number;
  /** Dedup key of the last attack a shield or immortality charge intercepted, so one multi pellet shot cannot burn more than one. */
  readonly lastProtectedAttack: string | null;
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

/** 'immortality' is the unique once a match pickup (room.ts and machine.ts onCratePicked): never rolled again once claimed. */
export const CRATE_TYPES = ['weapon', 'health', 'utility', 'power', 'immortality'] as const;
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

/**
 * A worm sealed by the Tesoro del Cielo (match/seals.ts): its team loses its next turns, a strike of
 * the treasure each, until no strike is left (the last one kills it), or until the caster or the
 * sealed worm dies first and the seal breaks.
 */
export interface Seal {
  readonly weaponId: WeaponId;
  readonly casterId: string;
  readonly casterTeamId: string;
  readonly targetId: string;
  readonly targetTeamId: string;
  /** Strikes in all, and strikes still to come. */
  readonly hits: number;
  readonly hitsLeft: number;
  /** What each strike costs the caster, hp. */
  readonly hitToll: number;
}

/** A strike of the treasure on a turn the ledger took from the sealed team: the controller plays it in the sim. */
export interface SealStrike {
  readonly weaponId: WeaponId;
  readonly casterId: string;
  readonly casterTeamId: string;
  readonly targetId: string;
  /** Which strike, from 1, and whether it is the last (it kills). */
  readonly hit: number;
  readonly fatal: boolean;
  readonly hitToll: number;
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
  /** Bumped by every accepted FireStarted: a stable identity for one shot, so a multi pellet burst never spends more than one shield break or immortality charge (match/machine.ts attackKey). */
  readonly attackSeq: number;
  readonly settle: SettleOutcome | null;
  /** Worms the Tesoro del Cielo has sealed, still taking their teams' turns. */
  readonly seals: readonly Seal[];
  /** The strikes the ledger took this turn for (a sealed team's lost turn); cleared at the next TurnStart. */
  readonly strikes: readonly SealStrike[];
  /** True the instant the immortality crate is ever rolled (not only once picked up): it is unique, so none rolls again, landed, uncollected or destroyed. */
  readonly immortalityEverDropped: boolean;
  /** Claim guard independent of the spawn gate; older fixtures without it mean not yet claimed. */
  readonly immortalityClaimed?: boolean;
}
