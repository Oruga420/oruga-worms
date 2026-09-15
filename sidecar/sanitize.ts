/**
 * Never trust the model (architecture.md section F, corrected by ultraplan.html rev 2).
 *
 * The sanitizer table, as pure functions over a small weapon info map so it runs in the sidecar
 * and in the browser without the full registry:
 *
 *   weapon           must exist and have ammo, else reject the whole response
 *   aimAngleDeg      clamp to [-90, 90]
 *   power            integer, clamp to [0, 100]
 *   move.durationMs  integer, clamp to [0, min(3000, active.maxWalkMs)]: the movement budget the worm has left
 *   fuseMs           snap to the nearest legal option, or drop when the weapon has no fuse
 *   targetPoint      clamp to the world; required when the weapon selects a target, else dropped
 *   facing           left or right, else derived from the nearest enemy
 *   taunt            60 printable characters, control and format characters stripped
 *   confidence       clamp to [0, 1]; below 0.35 the response is rejected
 *
 * Any rejection means the deterministic heuristic plays, so the model can never make the CPU
 * play worse than the heuristic floor.
 */

import {
  CPU_ANGLE_MAX_DEG,
  CPU_ANGLE_MIN_DEG,
  CPU_CONFIDENCE_FLOOR,
  CPU_MOVE_MAX_MS,
  CPU_POWER_MAX,
  CPU_POWER_MIN,
  CPU_REASONING_MAX_CHARS,
  CPU_TAUNT_MAX_CHARS,
  CPU_TURN_SCHEMA,
  type CpuFacing,
  type CpuMove,
  type CpuMoveDirection,
  type CpuTurnResponse,
} from '../src/ai/contract.ts';
import type { WeaponId } from '../src/weapons/types.ts';

export interface SanitizeWeaponInfo {
  readonly id: string;
  readonly requiresTargetSelect: boolean;
  /** Legal fuse settings, or null when the weapon has no fuse. */
  readonly fuseOptionsMs: readonly number[] | null;
  readonly fuseDefaultMs: number | null;
}

export interface SanitizeContext {
  readonly weapons: Readonly<Record<string, SanitizeWeaponInfo>>;
  /** Active team ledger: -1 infinite, 0 or missing means none. */
  readonly ammo: Readonly<Record<string, number>>;
  /** Longest walk the sim will honour this turn, ms; move.durationMs is clamped to it. */
  readonly maxWalkMs: number;
  readonly world: { readonly w: number; readonly h: number };
  readonly activeX: number;
  readonly enemies: readonly { readonly x: number }[];
}

export type SanitizeResult =
  | { readonly ok: true; readonly value: CpuTurnResponse }
  | { readonly ok: false; readonly fallback: true; readonly reason: string };

export type WeaponCheck =
  | { readonly ok: true; readonly weapon: SanitizeWeaponInfo }
  | { readonly ok: false; readonly reason: string };

const MOVE_DIRECTIONS: ReadonlySet<string> = new Set<CpuMoveDirection>(['left', 'right', 'none']);
const FACINGS: ReadonlySet<string> = new Set<CpuFacing>(['left', 'right']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Finite number from a number or a numeric string, else null. */
export function toFinite(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeWeapon(raw: unknown, ctx: SanitizeContext): WeaponCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'weapon is not a string' };
  const weapon = ctx.weapons[raw];
  if (weapon === undefined) return { ok: false, reason: `weapon ${raw} does not exist` };
  const ammo = ctx.ammo[raw] ?? 0;
  if (ammo !== -1 && ammo <= 0) return { ok: false, reason: `weapon ${raw} has no ammo` };
  return { ok: true, weapon };
}

export function clampAngle(angleDeg: number): number {
  return clamp(angleDeg, CPU_ANGLE_MIN_DEG, CPU_ANGLE_MAX_DEG);
}

export function clampPower(power: number): number {
  return Math.round(clamp(power, CPU_POWER_MIN, CPU_POWER_MAX));
}

export function clampMoveDuration(durationMs: number): number {
  return Math.round(clamp(durationMs, 0, CPU_MOVE_MAX_MS));
}

export function clampConfidence(confidence: number): number {
  return clamp(confidence, 0, 1);
}

/**
 * maxWalkMs is the movement budget the worm has left (active.maxWalkMs in the request); the
 * walk is clamped to the smaller of it and the contract cap, so the sim never truncates a plan
 * the model was allowed to make (backlog 4.4).
 */
