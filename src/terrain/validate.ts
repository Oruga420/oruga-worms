/**
 * Level validation (ultraplan rev 2 risk row "Terrain generation yields unplayable maps: validate
 * spawn count and sealed caves after generation, regenerate with next seed").
 *
 * Two checks, both over the finished mask so PNG levels get the same treatment as procedural ones:
 *   - Sky flood fill. Air 4-connected to the sky row (the first row holding any air, which sits
 *     right under the bedrock ceiling) is reachable; any other air is a sealed cave. Sealed
 *     pockets are part of the game (a bazooka opens them), so the bound is loose and measured
 *     against the island volume: sealed air over solid plus sealed air. It catches the degenerate
 *     swiss cheese map, not a normal cavern.
 *   - Spawn candidates. Every `step` px a column is probed for its ground: the first solid pixel
 *     under the reachable sky. The ground must sit above the water and carry a clear, reachable
 *     box of `footprint` x `headroom` px; a greedy left to right pass keeps candidates at least
 *     `separation` px apart, which is the largest such subset on a line.
 *
 * generateUntilValid steps the seed by one per attempt so the sequence is reproducible and a
 * failing seed can be reported by number.
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import { err, ok, type Result } from '../core/result.ts';
import { generateLevel, type GenerateOptions, type GeneratedLevel } from './generate.ts';
import { AIR, type TerrainMask } from './mask.ts';

export interface SpawnRules {
  /** Spawn points the level must offer. */
  readonly minSpawns: number;
  /** Minimum horizontal distance between spawn points, world px. */
  readonly separation: number;
  /** Air required above the ground, world px. */
  readonly headroom: number;
  /** Width of the stance that must be clear, world px (odd, centered on the column). */
  readonly footprint: number;
  /** Columns are probed every this many px. */
  readonly step: number;
  /** Largest share of the island volume (solid plus sealed air) that may be sealed caves. */
  readonly maxSealedFraction: number;
}

export const DEFAULT_SPAWN_RULES: SpawnRules = Object.freeze({
  minSpawns: 8,
  separation: 48,
  headroom: GAME_CONFIG.wormHitbox.h + 8,
  footprint: GAME_CONFIG.wormHitbox.w,
  step: 4,
  maxSealedFraction: 0.2,
});

export interface Spawn {
  readonly x: number;
  /** Row of the solid pixel under the feet. */
  readonly y: number;
}

export interface LevelReport {
  readonly spawns: readonly Spawn[];
  /** Row the flood fill started from, -1 for a fully solid mask. */
  readonly skyRow: number;
  readonly solidPixels: number;
  readonly airPixels: number;
  /** Air pixels not connected to the sky. */
  readonly sealedAirPixels: number;
  /** sealedAirPixels over solidPixels plus sealedAirPixels; 0 for an empty island. */
  readonly sealedFraction: number;
}

export type LevelRejection =
  | {
      readonly code: 'too_few_spawns';
      readonly message: string;
      readonly found: number;
      readonly required: number;
      readonly report: LevelReport;
    }
  | {
      readonly code: 'sealed_caves';
      readonly message: string;
      readonly sealedFraction: number;
      readonly report: LevelReport;
    };

/** First row holding any air pixel, -1 for a fully solid mask. */
export function skyRow(mask: TerrainMask): number {
  const { width, height, data } = mask;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[rowStart + x] === AIR) return y;
    }
  }
  return -1;
}

function visit(i: number, data: Uint8Array, reached: Uint8Array, queue: Int32Array, tail: number): number {
  if (data[i] !== AIR || reached[i] === 1) return tail;
  reached[i] = 1;
  queue[tail] = i;
  return tail + 1;
}

/**
 * 1 for every air pixel 4-connected to the sky row, 0 elsewhere. Breadth first over an
 * Int32Array queue; about 15 ms on a standard 1920 x 696 map.
 */
export function skyReachable(mask: TerrainMask, start: number = skyRow(mask)): Uint8Array {
  const { width, height, data } = mask;
  const reached = new Uint8Array(width * height);
  if (start < 0 || start >= height) return reached;
  // The queue and the visited layer are the working state of the fill; nothing escapes it.
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let x = 0; x < width; x += 1) tail = visit(start * width + x, data, reached, queue, tail);
  while (head < tail) {
    const i = queue[head] ?? 0;
    head += 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) tail = visit(i - 1, data, reached, queue, tail);
    if (x < width - 1) tail = visit(i + 1, data, reached, queue, tail);
    if (y > 0) tail = visit(i - width, data, reached, queue, tail);
    if (y < height - 1) tail = visit(i + width, data, reached, queue, tail);
  }
  return reached;
}

/**
 * Row of the ground under the reachable sky in a column: the first pixel below the sky row that
 * is not reachable air (necessarily solid, since sealed air never touches reachable air). -1 when
 * the sky row itself is blocked there or the column is open water down to the bottom.
 */
export function groundBelowSky(mask: TerrainMask, reached: Uint8Array, x: number, sky: number): number {
  if (sky < 0 || x < 0 || x >= mask.width) return -1;
  let y = sky;
  while (y < mask.height && reached[y * mask.width + x] === 1) y += 1;
  return y === sky || y >= mask.height ? -1 : y;
}

