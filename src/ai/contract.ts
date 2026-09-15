/**
 * CPU turn contract between the browser and the sidecar (architecture.md section F, corrected
 * by ultraplan.html rev 2: schema cpu-turn/2, power is an INTEGER 0 to 100 because the C5 smoke
 * returned 68 where 0..1 was expected, and the health response names the backend).
 *
 * The browser POSTs a CpuTurnRequest to /api/cpu-turn and receives either a sanitized
 * CpuTurnResponse or a CpuTurnFallback; any fallback means the deterministic heuristic plays.
 * Every user string in the request (team and worm names, last turn summary) is untrusted and is
 * placed by the prompt builder in a delimited data block.
 */

import type { WeaponId } from '../weapons/types.ts';

export const CPU_TURN_SCHEMA = 'cpu-turn/2' as const;
export type CpuTurnSchema = typeof CPU_TURN_SCHEMA;

export const CPU_BACKENDS = ['api', 'cli', 'off'] as const;
export type CpuBackend = (typeof CPU_BACKENDS)[number];

export type CpuDifficulty = 'easy' | 'normal' | 'hard';
export type CpuPersonality = 'aggressive' | 'cautious' | 'chaotic' | 'sniper';
export type CpuFacing = 'left' | 'right';
export type CpuMoveDirection = 'left' | 'right' | 'none';

/** Team and worm names are cut to this many printable characters before they reach a prompt. */
export const CPU_NAME_MAX_CHARS = 16;
export const CPU_TAUNT_MAX_CHARS = 60;
export const CPU_REASONING_MAX_CHARS = 200;
export const CPU_ANGLE_MIN_DEG = -90;
export const CPU_ANGLE_MAX_DEG = 90;
export const CPU_POWER_MIN = 0;
export const CPU_POWER_MAX = 100;
export const CPU_MOVE_MAX_MS = 3000;
/** Below this confidence the response is discarded and the heuristic plays. */
export const CPU_CONFIDENCE_FLOOR = 0.35;

export interface CpuWorm {
  readonly id: string;
  readonly team: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
}

export interface CpuTurnRequest {
  readonly schema: CpuTurnSchema;
  readonly matchId: string;
  readonly turn: number;
  readonly difficulty: CpuDifficulty;
  readonly personality: CpuPersonality;

  /** Discrete wind step, -10..10, positive is right. */
  readonly windStep: number;
  /** windStep / 10, so -1..1, positive is right. */
  readonly wind: number;
  /** World px per second squared. */
  readonly gravity: number;
  readonly waterY: number;
  readonly world: { readonly w: number; readonly h: number };

  readonly active: {
    readonly wormId: string;
    readonly team: string;
    readonly x: number;
    readonly y: number;
    readonly hp: number;
    readonly canMoveLeft: boolean;
    readonly canMoveRight: boolean;
    /**
     * Longest walk the sim will honour this turn, ms at walking speed, never above CPU_MOVE_MAX_MS.
     * Derived from the movement budget the worm has left; the sanitizer clamps move.durationMs to it.
     */
    readonly maxWalkMs: number;
  };

  readonly allies: readonly CpuWorm[];
  readonly enemies: readonly CpuWorm[];
  /** Only weapons with ammo left; count -1 means infinite. */
  readonly ammo: readonly { readonly weapon: WeaponId; readonly count: number }[];

  readonly terrain: {
    /** About 64 sampled surface heights, left to right. */
    readonly profile: readonly number[];
    readonly sampleStepPx: number;
  };

  readonly lineOfSight: readonly {
    readonly targetWormId: string;
    readonly clear: boolean;
    readonly distancePx: number;
    readonly bearingDeg: number;
  }[];

  /** "missed left by 40px, wind was 4 right". Untrusted text. */
  readonly lastTurnSummary?: string;
}

export interface CpuMove {
  readonly direction: CpuMoveDirection;
  /** 0..3000. */
  readonly durationMs: number;
}

export interface CpuTurnResponse {
  readonly schema: CpuTurnSchema;
  /** Must exist in the registry and have ammo for the active team. */
  readonly weapon: WeaponId;
  /** -90..90, positive is up. */
  readonly aimAngleDeg: number;
  /** INTEGER 0..100 percent of full charge. The executor quantizes it to its charge steps. */
  readonly power: number;
  readonly facing: CpuFacing;
  readonly move: CpuMove;
  /** TIMED weapons only, snapped to a legal fuse option. */
  readonly fuseMs?: number;
  /** TARGETED weapons and teleport, clamped to the world. */
  readonly targetPoint?: { readonly x: number; readonly y: number };
  /** At most 60 printable characters, drawn as canvas text only. */
  readonly taunt: string;
  /** 0..1; below CPU_CONFIDENCE_FLOOR the heuristic plays. */
  readonly confidence: number;
  /** At most 200 characters, dev overlay only. */
  readonly reasoning: string;
}

/** Returned with HTTP 502 or 503 when the model output was rejected or no backend is active. */
export interface CpuTurnFallback {
  readonly fallback: true;
  readonly reason: string;
}

export type CpuTurnHttpResponse = CpuTurnResponse | CpuTurnFallback;

/** GET /api/cpu-turn/health, probed once per match with a 500 ms timeout. */
export interface CpuHealthResponse {
  readonly ok: true;
  readonly schema: CpuTurnSchema;
  readonly backend: CpuBackend;
}
