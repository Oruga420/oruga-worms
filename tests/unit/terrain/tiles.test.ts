import { describe, expect, it } from 'vitest';
import { SPRITE_SCALE } from '@/config/units.ts';
import { carveCircle } from '@/terrain/carve.ts';
import { SOLID, countSolid, createMask, type Span } from '@/terrain/mask.ts';
import {
  DEFAULT_SCORCH,
  TILE_SIZE,
  applyCarveSpans,
  blitTiles,
  clearDirty,
  clearTiles,
  createTiles,
  dirtyCount,
  fillSpans,
  isDirty,
  markDirty,
  scorchRing,
  tileAt,
  tileIndex,
} from '@/terrain/tiles.ts';
import { createFakeContext, createFakeFactory, type RecordedRect } from './fakes.ts';

const ERASE = '#000000';

function rectPixels(rects: readonly RecordedRect[], scale: number): number {
  return rects.reduce((sum, rect) => sum + (rect.w * rect.h) / (scale * scale), 0);
}

describe('tiles: grid creation', () => {
  it('covers the world with tileSize world px tiles at SPRITE_SCALE, last column and row shorter', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(100, 40, factory, { tileSize: 32 });
    expect(tiles.scale).toBe(SPRITE_SCALE);
    expect(tiles.tileSize).toBe(32);
    expect(tiles.cols).toBe(4);
    expect(tiles.rows).toBe(2);
    expect(tiles.tiles.length).toBe(8);
    expect(tiles.dirty.length).toBe(8);
    expect(created.length).toBe(8);
    expect(created[0]?.canvas).toEqual({ width: 96, height: 96 });
    expect(created[3]?.canvas).toEqual({ width: 12, height: 96 });
    expect(created[4]?.canvas).toEqual({ width: 96, height: 24 });
    expect(created[7]?.canvas).toEqual({ width: 12, height: 24 });
    expect(tiles.tiles[5]).toMatchObject({ col: 1, row: 1, x: 32, y: 32, w: 32, h: 8 });
    for (const ctx of created) expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('defaults to 512 world px tiles, so the standard map is 4 x 2 canvases of 1536 px', () => {
    expect(TILE_SIZE).toBe(512);
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(1920, 696, factory);
    expect(tiles.cols).toBe(4);
    expect(tiles.rows).toBe(2);
    expect(created[0]?.canvas).toEqual({ width: 1536, height: 1536 });
    expect(created[7]?.canvas).toEqual({ width: 1152, height: 552 });
  });

  it('rejects bad dimensions, tile sizes and scales', () => {
    const { factory } = createFakeFactory();
    expect(() => createTiles(0, 10, factory)).toThrow(RangeError);
    expect(() => createTiles(10, 2.5, factory)).toThrow(RangeError);
    expect(() => createTiles(10, 10, factory, { tileSize: 0 })).toThrow(RangeError);
    expect(() => createTiles(10, 10, factory, { scale: 0.5 })).toThrow(RangeError);
  });

  it('indexes tiles row major and answers undefined outside the grid', () => {
    const tiles = createTiles(100, 40, createFakeFactory().factory, { tileSize: 32 });
    expect(tileIndex(tiles, 1, 1)).toBe(5);
    expect(tileAt(tiles, 3, 1)?.col).toBe(3);
    expect(tileAt(tiles, 4, 0)).toBeUndefined();
    expect(tileAt(tiles, -1, 0)).toBeUndefined();
    expect(tileAt(tiles, 0, 2)).toBeUndefined();
  });
});

describe('tiles: dirty tracking', () => {
  it('starts clean, marks and clears, ignores tiles outside the grid', () => {
    const tiles = createTiles(100, 40, createFakeFactory().factory, { tileSize: 32 });
    expect(dirtyCount(tiles)).toBe(0);
    markDirty(tiles, 1, 0);
    expect(isDirty(tiles, 1, 0)).toBe(true);
    expect(isDirty(tiles, 0, 0)).toBe(false);
    expect(dirtyCount(tiles)).toBe(1);
    markDirty(tiles, 9, 9);
    expect(dirtyCount(tiles)).toBe(1);
    clearDirty(tiles);
    expect(dirtyCount(tiles)).toBe(0);
  });
});

describe('tiles: spans become rects at exactly scale times their pixels', () => {
  it('erases spans with destination-out rects and resets the composite operation', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(20, 20, factory, { tileSize: 32 });
    const spans: Span[] = [
      { y: 2, x0: 3, x1: 7 },
      { y: 3, x0: 0, x1: 19 },
    ];
    expect(applyCarveSpans(tiles, spans)).toBe(2);
    const ctx = created[0];
    expect(ctx?.rects).toEqual([
      { op: 'destination-out', x: 9, y: 6, w: 15, h: 3, style: ERASE },
      { op: 'destination-out', x: 0, y: 9, w: 60, h: 3, style: ERASE },
    ]);
    expect(ctx?.gradients).toEqual([]);
    expect(ctx?.globalCompositeOperation).toBe('source-over');
    expect(isDirty(tiles, 0, 0)).toBe(true);
  });

  it('splits a span that crosses a tile boundary into one rect per tile', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(64, 16, factory, { tileSize: 32 });
    expect(fillSpans(tiles, [{ y: 5, x0: 28, x1: 40 }], '#abcdef')).toBe(2);
    expect(created[0]?.rects).toEqual([{ op: 'source-over', x: 84, y: 15, w: 12, h: 3, style: '#abcdef' }]);
    expect(created[1]?.rects).toEqual([{ op: 'source-over', x: 0, y: 15, w: 27, h: 3, style: '#abcdef' }]);
    expect(dirtyCount(tiles)).toBe(2);
  });

  it('draws exactly the spans a mask carve returned, so the picture area equals the mask change', () => {
    const mask = createMask(60, 60, SOLID);
    const result = carveCircle(mask, 30, 30, 10);
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(60, 60, factory, { tileSize: 64 });

    expect(applyCarveSpans(tiles, result.spans)).toBe(result.spans.length);
    const rects = created[0]?.rects ?? [];
    expect(rects.length).toBe(21);
    result.spans.forEach((span, i) => {
      expect(rects[i]).toEqual({
        op: 'destination-out',
        x: span.x0 * 3,
        y: span.y * 3,
        w: (span.x1 - span.x0 + 1) * 3,
        h: 3,
        style: ERASE,
      });
    });
    expect(rectPixels(rects, 3)).toBe(result.changed);
    expect(rectPixels(rects, 3)).toBe(3600 - countSolid(mask));
  });

  it('skips spans outside the world and clips spans that leave it', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(20, 20, factory, { tileSize: 32 });
    const outside: Span[] = [
      { y: -1, x0: 0, x1: 5 },
      { y: 20, x0: 0, x1: 5 },
      { y: 3, x0: -8, x1: -2 },
      { y: 4, x0: 25, x1: 30 },
      { y: 5, x0: 7, x1: 3 },
    ];
    expect(fillSpans(tiles, outside, '#ffffff')).toBe(0);
    expect(dirtyCount(tiles)).toBe(0);
    expect(fillSpans(tiles, [{ y: 1, x0: -5, x1: 4 }], '#ffffff')).toBe(1);
    expect(fillSpans(tiles, [{ y: 1, x0: 15, x1: 40 }], '#ffffff')).toBe(1);
    expect(created[0]?.rects).toEqual([
      { op: 'source-over', x: 0, y: 3, w: 15, h: 3, style: '#ffffff' },
      { op: 'source-over', x: 45, y: 3, w: 15, h: 3, style: '#ffffff' },
    ]);
  });
});