/** True when the footprint x headroom box above a ground pixel is air reachable from the sky. */
function hasClearHeadroom(mask: TerrainMask, reached: Uint8Array, x: number, groundY: number, rules: SpawnRules): boolean {
  const half = Math.floor(rules.footprint / 2);
  if (groundY - rules.headroom < 0) return false;
  for (let dy = 1; dy <= rules.headroom; dy += 1) {
    const rowStart = (groundY - dy) * mask.width;
    for (let dx = -half; dx <= half; dx += 1) {
      const px = x + dx;
      if (px < 0 || px >= mask.width || reached[rowStart + px] !== 1) return false;
    }
  }
  return true;
}

/** Spawn points on ground above the water with clear reachable headroom, at least `separation` apart. */
export function findSpawns(
  mask: TerrainMask,
  reached: Uint8Array,
  sky: number,
  waterY: number,
  rules: SpawnRules,
): Spawn[] {
  const spawns: Spawn[] = [];
  const half = Math.floor(rules.footprint / 2);
  const step = Math.max(1, Math.floor(rules.step));
  let lastX = Number.NEGATIVE_INFINITY;
  for (let x = half; x < mask.width - half; x += step) {
    if (x - lastX < rules.separation) continue;
    const ground = groundBelowSky(mask, reached, x, sky);
    if (ground < 0 || ground >= waterY) continue;
    if (!hasClearHeadroom(mask, reached, x, ground, rules)) continue;
    spawns.push(Object.freeze({ x, y: ground }));
    lastX = x;
  }
  return spawns;
}

function countByte(bytes: Uint8Array, value: number): number {
  let count = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === value) count += 1;
  }
  return count;
}

export function reportLevel(mask: TerrainMask, waterY: number, rules: SpawnRules = DEFAULT_SPAWN_RULES): LevelReport {
  const sky = skyRow(mask);
  const reached = skyReachable(mask, sky);
  const airPixels = countByte(mask.data, AIR);
  const solidPixels = mask.width * mask.height - airPixels;
  const sealedAirPixels = airPixels - countByte(reached, 1);
  const island = solidPixels + sealedAirPixels;
  return Object.freeze({
    spawns: Object.freeze(findSpawns(mask, reached, sky, waterY, rules)),
    skyRow: sky,
    solidPixels,
    airPixels,
    sealedAirPixels,
    sealedFraction: island === 0 ? 0 : sealedAirPixels / island,
  });
}

/** Accepts a level that offers enough spawns and does not hide too much of its island in sealed caves. */
export function validateLevel(
  mask: TerrainMask,
  waterY: number,
  rules: SpawnRules = DEFAULT_SPAWN_RULES,
): Result<LevelReport, LevelRejection> {
  const report = reportLevel(mask, waterY, rules);
  if (report.sealedFraction > rules.maxSealedFraction) {
    return err(
      Object.freeze({
        code: 'sealed_caves' as const,
        message: `sealed caves are ${(report.sealedFraction * 100).toFixed(1)} percent of the island, limit ${rules.maxSealedFraction * 100}`,
        sealedFraction: report.sealedFraction,
        report,
      }),
    );
  }
  if (report.spawns.length < rules.minSpawns) {
    return err(
      Object.freeze({
        code: 'too_few_spawns' as const,
        message: `level offers ${report.spawns.length} spawn points, ${rules.minSpawns} required`,
        found: report.spawns.length,
        required: rules.minSpawns,
        report,
      }),
    );
  }
  return ok(report);
}

export interface ValidLevel {
  readonly level: GeneratedLevel;
  readonly report: LevelReport;
  /** Attempts used, 1 when the first seed passed. */
  readonly attempts: number;
}

export interface GenerationExhausted {
  readonly code: 'exhausted';
  readonly message: string;
  readonly attempts: number;
  readonly lastSeed: number;
  readonly lastRejection: LevelRejection;
}

export const DEFAULT_MAX_ATTEMPTS = 12;

/** Generates with seed, seed + 1, ... until validateLevel accepts one or the attempts run out. */
export function generateUntilValid(
  options: GenerateOptions,
  rules: SpawnRules = DEFAULT_SPAWN_RULES,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Result<ValidLevel, GenerationExhausted> {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  let lastRejection: LevelRejection | null = null;
  let lastSeed = options.seed;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastSeed = options.seed + attempt;
    const level = generateLevel({ ...options, seed: lastSeed });
    const verdict = validateLevel(level.mask, level.waterY, rules);
    if (verdict.ok) return ok(Object.freeze({ level, report: verdict.value, attempts: attempt + 1 }));
    lastRejection = verdict.error;
  }
  return err(
    Object.freeze({
      code: 'exhausted' as const,
      message: `no valid level in ${attempts} attempts from seed ${options.seed}; last: ${lastRejection?.message ?? 'no attempt ran'}`,
      attempts,
      lastSeed,
      lastRejection: lastRejection ?? emptyRejection(),
    }),
  );
}

/** Placeholder for the impossible zero attempt case; attempts is clamped to at least 1. */
function emptyRejection(): LevelRejection {
  return Object.freeze({
    code: 'too_few_spawns' as const,
    message: 'no attempt ran',
    found: 0,
    required: 0,
    report: Object.freeze({
      spawns: Object.freeze([]),
      skyRow: -1,
      solidPixels: 0,
      airPixels: 0,
      sealedAirPixels: 0,
      sealedFraction: 0,
    }),
  });
}
