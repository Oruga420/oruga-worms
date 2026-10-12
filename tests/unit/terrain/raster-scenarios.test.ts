import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_DEFAULT } from '@/config/constants.ts';
import { makeRasterAsset } from '@/terrain/raster.ts';
import { createScenario } from '@/terrain/terrain.ts';
import { createFakeFactory, hashBytes } from './fakes.ts';

const { w: width, h: height } = WORLD_SIZE_DEFAULT;
const options = { width, height, seed: 3 };
const raster = makeRasterAsset({ width: 20, height: 10 }, { width: 20, height: 10, spans: Array.from({ length: 10 }, (_, y) => ({ y, x0: 0, x1: 19 })) });
if (raster === null) throw new Error('fixture invalid');

describe('optional raster-backed scenarios', () => {
  it.each(['spaceship', 'castle', 'kame_house'] as const)('%s uses imported occupancy and actually paints the decoded image', (id) => {
    const fake = createFakeFactory();
    const original = createScenario(id, options, createFakeFactory().factory);
    const built = createScenario(id, { ...options, sceneryAssets: { [id]: raster } }, fake.factory);
    expect(built.ok).toBe(true);
    if (!built.ok || !original.ok) return;
    expect(built.value.terrain.scenery?.rasterized).toBe(true);
    expect(hashBytes(built.value.terrain.mask.data)).not.toBe(hashBytes(original.value.terrain.mask.data));
    expect(fake.created.flatMap((ctx) => ctx.draws).length).toBeGreaterThan(0);
    expect(built.value.report.spawns.length).toBeGreaterThanOrEqual(8);
    if (id !== 'kame_house') expect(built.value.terrain.scenery?.props).toEqual([]);
  });

  it('keeps absent-asset fallback deterministic rather than changing a running map later', () => {
    const a = createScenario('kame_house', options, createFakeFactory().factory);
    const b = createScenario('kame_house', { ...options, sceneryAssets: {} }, createFakeFactory().factory);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(hashBytes(a.value.terrain.mask.data)).toBe(hashBytes(b.value.terrain.mask.data));
    expect(b.value.terrain.scenery?.rasterized).toBe(false);
  });
});
