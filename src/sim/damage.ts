/**
 * Damage math (architecture.md section C and the reconciled constants of ultraplan rev 2):
 * linear blast falloff, knockback away from the blast center, and the canonical fall damage
 * formula DAMAGE = INT(((VSPEED - 8 + 1/65536) * 50 + 18) / 18) with VSPEED in source px per
 * frame (max 67 at the terminal 32). Pure functions.
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import { SOURCE_HZ } from '../config/units.ts';
import { clamp, vec2, type Vec2 } from '../core/math.ts';
import { KNOCKBACK_SCALE } from './constants.ts';

export function falloff(distance: number, radius: number): number {
  if (radius <= 0) return distance <= 0 ? 1 : 0;
  return clamp(1 - distance / radius, 0, 1);
}

export function blastDamage(maxDamage: number, distance: number, radius: number): number {
  return Math.round(maxDamage * falloff(distance, radius));
}

/** Velocity change for a body at `at` from a blast at `center`; straight up when they coincide. */
export function knockbackVelocity(center: Vec2, at: Vec2, knockback: number, radius: number): Vec2 {
  const dx = at.x - center.x;
  const dy = at.y - center.y;
  const distance = Math.hypot(dx, dy);
  const magnitude = knockback * KNOCKBACK_SCALE * falloff(distance, radius);
  if (magnitude <= 0) return vec2(0, 0);
  if (distance === 0) return vec2(0, -magnitude);
  return vec2((dx / distance) * magnitude, (dy / distance) * magnitude);
}

/** px per second (world) to source px per frame at 50 fps. */
export function toSourcePxPerFrame(pxPerSecond: number): number {
  return pxPerSecond / SOURCE_HZ;
}

/** The canonical formula, 0 below the threshold, capped at the terminal speed. */
export function fallDamage(landingSpeedPxPerSecond: number): number {
  const { thresholdPxPerFrame, terminalPxPerFrame, coefficient, epsilon, max } = GAME_CONFIG.fallDamage;
  const vspeed = Math.min(terminalPxPerFrame, toSourcePxPerFrame(Math.abs(landingSpeedPxPerSecond)));
  if (vspeed <= thresholdPxPerFrame) return 0;
  const damage = Math.floor(((vspeed - thresholdPxPerFrame + epsilon) * coefficient + 18) / 18);
  return Math.min(max, Math.max(0, damage));
}
