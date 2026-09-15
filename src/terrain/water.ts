/**
 * Water (architecture.md section B): the surface is a single world y. Sudden death raises it by
 * GAME_CONFIG.suddenDeath.waterRisePxPerTurn each turn (ultraplan rev 2 reconciled constants:
 * 20 px per turn), which in screen space means the value decreases. Anything whose lowest point
 * is below the surface drowns.
 *
 * Rendering is two tileable bands scrolled by sine offsets: one behind the entities at full
 * alpha and one in front at 0.45, moving in opposite directions so they read as depth. The
 * offsets are a pure function of time; the renderer owns the textures.
 */

import { GAME_CONFIG } from '../config/game-config.ts';

/** How far above the bottom edge the water starts. */
export const DEFAULT_WATER_MARGIN = 40;
export const WATER_FRONT_ALPHA = 0.45;
export const WATER_RISE_PX_PER_TURN: number = GAME_CONFIG.suddenDeath.waterRisePxPerTurn;

export interface WaterState {
  /** World y of the surface; larger y is deeper. */
  readonly y: number;
}

export function createWater(y: number): WaterState {
  return Object.freeze({ y });
}

export function initialWaterY(height: number, margin: number = DEFAULT_WATER_MARGIN): number {
  return height - margin;
}

/** The surface after `turns` sudden death turns; never above the top of the map. */
export function rise(water: WaterState, turns = 1): WaterState {
  if (turns === 0) return water;
  return createWater(Math.max(0, water.y - turns * WATER_RISE_PX_PER_TURN));
}

/** True when the lowest point (y plus height) is below the surface. */
export function isDrowned(water: WaterState, y: number, height = 0): boolean {
  return y + height > water.y;
}

export interface BandOffset {
  /** Horizontal scroll in texture px, inside [0, tileWidth). */
  readonly dx: number;
  /** Vertical bob in px. */
  readonly dy: number;
  readonly alpha: number;
}

export interface WaterBands {
  readonly behind: BandOffset;
  readonly front: BandOffset;
}

const BEHIND_SPEED_PX_PER_MS = 0.024;
const FRONT_SPEED_PX_PER_MS = 0.036;
const BOB_AMPLITUDE_PX = 3;
const BEHIND_BOB_PERIOD_MS = 2600;
const FRONT_BOB_PERIOD_MS = 1900;

/** Positive modulo that never returns negative zero, so a resting band compares equal to 0. */
function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function plainZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Scroll and bob offsets for both bands at a wall clock time. */
export function waterBandOffsets(timeMs: number, tileWidth: number): WaterBands {
  const t = Number.isFinite(timeMs) ? timeMs : 0;
  const width = tileWidth > 0 ? tileWidth : 1;
  const behind: BandOffset = Object.freeze({
    dx: wrap(t * BEHIND_SPEED_PX_PER_MS, width),
    dy: plainZero(BOB_AMPLITUDE_PX * Math.sin((2 * Math.PI * t) / BEHIND_BOB_PERIOD_MS)),
    alpha: 1,
  });
  const front: BandOffset = Object.freeze({
    dx: wrap(-t * FRONT_SPEED_PX_PER_MS, width),
    dy: plainZero(-BOB_AMPLITUDE_PX * Math.sin((2 * Math.PI * t) / FRONT_BOB_PERIOD_MS)),
    alpha: WATER_FRONT_ALPHA,
  });
  return Object.freeze({ behind, front });
}