describe('tiles: scorch ring', () => {
  it('paints one source-atop radial gradient after the erase rects, from alpha 0.55 at r to 0 at r + width', () => {
    expect(DEFAULT_SCORCH).toEqual({ width: 6, alpha: 0.55, rgb: [24, 16, 12] });
    const mask = createMask(60, 60, SOLID);
    const { spans } = carveCircle(mask, 30, 30, 10);
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(60, 60, factory, { tileSize: 64 });

    expect(applyCarveSpans(tiles, spans, { cx: 30, cy: 30, r: 10 })).toBe(21);
    const ctx = created[0];
    expect(ctx?.gradients).toEqual([
      {
        x0: 90,
        y0: 90,
        r0: 30,
        x1: 90,
        y1: 90,
        r1: 48,
        stops: [
          { offset: 0, color: 'rgba(24, 16, 12, 0.55)' },
          { offset: 1, color: 'rgba(24, 16, 12, 0)' },
        ],
      },
    ]);
    const rects = ctx?.rects ?? [];
    expect(rects.length).toBe(22);
    for (const rect of rects.slice(0, 21)) expect(rect.op).toBe('destination-out');
    expect(rects[21]).toEqual({ op: 'source-atop', x: 42, y: 42, w: 96, h: 96, style: 'gradient' });
    expect(ctx?.globalCompositeOperation).toBe('source-over');
  });

  it('paints no scorch when nothing was erased', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(60, 60, factory, { tileSize: 64 });
    expect(applyCarveSpans(tiles, [], { cx: 30, cy: 30, r: 10 })).toBe(0);
    expect(created[0]?.gradients).toEqual([]);
    expect(created[0]?.rects).toEqual([]);
  });

  it('scorches every tile the ring touches with tile local centers, and honours a custom style', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(64, 16, factory, { tileSize: 32 });
    expect(scorchRing(tiles, { cx: 32, cy: 8, r: 4 })).toBe(2);
    expect(created[0]?.gradients[0]).toMatchObject({ x0: 96, y0: 24, r0: 12, x1: 96, y1: 24, r1: 30 });
    expect(created[1]?.gradients[0]).toMatchObject({ x0: 0, y0: 24, r0: 12, x1: 0, y1: 24, r1: 30 });
    expect(created[0]?.rects).toEqual([{ op: 'source-atop', x: 66, y: 0, w: 30, h: 48, style: 'gradient' }]);
    expect(created[1]?.rects).toEqual([{ op: 'source-atop', x: 0, y: 0, w: 30, h: 48, style: 'gradient' }]);
    expect(dirtyCount(tiles)).toBe(2);

    expect(scorchRing(tiles, { cx: 10, cy: 8, r: 2 }, { width: 2, alpha: 0.3, rgb: [1, 2, 3] })).toBe(1);
    expect(created[0]?.gradients[1]).toMatchObject({
      r0: 6,
      r1: 12,
      stops: [
        { offset: 0, color: 'rgba(1, 2, 3, 0.3)' },
        { offset: 1, color: 'rgba(1, 2, 3, 0)' },
      ],
    });
    expect(scorchRing(tiles, { cx: -50, cy: -50, r: 4 })).toBe(0);
  });
});

