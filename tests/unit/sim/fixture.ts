import { createMask, setSpan, SOLID } from '@/terrain/mask.ts';
import { DEFAULT_THEME, type TerrainData } from '@/terrain/terrain.ts';
import { createTiles } from '@/terrain/tiles.ts';
import { createWater } from '@/terrain/water.ts';
import { createWorld, type SimWorld } from '@/sim/world.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

export interface FlatWorldOptions {
  readonly width?: number;
  readonly height?: number;
  /** First solid row; everything from here down is ground. */
  readonly floorY?: number;
  readonly waterY?: number;
  /** Columns without ground (the sea), inclusive. */
  readonly gap?: { readonly x0: number; readonly x1: number };
  /** A vertical wall of this height standing on the floor at column x. */
  readonly wall?: { readonly x: number; readonly height: number; readonly width?: number };
  readonly seed?: number;
  readonly wind?: number;
}

/** A flat floor from floorY down, an optional sea gap and an optional wall, with fake tile contexts. */
export function flatTerrain(options: FlatWorldOptions = {}): TerrainData {
  const width = options.width ?? 400;
  const height = options.height ?? 300;
  const floorY = options.floorY ?? 200;
  const mask = createMask(width, height);
  for (let y = floorY; y < height; y += 1) {
    if (options.gap === undefined) {
      setSpan(mask, y, 0, width - 1, SOLID);
    } else {
      setSpan(mask, y, 0, options.gap.x0 - 1, SOLID);
      setSpan(mask, y, options.gap.x1 + 1, width - 1, SOLID);
    }
  }
  if (options.wall !== undefined && options.wall.height > 0) {
    const w = options.wall.width ?? 4;
    for (let y = floorY - options.wall.height; y < floorY; y += 1) setSpan(mask, y, options.wall.x, options.wall.x + w - 1, SOLID);
  }
  const tiles = createTiles(width, height, createFakeFactory().factory);
  return {
    width,
    height,
    mask,
    tiles,
    water: createWater(options.waterY ?? height - 20),
    theme: DEFAULT_THEME,
    seed: options.seed ?? 1,
    source: 'procedural',
  };
}

export function flatWorld(options: FlatWorldOptions = {}): SimWorld {
  return createWorld(flatTerrain(options), { seed: options.seed ?? 1, ...(options.wind === undefined ? {} : { wind: options.wind }) });
}
