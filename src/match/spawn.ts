/**
 * Worm placement on a terrain surface. The terrain module hands over `tops`: for every x column
 * the topmost solid y, or -1 where the column has no ground. A column is standable when it has
 * ground above the water line, headroom above the surface (the world top counts as a wall), and
 * the footprint columns around it share the surface height within a slope tolerance.
 *
 * Placement is deterministic for a given rng: pick a random standable column, drop every column
 * closer than the minimum separation, repeat. A few attempts absorb unlucky first picks; when
 * the map cannot hold every worm the caller gets an Err with the counts instead of a partial
 * spawn (setup.ts then asks for another map or a smaller team sheet).
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import { err, ok, type Result } from '../core/result.ts';
import type { Rng } from '../core/rng.ts';
import { deepFreeze } from './immutable.ts';
import type { MatchState } from './state.ts';

export interface SpawnPoint {
  readonly x: number;
  /** Topmost solid row at x; the worm stands with its feet on it. */
  readonly y: number;
}

export interface SpawnOptions {
  readonly waterY: number;
  readonly minSeparationPx: number;
  /** Rows of air needed above the surface. */
  readonly headroomPx: number;
  /** Columns that must share the surface height around x. */
  readonly footprintPx: number;
  readonly slopeTolerancePx: number;
  readonly edgeMarginPx: number;
  readonly attempts: number;
}

export const DEFAULT_SPAWN_OPTIONS: Omit<SpawnOptions, 'waterY'> = Object.freeze({
  minSeparationPx: 48,
  headroomPx: GAME_CONFIG.wormHitbox.h * 2,
  footprintPx: GAME_CONFIG.wormHitbox.w,
  slopeTolerancePx: 4,
  edgeMarginPx: 16,
  attempts: 8,
});

export function spawnOptions(waterY: number, overrides: Partial<Omit<SpawnOptions, 'waterY'>> = {}): SpawnOptions {
  return Object.freeze({ ...DEFAULT_SPAWN_OPTIONS, ...overrides, waterY });
}

export type SpawnErrorCode = 'BAD_INPUT' | 'NO_CANDIDATES' | 'NOT_ENOUGH_ROOM';

export interface SpawnError {
  readonly code: SpawnErrorCode;
  readonly message: string;
  readonly needed: number;
  readonly placed: number;
}

export function isStandable(tops: ArrayLike<number>, x: number, options: SpawnOptions): boolean {
  const top = tops[x];
  if (top === undefined || top < 0) return false;
  if (top >= options.waterY || top < options.headroomPx) return false;
  const half = Math.floor(options.footprintPx / 2);
  for (let dx = -half; dx <= half; dx += 1) {
    const other = tops[x + dx];
    if (other === undefined || other < 0 || Math.abs(other - top) > options.slopeTolerancePx) return false;
  }
  return true;
}

/** Every standable column between the edge margins, left to right. */
export function spawnCandidates(tops: ArrayLike<number>, options: SpawnOptions): readonly number[] {
  const columns: number[] = [];
  for (let x = options.edgeMarginPx; x < tops.length - options.edgeMarginPx; x += 1) {
    if (isStandable(tops, x, options)) columns.push(x);
  }
  return columns;
}

function pickSeparated(candidates: readonly number[], count: number, minSeparation: number, rng: Rng): readonly number[] {
  const picks: number[] = [];
  let pool = candidates;
  while (picks.length < count && pool.length > 0) {
    const chosen = pool[rng.nextInt(0, pool.length - 1)];
    if (chosen === undefined) break;
    picks.push(chosen);
    pool = pool.filter((x) => Math.abs(x - chosen) >= minSeparation);
  }
  return picks;
}

export function placeWorms(
  tops: ArrayLike<number>,
  count: number,
  options: SpawnOptions,
  rng: Rng,
): Result<readonly SpawnPoint[], SpawnError> {
  if (!Number.isInteger(count) || count < 0) {
    return err({ code: 'BAD_INPUT', message: 'count must be a non negative integer', needed: count, placed: 0 });
  }
  if (count === 0) return ok(Object.freeze([]));
  const candidates = spawnCandidates(tops, options);
  if (candidates.length === 0) {
    return err({ code: 'NO_CANDIDATES', message: 'no standable column above the water with headroom', needed: count, placed: 0 });
  }
  let best: readonly number[] = [];
  for (let attempt = 0; attempt < Math.max(1, options.attempts); attempt += 1) {
    const picks = pickSeparated(candidates, count, options.minSeparationPx, rng);
    if (picks.length === count) {
      return ok(deepFreeze(picks.map((x) => ({ x, y: tops[x] ?? -1 }))));
    }
    if (picks.length > best.length) best = picks;
  }
  return err({
    code: 'NOT_ENOUGH_ROOM',
    message: `placed ${best.length} of ${count} worms at ${options.minSeparationPx} px separation`,
    needed: count,
    placed: best.length,
  });
}

/** Assigns points to worms in team order (team 1 worm 1, team 1 worm 2, ...). */
export function applySpawnPoints(state: MatchState, points: readonly SpawnPoint[]): Result<MatchState, SpawnError> {
  const needed = state.teams.reduce((sum, team) => sum + team.worms.length, 0);
  if (points.length < needed) {
    return err({ code: 'NOT_ENOUGH_ROOM', message: `${points.length} points for ${needed} worms`, needed, placed: points.length });
  }
  let offset = 0;
  const teams = state.teams.map((team) => {
    const start = offset;
    offset += team.worms.length;
    return {
      ...team,
      worms: team.worms.map((worm, index) => {
        const point = points[start + index];
        return point === undefined ? worm : { ...worm, x: point.x, y: point.y };
      }),
    };
  });
  return ok(deepFreeze({ ...state, teams }));
}