describe('tiles: culled blit', () => {
  it('draws only the tiles the view touches, mapping world px to screen through the zoom', () => {
    const { factory } = createFakeFactory();
    const tiles = createTiles(64, 64, factory, { tileSize: 32 });
    const target = createFakeContext(200, 200);

    expect(blitTiles(tiles, target, { x: 0, y: 0, w: 32, h: 32 }, 2)).toBe(1);
    expect(target.draws).toEqual([
      { image: tiles.tiles[0]?.ctx.canvas, sx: 0, sy: 0, sw: 96, sh: 96, dx: 0, dy: 0, dw: 64, dh: 64 },
    ]);
  });

  it('clips each tile to the intersection with the view', () => {
    const { factory } = createFakeFactory();
    const tiles = createTiles(64, 64, factory, { tileSize: 32 });
    const target = createFakeContext(200, 200);

    expect(blitTiles(tiles, target, { x: 16, y: 16, w: 32, h: 32 }, 2.5)).toBe(4);
    expect(target.draws[0]).toMatchObject({ sx: 48, sy: 48, sw: 48, sh: 48, dx: 0, dy: 0, dw: 40, dh: 40 });
    expect(target.draws[1]).toMatchObject({ sx: 0, sy: 48, sw: 48, sh: 48, dx: 40, dy: 0, dw: 40, dh: 40 });
    expect(target.draws[3]).toMatchObject({ sx: 0, sy: 0, sw: 48, sh: 48, dx: 40, dy: 40, dw: 40, dh: 40 });
  });

  it('draws nothing for views outside the world, empty views or a zero zoom, and clamps negative origins', () => {
    const { factory } = createFakeFactory();
    const tiles = createTiles(64, 64, factory, { tileSize: 32 });
    const target = createFakeContext(200, 200);
    expect(blitTiles(tiles, target, { x: 100, y: 0, w: 10, h: 10 }, 1)).toBe(0);
    expect(blitTiles(tiles, target, { x: 0, y: 0, w: 0, h: 10 }, 1)).toBe(0);
    expect(blitTiles(tiles, target, { x: 0, y: 0, w: 10, h: 10 }, 0)).toBe(0);
    expect(target.draws).toEqual([]);

    expect(blitTiles(tiles, target, { x: -10, y: -10, w: 20, h: 20 }, 1)).toBe(1);
    expect(target.draws[0]).toMatchObject({ sx: 0, sy: 0, sw: 30, sh: 30, dx: 10, dy: 10, dw: 10, dh: 10 });
  });
});

describe('tiles: clearTiles', () => {
  it('clears every canvas over its full size and marks all tiles dirty', () => {
    const { factory, created } = createFakeFactory();
    const tiles = createTiles(100, 40, factory, { tileSize: 32 });
    clearTiles(tiles);
    expect(created[0]?.clears[0]).toMatchObject({ x: 0, y: 0, w: 96, h: 96 });
    expect(created[3]?.clears[0]).toMatchObject({ x: 0, y: 0, w: 12, h: 96 });
    expect(created[7]?.clears[0]).toMatchObject({ x: 0, y: 0, w: 12, h: 24 });
    expect(dirtyCount(tiles)).toBe(8);
  });
});