export function sanitizeMove(raw: unknown, maxWalkMs: number = CPU_MOVE_MAX_MS): CpuMove {
  if (!isRecord(raw)) return Object.freeze({ direction: 'none', durationMs: 0 });
  const direction = typeof raw['direction'] === 'string' && MOVE_DIRECTIONS.has(raw['direction'])
    ? (raw['direction'] as CpuMoveDirection)
    : 'none';
  const duration = toFinite(raw['durationMs']);
  const cap = Number.isFinite(maxWalkMs) ? Math.max(0, Math.min(CPU_MOVE_MAX_MS, maxWalkMs)) : CPU_MOVE_MAX_MS;
  const durationMs = direction === 'none' || duration === null ? 0 : Math.min(cap, clampMoveDuration(duration));
  return Object.freeze({ direction, durationMs });
}

/** Nearest legal option (ties go to the lower option); the default when absent; undefined when the weapon has no fuse. */
export function snapFuse(raw: unknown, weapon: SanitizeWeaponInfo): number | undefined {
  const options = weapon.fuseOptionsMs;
  if (options === null || options.length === 0) return undefined;
  const wanted = toFinite(raw);
  if (wanted === null) return weapon.fuseDefaultMs ?? options[0];
  return options.reduce((best, option) =>
    Math.abs(option - wanted) < Math.abs(best - wanted) ? option : best,
  );
}

export function clampTargetPoint(
  raw: unknown,
  world: SanitizeContext['world'],
): { readonly x: number; readonly y: number } | null {
  if (!isRecord(raw)) return null;
  const x = toFinite(raw['x']);
  const y = toFinite(raw['y']);
  if (x === null || y === null) return null;
  return Object.freeze({ x: clamp(x, 0, world.w), y: clamp(y, 0, world.h) });
}

export function sanitizeFacing(raw: unknown, activeX: number, enemies: SanitizeContext['enemies']): CpuFacing {
  if (typeof raw === 'string' && FACINGS.has(raw)) return raw as CpuFacing;
  const nearest = enemies.reduce<{ readonly x: number } | null>(
    (best, enemy) => (best === null || Math.abs(enemy.x - activeX) < Math.abs(best.x - activeX) ? enemy : best),
    null,
  );
  return nearest !== null && nearest.x < activeX ? 'left' : 'right';
}

/** Strips control, format, surrogate and private use characters, collapses whitespace, cuts to maxChars code points. */
export function sanitizeText(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') return '';
  const printable = raw.replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(printable).slice(0, maxChars).join('');
}

export function sanitizeTaunt(raw: unknown): string {
  return sanitizeText(raw, CPU_TAUNT_MAX_CHARS);
}

export function sanitizeReasoning(raw: unknown): string {
  return sanitizeText(raw, CPU_REASONING_MAX_CHARS);
}

function reject(reason: string): SanitizeResult {
  return Object.freeze({ ok: false as const, fallback: true as const, reason });
}

/** Applies the whole table. The returned response is frozen and carries the current schema. */
export function sanitizeCpuTurn(raw: unknown, ctx: SanitizeContext): SanitizeResult {
  if (!isRecord(raw)) return reject('response is not an object');

  const weapon = sanitizeWeapon(raw['weapon'], ctx);
  if (!weapon.ok) return reject(weapon.reason);

  const angle = toFinite(raw['aimAngleDeg']);
  if (angle === null) return reject('aimAngleDeg is not a number');

  const power = toFinite(raw['power']);
  if (power === null) return reject('power is not a number');

  const confidence = clampConfidence(toFinite(raw['confidence']) ?? 0);
  if (confidence < CPU_CONFIDENCE_FLOOR) {
    return reject(`confidence ${confidence} is below the ${CPU_CONFIDENCE_FLOOR} floor`);
  }

  const fuseMs = snapFuse(raw['fuseMs'], weapon.weapon);
  const targetPoint = weapon.weapon.requiresTargetSelect ? clampTargetPoint(raw['targetPoint'], ctx.world) : null;
  if (weapon.weapon.requiresTargetSelect && targetPoint === null) {
    return reject(`targetPoint is required for ${weapon.weapon.id}`);
  }

  const response: CpuTurnResponse = {
    schema: CPU_TURN_SCHEMA,
    // The id was looked up in the registry map above; the registry validates ids at boot.
    weapon: weapon.weapon.id as WeaponId,
    aimAngleDeg: clampAngle(angle),
    power: clampPower(power),
    facing: sanitizeFacing(raw['facing'], ctx.activeX, ctx.enemies),
    move: sanitizeMove(raw['move'], ctx.maxWalkMs),
    ...(fuseMs === undefined ? {} : { fuseMs }),
    ...(targetPoint === null ? {} : { targetPoint }),
    taunt: sanitizeTaunt(raw['taunt']),
    confidence,
    reasoning: sanitizeReasoning(raw['reasoning']),
  };
  return Object.freeze({ ok: true as const, value: Object.freeze(response) });
}
