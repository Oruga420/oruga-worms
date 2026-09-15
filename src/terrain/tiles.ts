/**
 * Visual terrain tiles (architecture.md section B, ultraplan rev 2 Units card). The mask lives at
 * world resolution; the picture lives on a grid of canvases at SPRITE_SCALE (3 tile px per world
 * px) so terrain edges stay crisp at zoom 2 to 3. Each tile covers TILE_SIZE world px, so its
 * canvas is TILE_SIZE * scale px on a side (the last column and row may be shorter).
 *
 * THE RULE THAT KEEPS PICTURE AND MASK IDENTICAL: nothing here rasterizes a circle. A carve
 * arrives as the spans carve.ts already wrote into the mask, and applyCarveSpans erases exactly
 * those pixels, scaled, as destination-out rects with smoothing off (bug hunt rule: "visual carve
 * rasterized from the mask spans with anti aliasing off, scorch ring painted afterwards with
 * source-atop"). The scorch ring is cosmetic and only darkens pixels that survived.
 *
 * MUTATION NOTE: the tile canvases and the dirty byte array are the mutable hot path of this
 * file; a canvas cannot be copied per frame. Everything else is pure.
 *
 * DOM free: drawing goes through Context2DLike (context.ts), so Vitest injects recording fakes.
 */

import { SPRITE_SCALE } from '../config/units.ts';
import type { Context2DLike, ContextFactory, FillStyleLike, RectLike } from './context.ts';
import { isValidDimension, type Span } from './mask.ts';

/** World px covered by one tile. */
export const TILE_SIZE = 512;

/** Any opaque style works for destination-out; it only needs alpha 1. */
const ERASE_STYLE = '#000000';

export interface Tile {
  readonly col: number;
  readonly row: number;
  /** World px of the top left corner. */
  readonly x: number;
  readonly y: number;
  /** World px covered; the last column and row may be shorter than tileSize. */
  readonly w: number;
  readonly h: number;
  readonly ctx: Context2DLike;
}

export interface TerrainTiles {
  /** World px. */
  readonly width: number;
  readonly height: number;
  /** World px per tile. */
  readonly tileSize: number;
  /** Tile canvas px per world px. */
  readonly scale: number;
  readonly cols: number;
  readonly rows: number;
  /** Row major, rows * cols entries. */
  readonly tiles: readonly Tile[];
  /** MUTABLE, one byte per tile: 1 when its canvas changed since the last clearDirty. */
  readonly dirty: Uint8Array;
}

export interface TilesOptions {
  readonly tileSize?: number;
  readonly scale?: number;
}

export interface ScorchStyle {
  /** Ring width outside the crater radius, world px. */
  readonly width: number;
  /** Alpha at the crater edge; fades to 0 at radius + width. */
  readonly alpha: number;
  /** Near black, as r, g, b bytes. */
  readonly rgb: readonly [number, number, number];
}

export const DEFAULT_SCORCH: ScorchStyle = Object.freeze({ width: 6, alpha: 0.55, rgb: Object.freeze([24, 16, 12]) as [number, number, number] });

/** The disc that produced a set of carve spans, in world px, for the scorch ring. */
export interface Disc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export function createTiles(
  width: number,
  height: number,
  createContext: ContextFactory,
  options: TilesOptions = {},
): TerrainTiles {
  const tileSize = options.tileSize ?? TILE_SIZE;
  const scale = options.scale ?? SPRITE_SCALE;
  if (!isValidDimension(width) || !isValidDimension(height)) {
    throw new RangeError(`terrain tiles need positive integer world dimensions, got ${width} x ${height}`);
  }
  if (!isValidDimension(tileSize) || !isValidDimension(scale)) {
    throw new RangeError(`tileSize and scale must be positive integers, got ${tileSize} and ${scale}`);
  }
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * tileSize;
      const y = row * tileSize;
      const w = Math.min(tileSize, width - x);
      const h = Math.min(tileSize, height - y);
      const ctx = createContext(w * scale, h * scale);
      ctx.imageSmoothingEnabled = false;
      tiles.push({ col, row, x, y, w, h, ctx });
    }
  }
  return { width, height, tileSize, scale, cols, rows, tiles, dirty: new Uint8Array(cols * rows) };
}

