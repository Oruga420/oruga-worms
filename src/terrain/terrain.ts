/**
 * TerrainData: the bundle the rest of the game holds (architecture.md section B data structures,
 * ultraplan rev 2 Phase 1B). It pairs the byte mask (simulation truth) with the visual tiles and
 * the water surface, and its lifecycle functions are the only place where mask and tiles change
 * together: a carve writes the mask, takes the spans the mask reports, and erases exactly those
 * spans from the tiles ("write the mask and the tiles together so they can never diverge").
 *
 * The bundle itself is frozen. The mask bytes and the tile canvases are the documented mutable
 * hot paths (mask.ts, tiles.ts); the water surface is immutable and replaced through withWater.
 */

import { ok, type Result } from '../core/result.ts';
import { carveCircle, carveRect, type CarveResult } from './carve.ts';
import type { ContextFactory, PixelSize } from './context.ts';
import { computeOutline, type GenerateOptions } from './generate.ts';
import { AIR, BEDROCK, SOLID, countSolid, maskSpans, type ByteGrid, type TerrainMask } from './mask.ts';
import { loadPngLevel, type PngLevelError, type ReadbackContextFactory } from './png-level.ts';
import {
  DEFAULT_SCORCH,
  applyCarveSpans,
  createTiles,
  fillSpans,
  type ScorchStyle,
  type TerrainTiles,
  type TilesOptions,
} from './tiles.ts';
import {
  DEFAULT_SPAWN_RULES,
  generateUntilValid,
  type GenerationExhausted,
  type LevelReport,
  type SpawnRules,
} from './validate.ts';
import { createWater, initialWaterY, rise, type WaterState } from './water.ts';

/** Flat colours until the textured pass (source-in over a tileable texture) lands with the assets. */
export interface TerrainTheme {
  readonly id: string;
  readonly land: string;
  readonly bedrock: string;
  readonly outline: string;
  /** Crust painted on upward facing surfaces; craters expose bare land, which is the point. */
  readonly grass: string;
  /** Depth of that crust in world px; 0 disables it. */
  readonly grassDepthPx: number;
  /** Darker soil under the crust, so the dirt does not read as one flat slab. */
  readonly topsoil: string;
  readonly topsoilDepthPx: number;
  readonly scorch: ScorchStyle;
}

export const DEFAULT_THEME: TerrainTheme = Object.freeze({
  id: 'meadow',
  land: '#7a5433',
  bedrock: '#3a3a44',
  outline: '#241508',
  grass: '#5ea63c',
  grassDepthPx: 5,
  topsoil: '#63421f',
  topsoilDepthPx: 18,
  scorch: DEFAULT_SCORCH,
});

export type TerrainSource = 'procedural' | 'png';

export interface TerrainData {
  /** World px. */
  readonly width: number;
  readonly height: number;
  /** Simulation truth; its bytes are the mutable hot path described in mask.ts. */
  readonly mask: TerrainMask;
  /** Visual only; its canvases are the mutable hot path described in tiles.ts. */
  readonly tiles: TerrainTiles;
  readonly water: WaterState;
  readonly theme: TerrainTheme;
  readonly seed: number;
  readonly source: TerrainSource;
}

export interface TerrainOptions {
  readonly theme?: TerrainTheme;
  readonly tiles?: TilesOptions;
}

export interface ProceduralTerrainOptions extends TerrainOptions {
  readonly generate: GenerateOptions;
  readonly rules?: SpawnRules;
  readonly maxAttempts?: number;
}

export interface ProceduralTerrain {
  readonly terrain: TerrainData;
  readonly report: LevelReport;
  readonly attempts: number;
}

export interface PngTerrainOptions extends TerrainOptions {
  readonly seed?: number;
  readonly waterY?: number;
}

/** Runs of a byte layer as spans, for painting. */
function layerSpans(layer: ByteGrid): ReturnType<typeof maskSpans> {
  return maskSpans(layer, (value) => value !== 0);
}

/**
 * Solid pixels lying within `depth` px below air, per column: the grass crust on upward facing
 * surfaces, including cave ceilings. A carve never repaints it, so craters expose bare land.
 */
export function surfaceBand(mask: TerrainMask, depth: number): Uint8Array {
  const { width, height, data } = mask;
  const out = new Uint8Array(width * height);
  if (depth <= 0) return out;
  for (let x = 0; x < width; x += 1) {
    let run = depth + 1;
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x;
      if (data[index] === AIR) {
        run = 0;
        continue;
      }
      run += 1;
      if (data[index] === SOLID && run <= depth) out[index] = 1;
    }
  }
  return out;
}

