/**
 * Shared constants that several tracks read: the tick rate (re exported from units.ts, which
 * stays the single source of truth), the render layer order from architecture.md section A,
 * the terrain mask values shared by terrain and sim, the world size bounds from the ultraplan
 * "Simulation units and tuning" card, and the canvas ids that index.html declares.
 *
 * Everything here is frozen data. No enums (erasableSyntaxOnly): the mask and layer tables are
 * frozen objects with a matching union type.
 */

import { SIM_HZ } from './units.ts';

/** Simulation ticks per second. Alias of units.ts SIM_HZ so callers can import from one place. */
export const TICK_RATE = SIM_HZ;

/**
 * Render layer order (architecture.md section A). Layers 0 to 9 draw on the world canvas every
 * frame; 10 and 11 draw on the HUD canvas only when a HUD value changes.
 */
export const LAYER = Object.freeze({
  SKY: 0,
  FAR_PARALLAX: 1,
  NEAR_PARALLAX: 2,
  TERRAIN_GLOW: 3,
  TERRAIN: 4,
  ENTITIES_BACK: 5,
  WORMS: 6,
  PROJECTILES: 7,
  PARTICLES: 8,
  WATER_FRONT: 9,
  HUD_WORLD: 10,
  HUD_SCREEN: 11,
} as const);

export type LayerName = keyof typeof LAYER;
export type Layer = (typeof LAYER)[LayerName];

/** First layer index that belongs to the HUD canvas. */
export const FIRST_HUD_LAYER: Layer = LAYER.HUD_WORLD;

/** Layer names in draw order, for renderers that iterate. */
export const LAYER_ORDER: readonly LayerName[] = Object.freeze(
  (Object.keys(LAYER) as LayerName[]).sort((a, b) => LAYER[a] - LAYER[b]),
);

export function isHudLayer(layer: Layer): boolean {
  return layer >= FIRST_HUD_LAYER;
}

/**
 * Terrain mask byte values. The Uint8Array mask is simulation truth (architecture.md, the load
 * bearing rule); terrain writes these and sim reads them. BEDROCK never carves.
 */
export const MASK = Object.freeze({
  AIR: 0,
  SOLID: 1,
  BEDROCK: 2,
} as const);

export type MaskValue = (typeof MASK)[keyof typeof MASK];

export function isMaskValue(value: number): value is MaskValue {
  return value === MASK.AIR || value === MASK.SOLID || value === MASK.BEDROCK;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** Standard Worms Armageddon map in world px (ultraplan "Simulation units and tuning"). */
export const WORLD_SIZE_DEFAULT: Size = Object.freeze({ w: 1920, h: 696 });

/** Largest supported world, twice the standard map in both axes. */
export const WORLD_SIZE_MAX: Size = Object.freeze({ w: 3840, h: 1392 });

export function isValidWorldSize(size: Size): boolean {
  return (
    Number.isInteger(size.w) &&
    Number.isInteger(size.h) &&
    size.w > 0 &&
    size.h > 0 &&
    size.w <= WORLD_SIZE_MAX.w &&
    size.h <= WORLD_SIZE_MAX.h
  );
}

/** The two stacked canvases declared in index.html. */
export const CANVAS_IDS = Object.freeze({
  world: 'world',
  hud: 'hud',
} as const);

export type CanvasId = (typeof CANVAS_IDS)[keyof typeof CANVAS_IDS];
