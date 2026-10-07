/**
 * Shape fills for the built scenarios (terrain/scenarios/*.ts): rectangles, ellipses, polygons
 * and battlements written straight into a mask, and the spans the painters use to colour a shape
 * on the tiles. Everything clips to the mask, so a shape may hang off the edge of the world.
 */

import type { MaskValue } from '../../config/constants.ts';
import { AIR, SOLID, type Span, type TerrainMask } from '../mask.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Fills the inclusive rect from (x0, y0) to (x1, y1), clipped to the mask. */
export function fillRect(mask: TerrainMask, x0: number, y0: number, x1: number, y1: number, value: MaskValue = SOLID): void {
  const left = Math.max(0, Math.floor(Math.min(x0, x1)));
  const right = Math.min(mask.width - 1, Math.floor(Math.max(x0, x1)));
  const top = Math.max(0, Math.floor(Math.min(y0, y1)));
  const bottom = Math.min(mask.height - 1, Math.floor(Math.max(y0, y1)));
  for (let y = top; y <= bottom; y += 1) mask.data.fill(value, y * mask.width + left, y * mask.width + right + 1);
}

/** Fills an ellipse; yMin and yMax (world rows, inclusive) keep only a slice of it, for domes and hulls. */
export function fillEllipse(mask: TerrainMask, cx: number, cy: number, rx: number, ry: number, value: MaskValue = SOLID, yMin = -Infinity, yMax = Infinity): void {
  const top = Math.max(0, Math.ceil(Math.max(cy - ry, yMin)));
  const bottom = Math.min(mask.height - 1, Math.floor(Math.min(cy + ry, yMax)));
  for (let y = top; y <= bottom; y += 1) {
    const dy = (y - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const left = Math.max(0, Math.ceil(cx - half));
    const right = Math.min(mask.width - 1, Math.floor(cx + half));
    if (left <= right) mask.data.fill(value, y * mask.width + left, y * mask.width + right + 1);
  }
}

/**
 * Fills a superellipse (|x/rx|^n + |y/ry|^n <= 1): n of 2 is an ellipse, higher is boxier, the
 * shape of a hull with rounded ends.
 */
export function fillSuperellipse(mask: TerrainMask, cx: number, cy: number, rx: number, ry: number, n: number, value: MaskValue = SOLID): void {
  const top = Math.max(0, Math.ceil(cy - ry));
  const bottom = Math.min(mask.height - 1, Math.floor(cy + ry));
  for (let y = top; y <= bottom; y += 1) {
    const dy = Math.abs((y - cy) / ry);
    const half = rx * Math.pow(Math.max(0, 1 - Math.pow(dy, n)), 1 / n);
    const left = Math.max(0, Math.ceil(cx - half));
    const right = Math.min(mask.width - 1, Math.floor(cx + half));
    if (left <= right) mask.data.fill(value, y * mask.width + left, y * mask.width + right + 1);
  }
}

/** Fills a simple polygon by scanline (even-odd), clipped to the mask. */
export function fillPolygon(mask: TerrainMask, points: readonly Point[], value: MaskValue = SOLID): void {
  if (points.length < 3) return;
  const top = Math.max(0, Math.ceil(Math.min(...points.map((p) => p.y))));
  const bottom = Math.min(mask.height - 1, Math.floor(Math.max(...points.map((p) => p.y))));
  for (let y = top; y <= bottom; y += 1) {
    const crossings: number[] = [];
    const sample = y + 0.5;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined || a.y === b.y) continue;
      const lo = a.y < b.y ? a : b;
      const hi = a.y < b.y ? b : a;
      if (sample < lo.y || sample >= hi.y) continue;
      crossings.push(lo.x + ((sample - lo.y) / (hi.y - lo.y)) * (hi.x - lo.x));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.max(0, Math.ceil(crossings[i] ?? 0));
      const right = Math.min(mask.width - 1, Math.floor(crossings[i + 1] ?? 0));
      if (left <= right) mask.data.fill(value, y * mask.width + left, y * mask.width + right + 1);
    }
  }
}

/** Battlements along the top of a wall: merlons `w` wide and `h` tall every `w + gap` px, from x0 to x1, standing on row y. */
export function fillMerlons(mask: TerrainMask, x0: number, x1: number, y: number, w: number, h: number, gap: number): void {
  for (let x = x0; x + w - 1 <= x1; x += w + gap) fillRect(mask, x, y - h, x + w - 1, y - 1, SOLID);
}

/** The spans of a filled disc, for painting a round window into the tiles. */
export function discSpans(cx: number, cy: number, r: number): Span[] {
  const spans: Span[] = [];
  for (let y = Math.ceil(cy - r); y <= Math.floor(cy + r); y += 1) {
    const dy = y - cy;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    spans.push({ y, x0: Math.ceil(cx - half), x1: Math.floor(cx + half) });
  }
  return spans;
}

/** The spans of an inclusive rect, for painting. */
export function rectSpans(x0: number, y0: number, x1: number, y1: number): Span[] {
  const spans: Span[] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) spans.push({ y, x0: Math.min(x0, x1), x1: Math.max(x0, x1) });
  return spans;
}

/** The runs of SOLID pixels inside an inclusive rect, so a painter colours a building and not the air round it. */
export function solidSpansIn(mask: TerrainMask, x0: number, y0: number, x1: number, y1: number): Span[] {
  const spans: Span[] = [];
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(mask.width - 1, Math.max(x0, x1));
  for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(mask.height - 1, Math.max(y0, y1)); y += 1) {
    let start = -1;
    for (let x = left; x <= right + 1; x += 1) {
      const solid = x <= right && mask.data[y * mask.width + x] === SOLID;
      if (solid && start < 0) start = x;
      if (!solid && start >= 0) {
        spans.push({ y, x0: start, x1: x - 1 });
        start = -1;
      }
    }
  }
  return spans;
}

/** Spans of the top `depth` rows of solid in each column of a rect: the lit top edge of a building. */
export function topEdgeSpansIn(mask: TerrainMask, x0: number, y0: number, x1: number, y1: number, depth: number): Span[] {
  const spans: Span[] = [];
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(mask.width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(mask.height - 1, Math.max(y0, y1));
  for (let x = left; x <= right; x += 1) {
    let run = 0;
    for (let y = top; y <= bottom; y += 1) {
      const i = y * mask.width + x;
      const above = y === 0 ? AIR : mask.data[i - mask.width];
      if (mask.data[i] !== SOLID) {
        run = 0;
        continue;
      }
      if (above === AIR) run = 0;
      run += 1;
      if (run <= depth) spans.push({ y, x0: x, x1: x });
    }
  }
  return spans;
}
