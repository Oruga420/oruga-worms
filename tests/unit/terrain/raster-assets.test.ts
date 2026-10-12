import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_DEFAULT } from '@/config/constants.ts';
import { buildGame } from '@/game/setup.ts';
import { makeRasterAsset, type RasterAsset } from '@/terrain/raster.ts';
import { cutRect, solidCount } from '@/terrain/terrain.ts';
import { SOLID } from '@/terrain/mask.ts';
import { initialWaterY } from '@/terrain/water.ts';
import { createFakeFactory } from './fakes.ts';

function actualAsset(folder: string): RasterAsset {
  const url = new URL(`../../../public/scenery/rendered/${folder}/occupancy.json`, import.meta.url);
  const data = JSON.parse(readFileSync(url, 'utf8')) as { width: number; height: number };
  const raster = makeRasterAsset({ width: data.width, height: data.height }, data);
  if (raster === null) throw new Error(`Invalid rendered asset ${folder}`);
  return raster;
}

const teams = ([0, 1, 2, 3] as const).map((colorIndex) => ({
  name: `Team ${colorIndex + 1}`, colorIndex, controller: 'human' as const,
  wormNames: Array.from({ length: 6 }, (_, i) => `Worm ${i + 1}`),
}));

// Imported files, not invented rectangle fixtures: changing silhouettes must preserve this contract.
describe('actual rendered Meshy assets in game setup', () => {
  it.each(['spaceship', 'castle', 'kame_house'] as const)('%s supports all24worms for seeds1-3 and its image-bearing terrain carves away', (scenario) => {
    const raster = actualAsset(scenario === 'kame_house' ? 'kame-house' : scenario);
    for (const seed of [1, 2, 3]) {
      const fake = createFakeFactory();
      const built = buildGame({
        setup: { seed, scenario, teams, worldSize: WORLD_SIZE_DEFAULT, waterY: initialWaterY(WORLD_SIZE_DEFAULT.h) },
        createContext: fake.factory, sceneryAssets: { [scenario]: raster },
      });
      expect(built.ok, built.ok ? '' : `${scenario} seed${seed}: ${built.error.message}`).toBe(true);
      if (!built.ok) continue;
      const { terrain, world } = built.value;
      expect(terrain.scenery?.rasterized).toBe(true);
      expect(world.worms).toHaveLength(24);
      expect(fake.created.flatMap((ctx) => ctx.draws).length).toBeGreaterThan(0);
      const index = terrain.mask.data.findIndex((pixel) => pixel === SOLID);
      const x = index % terrain.width;
      const y = Math.floor(index / terrain.width);
      const before = solidCount(terrain);
      const cut = cutRect(terrain, x - 10, y, 30, 30);
      expect(cut.spans.length).toBeGreaterThan(0);
      expect(solidCount(terrain)).toBeLessThan(before);
      expect(fake.created.flatMap((ctx) => ctx.rects).some((rect) => rect.op === 'destination-out')).toBe(true);
    }
  });
});