/**
 * Paints a freshly built mask into the tiles through the same span rasterizer the carve uses:
 * land, then the grass crust, then bedrock, then the 1 px outline on top.
 */
export function paintMask(tiles: TerrainTiles, mask: TerrainMask, theme: TerrainTheme, outline: Uint8Array | null = null): void {
  fillSpans(tiles, maskSpans(mask, (value) => value === SOLID), theme.land);
  // Deepest band first, then the crust on top of it, so the strata layer correctly.
  if (theme.topsoilDepthPx > 0) {
    const soil = surfaceBand(mask, theme.topsoilDepthPx);
    fillSpans(tiles, layerSpans({ width: mask.width, height: mask.height, data: soil }), theme.topsoil);
  }
  if (theme.grassDepthPx > 0) {
    const band = surfaceBand(mask, theme.grassDepthPx);
    fillSpans(tiles, layerSpans({ width: mask.width, height: mask.height, data: band }), theme.grass);
  }
  fillSpans(tiles, maskSpans(mask, (value) => value === BEDROCK), theme.bedrock);
  if (outline !== null) {
    fillSpans(tiles, layerSpans({ width: mask.width, height: mask.height, data: outline }), theme.outline);
  }
}

function bundle(
  mask: TerrainMask,
  tiles: TerrainTiles,
  water: WaterState,
  theme: TerrainTheme,
  seed: number,
  source: TerrainSource,
): TerrainData {
  return Object.freeze({ width: mask.width, height: mask.height, mask, tiles, water, theme, seed, source });
}

/** Generates a validated island, paints it and bundles it; Err when no seed in range passes. */
export function createProcedural(
  options: ProceduralTerrainOptions,
  createContext: ContextFactory,
): Result<ProceduralTerrain, GenerationExhausted> {
  const built = generateUntilValid(options.generate, options.rules ?? DEFAULT_SPAWN_RULES, options.maxAttempts);
  if (!built.ok) return built;
  const { level, report, attempts } = built.value;
  const theme = options.theme ?? DEFAULT_THEME;
  const tiles = createTiles(level.mask.width, level.mask.height, createContext, options.tiles ?? {});
  paintMask(tiles, level.mask, theme, level.outline);
  const terrain = bundle(level.mask, tiles, createWater(level.waterY), theme, level.seed, 'procedural');
  return ok(Object.freeze({ terrain, report, attempts }));
}

/** Loads a PNG mask level (png-level.ts), paints it and bundles it. */
export function createFromPng(
  image: PixelSize,
  expected: PixelSize,
  createReadback: ReadbackContextFactory,
  createContext: ContextFactory,
  options: PngTerrainOptions = {},
): Result<TerrainData, PngLevelError> {
  const loaded = loadPngLevel(image, expected, createReadback);
  if (!loaded.ok) return loaded;
  const mask = loaded.value;
  const theme = options.theme ?? DEFAULT_THEME;
  const tiles = createTiles(mask.width, mask.height, createContext, options.tiles ?? {});
  paintMask(tiles, mask, theme, computeOutline(mask));
  const water = createWater(options.waterY ?? initialWaterY(mask.height));
  return ok(bundle(mask, tiles, water, theme, options.seed ?? 0, 'png'));
}

/**
 * Explosion crater: carves the mask, then erases exactly the returned spans from the tiles and
 * paints the scorch ring. Returns the carve result (spans and pixels removed) for debris,
 * scoring and the "terrain changed" smoke check.
 */
export function carve(terrain: TerrainData, cx: number, cy: number, r: number): CarveResult {
  const result = carveCircle(terrain.mask, cx, cy, r);
  applyCarveSpans(terrain.tiles, result.spans, { cx, cy, r }, terrain.theme.scorch);
  return result;
}

/** Girder: writes bedrock into the mask and paints the same spans in the theme's bedrock colour. */
export function placeGirder(terrain: TerrainData, x: number, y: number, w: number, h: number): CarveResult {
  const result = carveRect(terrain.mask, x, y, w, h, BEDROCK);
  fillSpans(terrain.tiles, result.spans, terrain.theme.bedrock);
  return result;
}

/** SOLID plus BEDROCK pixels, the number the smoke test watches drop after a shot. */
export function solidCount(terrain: TerrainData): number {
  return countSolid(terrain.mask);
}

/** Same mask and tiles, new water surface. */
export function withWater(terrain: TerrainData, water: WaterState): TerrainData {
  return terrain.water === water ? terrain : Object.freeze({ ...terrain, water });
}

/** Sudden death step: the water surface after `turns` turns. */
export function riseWater(terrain: TerrainData, turns = 1): TerrainData {
  return withWater(terrain, rise(terrain.water, turns));
}
