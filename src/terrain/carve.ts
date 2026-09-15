/**
 * Carving the terrain mask (architecture.md section B, ultraplan rev 2 bug hunt rule "visual
 * carve rasterized from the mask spans"). Called once per explosion or girder, never per frame.
 *
 * THE ONE ROUNDING RULE. A pixel (x, y) belongs to the disc when (x - cx)^2 + (y - cy)^2 <= r^2.
 * Per row: dy = y - cy, dx = sqrt(r^2 - dy^2), and the inclusive span is
 *     x0 = ceil(cx - dx),  x1 = floor(cx + dx)
 * over the rows y0 = ceil(cy - r) .. y1 = floor(cy + r). Every consumer that needs the disc
 * (the mask here, the tile eraser in tiles.ts, any future debris spawner) takes the spans this
 * module returns instead of recomputing them: the measured 1 px rim mismatch between an anti
 * aliased arc and the integer mask (about 117 px per 60 px crater) came from two rasterizers.
 *
 * Two paths, one result. With hasBedrock false the row is a single memset (fast path); with
 * bedrock present the row is walked pixel by pixel and the span splits around every BEDROCK
 * byte. Both produce the same bytes, the same count and the same spans (carve.test.ts checks).
 * A span may include pixels that were already air; that is harmless for a destination-out
 * eraser and keeps the two paths identical.
 *
 * MUTATION NOTE: the mask bytes are rewritten in place (see mask.ts). Everything else is pure.
 */

import type { MaskValue } from '../config/constants.ts';
import { AIR, BEDROCK, type Span, type TerrainMask } from './mask.ts';

export interface CarveResult {
  /** Rows ascending; every pixel that changed lies inside exactly one span. */
  readonly spans: Span[];
  /** Pixels that actually changed value. */
  readonly changed: number;
}

export interface RowRange {
  readonly y0: number;
  readonly y1: number;
}

export interface ColumnRange {
  readonly x0: number;
  readonly x1: number;
}

function emptyResult(): CarveResult {
  return { spans: [], changed: 0 };
}

/** Inclusive rows a disc touches, before clamping to any mask. cx is accepted for symmetry with circleSpanAtRow. */
export function circleRowRange(_cx: number, cy: number, r: number): RowRange {
  return { y0: Math.ceil(cy - r), y1: Math.floor(cy + r) };
}

/** Inclusive columns of a disc on one row, or null when the row misses the disc. */
export function circleSpanAtRow(cx: number, cy: number, r: number, y: number): ColumnRange | null {
  const dy = y - cy;
  if (!(r >= 0) || Math.abs(dy) > r) return null;
  const dx = Math.sqrt(r * r - dy * dy);
  const x0 = Math.ceil(cx - dx);
  const x1 = Math.floor(cx + dx);
  return x0 > x1 ? null : { x0, x1 };
}

/** Fast path: count what is not air, then one memset. Only valid on a bedrock free mask. */
function eraseRowFill(mask: TerrainMask, y: number, x0: number, x1: number, spans: Span[]): number {
  const data = mask.data;
  const from = y * mask.width + x0;
  const to = y * mask.width + x1;
  let changed = 0;
  for (let i = from; i <= to; i += 1) {
    if (data[i] !== AIR) changed += 1;
  }
  if (changed > 0) data.fill(AIR, from, to + 1);
  spans.push({ y, x0, x1 });
  return changed;
}

/** Bedrock aware path: walks the row and splits the span around every BEDROCK byte. */
function eraseRowSplit(mask: TerrainMask, y: number, x0: number, x1: number, spans: Span[]): number {
  const data = mask.data;
  const rowStart = y * mask.width;
  let changed = 0;
  let open = -1;
  for (let x = x0; x <= x1; x += 1) {
    const value = data[rowStart + x];
    if (value === BEDROCK) {
      if (open >= 0) spans.push({ y, x0: open, x1: x - 1 });
      open = -1;
      continue;
    }
    if (open < 0) open = x;
    if (value !== AIR) {
      data[rowStart + x] = AIR;
      changed += 1;
    }
  }
  if (open >= 0) spans.push({ y, x0: open, x1 });
  return changed;
}

/**
 * Erases a disc from the mask. Bedrock survives, the disc is clamped to the mask, and the
 * returned spans are exactly the pixels a renderer must clear to stay identical to the mask.
 */
export function carveCircle(mask: TerrainMask, cx: number, cy: number, r: number): CarveResult {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(r >= 0) || !Number.isFinite(r)) return emptyResult();
  const rows = circleRowRange(cx, cy, r);
  const y0 = Math.max(0, rows.y0);
  const y1 = Math.min(mask.height - 1, rows.y1);
  if (y0 > y1) return emptyResult();

  const spans: Span[] = [];
  let changed = 0;
  for (let y = y0; y <= y1; y += 1) {
    const columns = circleSpanAtRow(cx, cy, r, y);
    if (columns === null) continue;
    const x0 = Math.max(0, columns.x0);
    const x1 = Math.min(mask.width - 1, columns.x1);
    if (x0 > x1) continue;
    changed += mask.hasBedrock ? eraseRowSplit(mask, y, x0, x1, spans) : eraseRowFill(mask, y, x0, x1, spans);
  }
  return { spans, changed };
}

/** Writes `value` over one clamped row, skipping bedrock; spans cover every non bedrock pixel. */
function paintRow(mask: TerrainMask, y: number, x0: number, x1: number, value: MaskValue, spans: Span[]): number {
  const data = mask.data;
  const rowStart = y * mask.width;
  let changed = 0;
  let open = -1;
  for (let x = x0; x <= x1; x += 1) {
    const current = data[rowStart + x];
    if (current === BEDROCK) {
      if (open >= 0) spans.push({ y, x0: open, x1: x - 1 });
      open = -1;
      continue;
    }
    if (open < 0) open = x;
    if (current !== value) {
      data[rowStart + x] = value;
      changed += 1;
    }
  }
  if (open >= 0) spans.push({ y, x0: open, x1 });
  return changed;
}

/**
 * Fills an axis aligned rect with a mask value: BEDROCK for girders, SOLID for repairs, AIR to
 * erase. Existing bedrock is never overwritten and never appears in the spans. Fractional
 * edges expand outward to whole pixels; a rect with no area or outside the mask does nothing.
 */
export function carveRect(mask: TerrainMask, x: number, y: number, w: number, h: number, value: MaskValue): CarveResult {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return emptyResult();
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(mask.width - 1, Math.ceil(x + w) - 1);
  const y1 = Math.min(mask.height - 1, Math.ceil(y + h) - 1);
  if (x0 > x1 || y0 > y1) return emptyResult();

  const spans: Span[] = [];
  let changed = 0;
  for (let row = y0; row <= y1; row += 1) changed += paintRow(mask, row, x0, x1, value, spans);
  if (value === BEDROCK && spans.length > 0) mask.hasBedrock = true;
  return { spans, changed };
}