export function tileIndex(tiles: TerrainTiles, col: number, row: number): number {
  return row * tiles.cols + col;
}

export function tileAt(tiles: TerrainTiles, col: number, row: number): Tile | undefined {
  if (col < 0 || row < 0 || col >= tiles.cols || row >= tiles.rows) return undefined;
  return tiles.tiles[tileIndex(tiles, col, row)];
}

export function markDirty(tiles: TerrainTiles, col: number, row: number): void {
  if (col < 0 || row < 0 || col >= tiles.cols || row >= tiles.rows) return;
  tiles.dirty[tileIndex(tiles, col, row)] = 1;
}

export function isDirty(tiles: TerrainTiles, col: number, row: number): boolean {
  return tiles.dirty[tileIndex(tiles, col, row)] === 1;
}

export function dirtyCount(tiles: TerrainTiles): number {
  let count = 0;
  for (let i = 0; i < tiles.dirty.length; i += 1) count += tiles.dirty[i] ?? 0;
  return count;
}

export function clearDirty(tiles: TerrainTiles): void {
  tiles.dirty.fill(0);
}

interface IndexRange {
  readonly from: number;
  readonly to: number;
}

/** Tile columns or rows an inclusive world range touches, clamped to the grid. */
function tileRange(start: number, endInclusive: number, tileSize: number, count: number): IndexRange {
  return {
    from: Math.max(0, Math.floor(start / tileSize)),
    to: Math.min(count - 1, Math.floor(endInclusive / tileSize)),
  };
}

/**
 * Draws every span as a rect on each tile it crosses, scaled to tile px, with the given style
 * and composite operation. Returns the number of rects drawn. This is the only rasterizer in the
 * file: erasing, painting a fresh silhouette and drawing girders all go through it.
 */
export function fillSpans(
  tiles: TerrainTiles,
  spans: readonly Span[],
  style: FillStyleLike,
  op: GlobalCompositeOperation = 'source-over',
): number {
  const { tileSize, scale } = tiles;
  const touched = new Set<number>();
  let rects = 0;
  for (const span of spans) {
    if (span.y < 0 || span.y >= tiles.height || span.x1 < 0 || span.x0 >= tiles.width || span.x0 > span.x1) continue;
    const row = Math.floor(span.y / tileSize);
    const columns = tileRange(Math.max(0, span.x0), Math.min(tiles.width - 1, span.x1), tileSize, tiles.cols);
    for (let col = columns.from; col <= columns.to; col += 1) {
      const tile = tileAt(tiles, col, row);
      if (tile === undefined) continue;
      const x0 = Math.max(span.x0, tile.x) - tile.x;
      const x1 = Math.min(span.x1, tile.x + tile.w - 1) - tile.x;
      const ctx = tile.ctx;
      ctx.globalCompositeOperation = op;
      ctx.fillStyle = style;
      ctx.fillRect(x0 * scale, (span.y - tile.y) * scale, (x1 - x0 + 1) * scale, scale);
      touched.add(tileIndex(tiles, col, row));
      rects += 1;
    }
  }
  for (const i of touched) {
    const tile = tiles.tiles[i];
    if (tile !== undefined) tile.ctx.globalCompositeOperation = 'source-over';
    tiles.dirty[i] = 1;
  }
  return rects;
}

function rgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Darkens the surviving rim around a crater: a radial gradient from `alpha` at the crater edge
 * to 0 at radius plus width, painted with source-atop so only existing pixels change. Returns the
 * number of tiles painted.
 */
