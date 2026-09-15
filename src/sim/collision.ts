/**
 * Collision against the terrain mask (architecture.md section C): a ray march in steps of at
 * most 1 px that never lets a fast body tunnel through a thin ledge, and the surface normal from
 * the mask gradient for bounces. Pure functions over the mask; no canvas, no readback.
 */

import { normalize, vec2, type Vec2 } from '../core/math.ts';
import { isSolid } from '../terrain/queries.ts';
import { surfaceNormal } from '../terrain/queries.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import { MAX_SWEEP_STEPS, SWEEP_STEP_PX } from './constants.ts';

export interface Hit {
  /** Last free position before the solid pixel. */
  readonly x: number;
  readonly y: number;
  /** Solid pixel that stopped the march. */
  readonly solidX: number;
  readonly solidY: number;
  /** Unit normal pointing out of the surface toward the free side. */
  readonly normal: Vec2;
  /** Fraction of the requested move that was completed, 0..1. */
  readonly t: number;
}

export interface SweepResult {
  readonly x: number;
  readonly y: number;
  readonly hit: Hit | null;
}

/** True when any pixel in the disc of radius r around (x, y) is solid; r 0 checks one pixel. */
export function discBlocked(mask: TerrainMask, x: number, y: number, r: number): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (r <= 0) return isSolid(mask, cx, cy);
  const ir = Math.ceil(r);
  for (let dy = -ir; dy <= ir; dy += 1) {
    for (let dx = -ir; dx <= ir; dx += 1) {
      if (dx * dx + dy * dy <= r * r && isSolid(mask, cx + dx, cy + dy)) return true;
    }
  }
  return false;
}

function normalAt(mask: TerrainMask, solidX: number, solidY: number, dx: number, dy: number): Vec2 {
  const n = surfaceNormal(mask, solidX, solidY);
  if (n.x !== 0 || n.y !== 0) return normalize(n);
  const len = Math.hypot(dx, dy);
  return len === 0 ? vec2(0, -1) : vec2(-dx / len, -dy / len);
}

/**
 * Marches a body of radius r from (x0, y0) toward (x1, y1) in steps of at most SWEEP_STEP_PX and
 * stops at the last free position before a solid pixel. Returns where the body ends up and the
 * hit, if any.
 */
export function sweep(mask: TerrainMask, x0: number, y0: number, x1: number, y1: number, r = 0): SweepResult {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: x0, y: y0, hit: null };
  const steps = Math.min(MAX_SWEEP_STEPS, Math.max(1, Math.ceil(dist / SWEEP_STEP_PX)));
  let freeX = x0;
  let freeY = y0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    if (discBlocked(mask, x, y, r)) {
      const solidX = Math.round(x);
      const solidY = Math.round(y);
      return { x: freeX, y: freeY, hit: { x: freeX, y: freeY, solidX, solidY, normal: normalAt(mask, solidX, solidY, dx, dy), t: (i - 1) / steps } };
    }
    freeX = x;
    freeY = y;
  }
  return { x: x1, y: y1, hit: null };
}

/** True when the pixel just below (x, y) is solid: a body standing on it is grounded. */
export function groundBelow(mask: TerrainMask, x: number, y: number, halfWidth = 0): boolean {
  const cy = Math.round(y) + 1;
  const cx = Math.round(x);
  for (let dx = -halfWidth; dx <= halfWidth; dx += 1) if (isSolid(mask, cx + dx, cy)) return true;
  return false;
}
