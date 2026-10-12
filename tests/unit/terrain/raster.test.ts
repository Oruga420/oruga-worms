import { describe, expect, it } from 'vitest';
import { AIR, BEDROCK, SOLID, createMask, get, markBorderBedrock } from '@/terrain/mask.ts';
import { makeRasterAsset, fitRaster, stampRaster } from '@/terrain/raster.ts';
import { createTiles, paintRaster, fillSpans, applyCarveSpans } from '@/terrain/tiles.ts';
import { carveCircle } from '@/terrain/carve.ts';
import { createFakeFactory } from './fakes.ts';

const image = { width: 4, height: 3 };
const occupancy = { width: 4, height: 3, spans: [{ y: 0, x0: 1, x1: 2 }, { y: 1, x0: 0, x1: 3 }, { y: 2, x0: 1, x1: 2 }] };
const asset = () => {
  const result = makeRasterAsset(image, occupancy);
  if (result === null) throw new Error('fixture invalid');
  return result;
};

describe('destructible raster props', () => {
  it('validates occupancy bounds and exact image dimensions at the loading boundary', () => {
    expect(makeRasterAsset(image, occupancy)).not.toBeNull();
    expect(makeRasterAsset({ width: 5, height: 3 }, occupancy)).toBeNull();
    for (const bad of [null, {}, { ...occupancy, width: 0 }, { ...occupancy, spans: [] }, { ...occupancy, spans: [{ y: 3, x0: 0, x1: 2 }] }, { ...occupancy, spans: [{ y: 1, x0: 2, x1: 1 }] }]) {
      expect(makeRasterAsset(image, bad)).toBeNull();
    }
  });

  it('fits aspect ratio bottom-centered without distorting the accepted mesh view', () => {
    expect(fitRaster(asset(), { x: 10, y: 20, w: 20, h: 30 })).toEqual({ x: 10, y: 35, w: 20, h: 15 });
  });

  it('stamps only occupied pixels, without a cropped-image bedrock rectangle', () => {
    const mask = createMask(20, 16);
    markBorderBedrock(mask);
    stampRaster(mask, asset(), { x: 5, y: 5, w: 8, h: 6 });
    expect(get(mask, 5, 5)).toBe(AIR);
    expect(get(mask, 7, 5)).toBe(SOLID);
    expect(get(mask, 5, 7)).toBe(SOLID);
    expect(get(mask, 12, 10)).toBe(AIR);
    expect(get(mask, 0, 0)).toBe(BEDROCK);
    expect([...mask.data].filter((value) => value === SOLID)).toHaveLength(32);
  });

  it('clips placements at world edges without changing bedrock', () => {
    const mask = createMask(12, 10);
    markBorderBedrock(mask);
    stampRaster(mask, asset(), { x: -2, y: -2, w: 8, h: 6 });
    expect(get(mask, 0, 0)).toBe(BEDROCK);
    expect(get(mask, 2, 2)).toBe(SOLID);
  });

  it('bakes actual image sections once into scaled tiles using source-atop and marks them dirty', () => {
    const fake = createFakeFactory();
    const tiles = createTiles(12, 10, fake.factory, { tileSize: 6, scale: 3 });
    const paints = paintRaster(tiles, asset(), { x: 4, y: 3, w: 8, h: 6 });
    expect(paints).toBe(4);
    expect(fake.created.flatMap((ctx) => ctx.draws)).toHaveLength(4);
    expect(fake.created[0]?.draws[0]).toMatchObject({ image, sx: 0, sy: 0, sw: 1, sh: 1.5, dx: 12, dy: 9, dw: 6, dh: 9 });
    expect(fake.created.every((ctx) => ctx.globalCompositeOperation === 'source-over')).toBe(true);
    expect([...tiles.dirty]).toEqual([1, 1, 1, 1]);
  });

  it('remains ordinary tile content erased by the same carve spans as its collision', () => {
    const mask = createMask(20, 16);
    const fake = createFakeFactory();
    const tiles = createTiles(20, 16, fake.factory, { tileSize: 20, scale: 1 });
    stampRaster(mask, asset(), { x: 5, y: 5, w: 8, h: 6 });
    fillSpans(tiles, [{ y: 7, x0: 5, x1: 12 }], '#fff');
    paintRaster(tiles, asset(), { x: 5, y: 5, w: 8, h: 6 });
    const result = carveCircle(mask, 9, 8, 3);
    applyCarveSpans(tiles, result.spans);
    expect(get(mask, 9, 8)).toBe(AIR);
    expect(fake.created[0]?.rects.filter((rect) => rect.op === 'destination-out')).toHaveLength(result.spans.length);
    expect(fake.created[0]?.draws).toHaveLength(1);
  });
});
