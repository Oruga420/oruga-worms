/**
 * Procedural island generator (architecture.md section B, procedural generation). Every level is
 * a pure function of its options and seed, so a match seed reproduces the same map on both sides
 * of a replay and tests can pin structure without golden files.
 *
 * Pipeline per level:
 *   1. Surface profile h(x): 1D fBm (4 octaves) around a mean level, scaled by the map height.
 *   2. Island falloff: a cosine weight pulls h(x) down to the bottom edge toward both sides, so
 *      the map opens to water instead of ending in a wall.
 *   3. Interior: a 2D fBm field thresholded to punch caves and overhangs, applied below a solid
 *      crust under the surface and only above the water line, so the island root stays whole.
 *      The field is sampled on a coarse grid and bilinearly interpolated (it varies over tens of
 *      px, so per pixel fBm would be 9x the work for the same shape).
 *   4. Border bedrock ring so nothing can carve the world open.
 *   5. Tops (topmost solid row per column) and the 1 px outline layer, for grass and the theme
 *      outline colour, computed from the finished mask so they can never disagree with it.
 *
 * Validation (spawn count, sealed caves) lives in validate.ts; this file only builds.
 */

import { mixSeed } from '../core/rng.ts';
import { AIR, BORDER_BEDROCK_PX, SOLID, createMask, isSolid, isValidDimension, markBorderBedrock, type TerrainMask } from './mask.ts';
import { fbm1D, fbm2D, normalizeSeed } from './noise.ts';
import { topmostSolid } from './queries.ts';
import { initialWaterY } from './water.ts';

export interface SurfaceOptions {
  /** Mean surface depth from the top as a fraction of the map height. */
  readonly level: number;
  /** Half swing of the profile as a fraction of the map height. */
  readonly amplitude: number;
  /** Horizontal wavelength of the base octave, world px. */
  readonly wavelength: number;
  readonly octaves: number;
}

export interface CaveOptions {
  /** Field values above this stay solid; 0 disables caves. */
  readonly threshold: number;
  /** Wavelength of the cave field, world px. */
  readonly wavelength: number;
  /** Rows under the surface that are always solid. */
  readonly crust: number;
  /** Coarse sampling step of the cave field, world px. */
  readonly sampleStep: number;
}

export interface GenerateOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly surface?: Partial<SurfaceOptions>;
  readonly caves?: Partial<CaveOptions>;
  /** Width of the cosine falloff on each side as a fraction of the map width; 0 for wall to wall land. */
  readonly islandFalloff?: number;
  /** Bedrock ring thickness in px; 0 disables it. */
  readonly borderBedrock?: number;
  /** World y of the water surface; caves stop here. Defaults to the water module's initial level. */
  readonly waterY?: number;
}

export interface ResolvedGenerateOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly surface: SurfaceOptions;
  readonly caves: CaveOptions;
  readonly islandFalloff: number;
  readonly borderBedrock: number;
  readonly waterY: number;
}

export interface GeneratedLevel {
  readonly mask: TerrainMask;
  /** Topmost solid row per column under the bedrock ceiling, -1 where the column is all air. */
  readonly tops: Int32Array;
  /** 1 where a solid pixel has an air 4-neighbour (the outside counts as air). */
  readonly outline: Uint8Array;
  readonly seed: number;
  readonly waterY: number;
  readonly options: ResolvedGenerateOptions;
}

export const DEFAULT_SURFACE: SurfaceOptions = Object.freeze({ level: 0.42, amplitude: 0.2, wavelength: 420, octaves: 4 });
/**
 * Cave tuning: the normalized fBm sits around 0.5 with a spread near 0.14, so a 0.36 threshold
 * hollows roughly a sixth of the band into pockets a bazooka opens; measured on the default map
 * this leaves about a tenth of the island volume sealed, which validate.ts bounds.
 */
export const DEFAULT_CAVES: CaveOptions = Object.freeze({ threshold: 0.36, wavelength: 110, crust: 12, sampleStep: 3 });
export const DEFAULT_ISLAND_FALLOFF = 0.18;

const SURFACE_SALT = 1;
const CAVE_SALT = 2;

export function resolveGenerateOptions(options: GenerateOptions): ResolvedGenerateOptions {
  if (!isValidDimension(options.width) || !isValidDimension(options.height)) {
    throw new RangeError(`level needs positive integer dimensions, got ${options.width} x ${options.height}`);
  }
  const caves: CaveOptions = { ...DEFAULT_CAVES, ...options.caves };
  if (!isValidDimension(caves.sampleStep)) {
    throw new RangeError(`caves.sampleStep must be a positive integer, got ${caves.sampleStep}`);
  }
  return Object.freeze({
    width: options.width,
    height: options.height,
    seed: normalizeSeed(options.seed),
    surface: Object.freeze({ ...DEFAULT_SURFACE, ...options.surface }),
    caves: Object.freeze(caves),
    islandFalloff: Math.min(0.5, Math.max(0, options.islandFalloff ?? DEFAULT_ISLAND_FALLOFF)),
    borderBedrock: Math.max(0, Math.floor(options.borderBedrock ?? BORDER_BEDROCK_PX)),
    waterY: options.waterY ?? initialWaterY(options.height),
  });
}