export function scorchRing(tiles: TerrainTiles, disc: Disc, style: ScorchStyle = DEFAULT_SCORCH): number {
  const { scale, tileSize } = tiles;
  const outer = disc.r + style.width;
  const x0 = Math.max(0, Math.floor(disc.cx - outer));
  const y0 = Math.max(0, Math.floor(disc.cy - outer));
  const x1 = Math.min(tiles.width - 1, Math.ceil(disc.cx + outer) - 1);
  const y1 = Math.min(tiles.height - 1, Math.ceil(disc.cy + outer) - 1);
  if (x0 > x1 || y0 > y1) return 0;
  const columns = tileRange(x0, x1, tileSize, tiles.cols);
  const rows = tileRange(y0, y1, tileSize, tiles.rows);
  let painted = 0;
  for (let row = rows.from; row <= rows.to; row += 1) {
    for (let col = columns.from; col <= columns.to; col += 1) {
      const tile = tileAt(tiles, col, row);
      if (tile === undefined) continue;
      const ctx = tile.ctx;
      const lx = (disc.cx - tile.x) * scale;
      const ly = (disc.cy - tile.y) * scale;
      const gradient = ctx.createRadialGradient(lx, ly, disc.r * scale, lx, ly, outer * scale);
      gradient.addColorStop(0, rgba(style.rgb, style.alpha));
      gradient.addColorStop(1, rgba(style.rgb, 0));
      const rx0 = Math.max(x0, tile.x) - tile.x;
      const ry0 = Math.max(y0, tile.y) - tile.y;
      const rx1 = Math.min(x1, tile.x + tile.w - 1) - tile.x;
      const ry1 = Math.min(y1, tile.y + tile.h - 1) - tile.y;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = gradient;
      ctx.fillRect(rx0 * scale, ry0 * scale, (rx1 - rx0 + 1) * scale, (ry1 - ry0 + 1) * scale);
      ctx.globalCompositeOperation = 'source-over';
      tiles.dirty[tileIndex(tiles, col, row)] = 1;
      painted += 1;
    }
  }
  return painted;
}

/**
 * The visual half of a carve: erases exactly the mask spans (destination-out, smoothing off),
 * then paints the scorch ring when a disc is given. Returns the number of erase rects drawn.
 */
export function applyCarveSpans(
  tiles: TerrainTiles,
  spans: readonly Span[],
  disc: Disc | null = null,
  style: ScorchStyle = DEFAULT_SCORCH,
): number {
  const rects = fillSpans(tiles, spans, ERASE_STYLE, 'destination-out');
  if (disc !== null && rects > 0) scorchRing(tiles, disc, style);
  return rects;
}

/** Clears every tile canvas and marks all of them dirty, for a level rebuild. */
export function clearTiles(tiles: TerrainTiles): void {
  for (const tile of tiles.tiles) {
    tile.ctx.clearRect(0, 0, tile.w * tiles.scale, tile.h * tiles.scale);
  }
  tiles.dirty.fill(1);
}

/**
 * Culled blit: draws the part of every tile that intersects `view` (world px) onto the target,
 * where world x maps to screen (x - view.x) * zoom. Returns the number of tiles drawn.
 */
export function blitTiles(tiles: TerrainTiles, target: Context2DLike, view: RectLike, zoom: number): number {
  if (!(zoom > 0) || !(view.w > 0) || !(view.h > 0)) return 0;
  const { scale, tileSize } = tiles;
  const columns = tileRange(Math.max(0, view.x), Math.min(tiles.width - 1, view.x + view.w), tileSize, tiles.cols);
  const rows = tileRange(Math.max(0, view.y), Math.min(tiles.height - 1, view.y + view.h), tileSize, tiles.rows);
  let drawn = 0;
  for (let row = rows.from; row <= rows.to; row += 1) {
    for (let col = columns.from; col <= columns.to; col += 1) {
      const tile = tileAt(tiles, col, row);
      if (tile === undefined) continue;
      const ix0 = Math.max(tile.x, view.x);
      const iy0 = Math.max(tile.y, view.y);
      const ix1 = Math.min(tile.x + tile.w, view.x + view.w);
      const iy1 = Math.min(tile.y + tile.h, view.y + view.h);
      if (ix1 <= ix0 || iy1 <= iy0) continue;
      target.drawImage(
        tile.ctx.canvas,
        (ix0 - tile.x) * scale,
        (iy0 - tile.y) * scale,
        (ix1 - ix0) * scale,
        (iy1 - iy0) * scale,
        (ix0 - view.x) * zoom,
        (iy0 - view.y) * zoom,
        (ix1 - ix0) * zoom,
        (iy1 - iy0) * zoom,
      );
      drawn += 1;
    }
  }
  return drawn;
}
