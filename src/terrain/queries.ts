/**
 * Read only queries over the terrain mask (architecture.md section B, queries). These are the
 * calls physics, the worm controller, crate drops and the CPU snapshot make every tick, so they
 * read the Uint8Array directly and never touch a canvas (the ESLint rule bans readbacks here).
 *
 * Coordinates are world px; fractional inputs are floored to the pixel that contains them.
 * Everything outside the mask reads as AIR, so a probe that leaves the map finds no solid and a
 * segment that leaves the map is not blocked by the edge. The physics track relies on both.
 */

import { vec2, type Vec2 } from '../core/math.ts';
import { AIR, isSolid as maskIsSolid, type TerrainMask } from './mask.ts';

/** Straight up in screen space (y grows downward); the normal where no gradient exists. */
export const UP: Vec2 = vec2(0, -1);

export function isSolid(mask: TerrainMask, x: number, y: number): boolean {
  return maskIsSolid(mask, Math.floor(x), Math.floor(y));
}

/**
 * Row of the first solid pixel at or below y within maxDepth rows (inclusive), or null. Rows
 * above the map are skipped as air; the search stops at the bottom edge.
 */
export function firstSolidBelow(mask: TerrainMask, x: number, y: number, maxDepth: number): number | null {
  const col = Math.floor(x);
  if (col < 0 || col >= mask.width) return null;
  const start = Math.floor(y);
  const from = Math.max(0, start);
  const to = Math.min(mask.height - 1, start + Math.floor(maxDepth));
  const data = mask.data;
  for (let row = from; row <= to; row += 1) {
    if (data[row * mask.width + col] !== AIR) return row;
  }
  return null;
}

/**
 * Row of the first air pixel at or above y within maxRise rows (inclusive), or null. Used by
 * the worm step up; the search stops at the top edge instead of climbing out of the map.
 */
export function firstAirAbove(mask: TerrainMask, x: number, y: number, maxRise: number): number | null {
  const col = Math.floor(x);
  if (col < 0 || col >= mask.width) return null;
  const start = Math.min(mask.height - 1, Math.floor(y));
  const end = Math.max(0, start - Math.floor(maxRise));
  const data = mask.data;
  for (let row = start; row >= end; row -= 1) {
    if (data[row * mask.width + col] === AIR) return row;
  }
  return null;
}

/**
 * Bresenham walk from a to b over the mask, both endpoints included, early exit on the first
 * solid pixel. Pixels outside the map count as air.
 */
export function lineOfSight(mask: TerrainMask, ax: number, ay: number, bx: number, by: number): boolean {
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const x1 = Math.floor(bx);
  const y1 = Math.floor(by);
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    if (maskIsSolid(mask, x, y)) return false;
    if (x === x1 && y === y1) return true;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/**
 * Topmost solid row of a column at or below `fromRow`, -1 when the column is all air or outside
 * the map. Levels with a bedrock ring have a 2 px ceiling, so callers that want the ground pass
 * fromRow = BORDER_BEDROCK_PX (or the terrain's sky row) to look under it.
 */
export function topmostSolid(mask: TerrainMask, x: number, fromRow = 0): number {
  const col = Math.floor(x);
  if (col < 0 || col >= mask.width) return -1;
  const data = mask.data;
  for (let row = Math.max(0, Math.floor(fromRow)); row < mask.height; row += 1) {
    if (data[row * mask.width + col] !== AIR) return row;
  }
  return -1;
}

/**
 * Topmost solid row at or below `fromRow` every `step` px starting at x = 0, -1 where a column
 * is all air. Feeds the CPU snapshot: about 64 samples across a 1920 px map at step 30.
 */
export function sampleProfile(mask: TerrainMask, step: number, fromRow = 0): Int32Array {
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new RangeError(`sampleProfile needs a positive step, got ${step}`);
  }
  const count = Math.ceil(mask.width / step);
  const profile = new Int32Array(count);
  for (let i = 0; i < count; i += 1) profile[i] = topmostSolid(mask, Math.floor(i * step), fromRow);
  return profile;
}

/**
 * Unit normal at a pixel from the 3 x 3 solidity gradient, pointing out of the terrain. Used
 * for projectile bounces. Where the gradient vanishes (deep inside or in open air) it is UP.
 */
export function surfaceNormal(mask: TerrainMask, x: number, y: number): Vec2 {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const solid = (dx: number, dy: number): number => (maskIsSolid(mask, px + dx, py + dy) ? 1 : 0);
  const gx = solid(1, -1) + solid(1, 0) + solid(1, 1) - (solid(-1, -1) + solid(-1, 0) + solid(-1, 1));
  const gy = solid(-1, 1) + solid(0, 1) + solid(1, 1) - (solid(-1, -1) + solid(0, -1) + solid(1, -1));
  if (gx === 0 && gy === 0) return UP;
  const len = Math.hypot(gx, gy);
  return vec2(-gx / len, -gy / len);
}