/** Cosine island weight of a column: 0 at the edge, 1 once past the falloff width. */
export function islandWeight(x: number, width: number, falloff: number): number {
  if (falloff <= 0) return 1;
  const distance = Math.min(x, width - 1 - x) / (falloff * width);
  if (distance >= 1) return 1;
  if (distance <= 0) return 0;
  return 0.5 - 0.5 * Math.cos(Math.PI * distance);
}

/** Surface y per column, in px from the top; a value at or past the height means no land. */
export function surfaceProfile(options: ResolvedGenerateOptions): Float64Array {
  const { width, height, surface } = options;
  const seed = mixSeed(options.seed, SURFACE_SALT);
  const mean = surface.level * height;
  const swing = surface.amplitude * height;
  const profile = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    const noise = fbm1D(x / surface.wavelength, seed, { octaves: surface.octaves });
    const land = mean + swing * (noise * 2 - 1);
    const weight = islandWeight(x, width, options.islandFalloff);
    profile[x] = height + (land - height) * weight;
  }
  return profile;
}

interface CoarseField {
  readonly step: number;
  readonly cols: number;
  readonly values: Float32Array;
}

function buildCaveField(options: ResolvedGenerateOptions): CoarseField {
  const { step, wavelength } = { step: options.caves.sampleStep, wavelength: options.caves.wavelength };
  const seed = mixSeed(options.seed, CAVE_SALT);
  const cols = Math.ceil(options.width / step) + 1;
  const rows = Math.ceil(options.height / step) + 1;
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      values[row * cols + col] = fbm2D((col * step) / wavelength, (row * step) / wavelength, seed);
    }
  }
  return { step, cols, values };
}

/** Bilinear sample of the coarse field at a world pixel. */
function sampleField(field: CoarseField, x: number, y: number): number {
  const fx = x / field.step;
  const fy = y / field.step;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  const tx = fx - cx;
  const ty = fy - cy;
  const i = cy * field.cols + cx;
  const v00 = field.values[i] ?? 0;
  const v10 = field.values[i + 1] ?? v00;
  const v01 = field.values[i + field.cols] ?? v00;
  const v11 = field.values[i + field.cols + 1] ?? v10;
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/** Writes SOLID under the profile, opens caves in the allowed band and rings the map in bedrock. */
export function buildMask(options: ResolvedGenerateOptions, profile: Float64Array): TerrainMask {
  const { width, height, caves, waterY } = options;
  const mask = createMask(width, height);
  const data = mask.data;
  const field = caves.threshold > 0 ? buildCaveField(options) : null;
  for (let x = 0; x < width; x += 1) {
    const top = Math.max(0, Math.ceil(profile[x] ?? height));
    if (top >= height) continue;
    const crustEnd = top + caves.crust;
    for (let y = top; y < height; y += 1) {
      const inCaveBand = field !== null && y >= crustEnd && y < waterY;
      if (inCaveBand && sampleField(field, x, y) <= caves.threshold) continue;
      data[y * width + x] = SOLID;
    }
  }
  if (options.borderBedrock > 0) markBorderBedrock(mask, options.borderBedrock);
  return mask;
}

/** Topmost solid row per column looking under the bedrock ceiling (fromRow), -1 for all air. */
export function computeTops(mask: TerrainMask, fromRow = 0): Int32Array {
  const tops = new Int32Array(mask.width);
  for (let x = 0; x < mask.width; x += 1) tops[x] = topmostSolid(mask, x, fromRow);
  return tops;
}

/** 1 where a solid pixel touches air on any of its four sides; the outside counts as air. */
export function computeOutline(mask: TerrainMask): Uint8Array {
  const { width, height, data } = mask;
  const outline = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (data[i] === AIR) continue;
      const exposed = !isSolid(mask, x - 1, y) || !isSolid(mask, x + 1, y) || !isSolid(mask, x, y - 1) || !isSolid(mask, x, y + 1);
      if (exposed) outline[i] = 1;
    }
  }
  return outline;
}

/** Builds one level from its options; deterministic per seed. */
export function generateLevel(options: GenerateOptions): GeneratedLevel {
  const resolved = resolveGenerateOptions(options);
  const mask = buildMask(resolved, surfaceProfile(resolved));
  return Object.freeze({
    mask,
    tops: computeTops(mask, resolved.borderBedrock),
    outline: computeOutline(mask),
    seed: resolved.seed,
    waterY: resolved.waterY,
    options: resolved,
  });
}
