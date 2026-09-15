/**
 * Client side validation of a CpuTurnResponse (architecture.md section F, ai/response-schema.ts).
 * The sidecar sanitizer is the server side guard; this is the browser's own check before it
 * drives the worm, so a malformed or hostile answer that somehow reaches the client is still
 * rejected. It clamps the same fields and returns a normalized response or a reason to fall back.
 */

import { clamp } from '../core/math.ts';
import { CPU_ANGLE_MAX_DEG, CPU_ANGLE_MIN_DEG, CPU_CONFIDENCE_FLOOR, CPU_MOVE_MAX_MS, CPU_POWER_MAX, CPU_POWER_MIN, CPU_TAUNT_MAX_CHARS, CPU_TURN_SCHEMA, type CpuTurnResponse } from './contract.ts';
import type { WeaponId } from '../weapons/types.ts';

export interface ValidWeapon {
  readonly id: WeaponId;
  readonly requiresTargetSelect: boolean;
  readonly fuseOptionsMs: readonly number[] | null;
  readonly hasAmmo: boolean;
}

export type ValidateResult = { readonly ok: true; readonly value: CpuTurnResponse } | { readonly ok: false; readonly reason: string };

type Rec = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function snapFuse(raw: unknown, options: readonly number[]): number | undefined {
  const n = finite(raw);
  if (n === null || options.length === 0) return options[0];
  return options.reduce((best, option) => (Math.abs(option - n) < Math.abs(best - n) ? option : best), options[0]!);
}

function printable(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}

/** Validates and clamps a raw response against the weapon the active worm may fire. */
export function validateResponse(raw: unknown, weapons: ReadonlyMap<string, ValidWeapon>, world: { readonly w: number; readonly h: number }, nearestEnemyX: number | null): ValidateResult {
  if (!isRecord(raw)) return { ok: false, reason: 'response is not an object' };
  const weaponId = raw['weapon'];
  const weapon = typeof weaponId === 'string' ? weapons.get(weaponId) : undefined;
  if (weapon === undefined) return { ok: false, reason: `weapon ${String(weaponId)} is not available` };
  if (!weapon.hasAmmo) return { ok: false, reason: `weapon ${weapon.id} has no ammo` };
  const confidence = clamp(finite(raw['confidence']) ?? 0, 0, 1);
  if (confidence < CPU_CONFIDENCE_FLOOR) return { ok: false, reason: `confidence ${confidence} below the ${CPU_CONFIDENCE_FLOOR} floor` };
  const angle = finite(raw['aimAngleDeg']);
  if (angle === null) return { ok: false, reason: 'aimAngleDeg is not a number' };
  const power = finite(raw['power']);
  if (power === null) return { ok: false, reason: 'power is not a number' };
  const move = isRecord(raw['move']) ? raw['move'] : {};
  const direction = move['direction'] === 'left' || move['direction'] === 'right' ? move['direction'] : 'none';
  const durationMs = clamp(finite(move['durationMs']) ?? 0, 0, CPU_MOVE_MAX_MS);
  const facing = raw['facing'] === 'left' || raw['facing'] === 'right' ? raw['facing'] : nearestEnemyX !== null && nearestEnemyX < 0 ? 'left' : 'right';
  let targetPoint: { x: number; y: number } | undefined;
  if (weapon.requiresTargetSelect) {
    const tp = raw['targetPoint'];
    if (!isRecord(tp) || finite(tp['x']) === null || finite(tp['y']) === null) return { ok: false, reason: `targetPoint required for ${weapon.id}` };
    targetPoint = { x: clamp(tp['x'] as number, 0, world.w), y: clamp(tp['y'] as number, 0, world.h) };
  }
  const fuseMs = weapon.fuseOptionsMs !== null ? snapFuse(raw['fuseMs'], weapon.fuseOptionsMs) : undefined;
  return {
    ok: true,
    value: {
      schema: CPU_TURN_SCHEMA,
      weapon: weapon.id,
      aimAngleDeg: clamp(angle, CPU_ANGLE_MIN_DEG, CPU_ANGLE_MAX_DEG),
      power: Math.round(clamp(power, CPU_POWER_MIN, CPU_POWER_MAX)),
      facing,
      move: { direction, durationMs: Math.round(durationMs) },
      ...(fuseMs === undefined ? {} : { fuseMs }),
      ...(targetPoint === undefined ? {} : { targetPoint }),
      taunt: printable(raw['taunt'], CPU_TAUNT_MAX_CHARS),
      confidence,
      reasoning: printable(raw['reasoning'], 200),
    },
  };
}
