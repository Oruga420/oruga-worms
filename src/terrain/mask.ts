/**
 * Terrain mask: one byte per world pixel, row major, width * height. This array is the only
 * collision truth in the game (architecture.md, the load bearing rule): physics reads it, the
 * carve writes it, and the visual tiles are drawn FROM the spans it reports so picture and
 * collision can never disagree. World units are Worms pixels (config/units.ts), never scaled.
 *
 * MUTATION NOTE: `data` and `hasBedrock` are the two mutable hot path fields in the terrain
 * layer. Physics reads thousands of pixels per frame and a carve rewrites tens of thousands of
 * bytes, so copying the mask per change is out of the question. Every write goes through set,
 * setSpan, markBorderBedrock or the carve module, which keep the bedrock flag conservative.
 */

import { MASK, type MaskValue } from '../config/constants.ts';

export const AIR: MaskValue = MASK.AIR;
export const SOLID: MaskValue = MASK.SOLID;
export const BEDROCK: MaskValue = MASK.BEDROCK;

/** Thickness of the indestructible ring around a level (architecture.md section B). */
export const BORDER_BEDROCK_PX = 2;

/** Any row major byte grid: the mask itself, or a same sized layer such as the outline. */
export interface ByteGrid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface TerrainMask extends ByteGrid {
  /** MUTABLE hot path buffer, width * height bytes of AIR, SOLID or BEDROCK. */
  readonly data: Uint8Array;
  /**
   * MUTABLE, conservative: set the first time BEDROCK is written and never cleared, so a false
   * value guarantees a bedrock free buffer and unlocks the span fill fast path in carve.ts.
   * Code that writes BEDROCK straight into `data` must set this flag itself.
   */
  hasBedrock: boolean;
}

/** An inclusive horizontal run of pixels on one row. */
export interface Span {
  readonly y: number;
  readonly x0: number;
  readonly x1: number;
}

export function isValidDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function createMask(width: number, height: number, fill: MaskValue = AIR): TerrainMask {
  if (!isValidDimension(width) || !isValidDimension(height)) {
    throw new RangeError(`terrain mask needs positive integer dimensions, got ${width} x ${height}`);
  }
  const data = new Uint8Array(width * height);
  if (fill !== AIR) data.fill(fill);
  return { width, height, data, hasBedrock: fill === BEDROCK };
}

export function index(mask: TerrainMask, x: number, y: number): number {
  return y * mask.width + x;
}

export function inBounds(mask: TerrainMask, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < mask.width && y < mask.height;
}

/** The byte at an integer pixel; everything outside the mask reads as AIR. */
export function get(mask: TerrainMask, x: number, y: number): MaskValue {
  if (!inBounds(mask, x, y)) return AIR;
  return (mask.data[index(mask, x, y)] ?? AIR) as MaskValue;
}

/** Writes one pixel; false when the pixel is outside the mask. */
export function set(mask: TerrainMask, x: number, y: number, value: MaskValue): boolean {
  if (!inBounds(mask, x, y)) return false;
  mask.data[index(mask, x, y)] = value;
  if (value === BEDROCK) mask.hasBedrock = true;
  return true;
}

export function isSolid(mask: TerrainMask, x: number, y: number): boolean {
  return get(mask, x, y) !== AIR;
}

/**
 * Writes an inclusive span on one row, clamped to the row. Returns the span actually written,
 * or null when the row is outside the mask, the span is reversed or it misses the row entirely.
 */
export function setSpan(mask: TerrainMask, y: number, x0: number, x1: number, value: MaskValue): Span | null {
  if (y < 0 || y >= mask.height) return null;
  const from = Math.max(0, x0);
  const to = Math.min(mask.width - 1, x1);
  if (from > to) return null;
  const rowStart = y * mask.width;
  mask.data.fill(value, rowStart + from, rowStart + to + 1);
  if (value === BEDROCK) mask.hasBedrock = true;
  return { y, x0: from, x1: to };
}

/** SOLID plus BEDROCK pixels. */
export function countSolid(mask: TerrainMask): number {
  let count = 0;
  const data = mask.data;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] !== AIR) count += 1;
  }
  return count;
}

export function countValue(mask: TerrainMask, value: MaskValue): number {
  let count = 0;
  const data = mask.data;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] === value) count += 1;
  }
  return count;
}

/** Independent copy of the bytes and the bedrock flag. */
export function cloneMask(mask: TerrainMask): TerrainMask {
  return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data), hasBedrock: mask.hasBedrock };
}

/**
 * Turns the outer ring of the mask into BEDROCK so nothing can carve the world open
 * (architecture.md section B). A thickness larger than the mask fills it entirely.
 */
export function markBorderBedrock(mask: TerrainMask, thickness: number = BORDER_BEDROCK_PX): void {
  const t = Math.max(0, Math.floor(thickness));
  if (t === 0) return;
  const lastRow = mask.height - 1;
  for (let y = 0; y < mask.height; y += 1) {
    if (y < t || y > lastRow - t) {
      setSpan(mask, y, 0, mask.width - 1, BEDROCK);
    } else {
      setSpan(mask, y, 0, t - 1, BEDROCK);
      setSpan(mask, y, mask.width - t, mask.width - 1, BEDROCK);
    }
  }
}

/**
 * Runs of matching bytes on one row as inclusive spans; used to paint a freshly built mask (or
 * its outline layer) into the tiles with the same rasterizer the carve uses.
 */
export function rowSpans(grid: ByteGrid, y: number, predicate: (value: number) => boolean): Span[] {
  const spans: Span[] = [];
  if (y < 0 || y >= grid.height) return spans;
  const rowStart = y * grid.width;
  let start = -1;
  for (let x = 0; x < grid.width; x += 1) {
    const matches = predicate(grid.data[rowStart + x] ?? AIR);
    if (matches && start < 0) start = x;
    if (!matches && start >= 0) {
      spans.push({ y, x0: start, x1: x - 1 });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ y, x0: start, x1: grid.width - 1 });
  return spans;
}

/** Every span of the grid matching the predicate, rows ascending. */
export function maskSpans(grid: ByteGrid, predicate: (value: number) => boolean): Span[] {
  const spans: Span[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (const span of rowSpans(grid, y, predicate)) spans.push(span);
  }
  return spans;
}
