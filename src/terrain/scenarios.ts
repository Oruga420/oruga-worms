/**
 * The scenarios a match is played on: the procedural island the game started with, and three built
 * ones, a spaceship adrift in deep space, a castle on a hill at dusk, and Kame House on its little
 * island in a tropical sea. A built scenario writes its shapes straight into the mask
 * (terrain/scenarios/*.ts, over the shape fills of shapes.ts), colours its details on the tiles
 * after the theme has painted the mask (portholes, stone, the pink house), and leaves the
 * renderer a list of props to draw and animate over the land (engines, flags, palms, the sign).
 * Each one also brings its own sky and water (game/scenery.ts draws them).
 *
 * The match setup carries the pick (team setup card, or ?map= in the URL); terrain.ts builds it
 * through createScenario, and the same spawn and sealed cave checks as the island's apply.
 */

import type { TerrainMask } from './mask.ts';
import { buildCastle } from './scenarios/castle.ts';
import { buildKameHouse } from './scenarios/kame-house.ts';
import { buildSpaceship } from './scenarios/spaceship.ts';
import { DEFAULT_SCORCH, type TerrainTiles } from './tiles.ts';
import type { TerrainTheme } from './terrain.ts';

export const SCENARIO_IDS = ['island', 'spaceship', 'castle', 'kame_house'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const DEFAULT_SCENARIO: ScenarioId = 'island';
/** The URL query key that pins a scenario: ?map=castle. */
export const SCENARIO_PARAM = 'map';

/** A light in the sky: the sun, or the moon over the castle. */
export interface SkyLight {
  /** Fractions of the viewport. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
}

export interface SkyPlanet extends SkyLight {
  readonly shade: string;
  readonly ring: string | null;
}

export interface SkyRidge {
  readonly color: string;
  readonly alpha: number;
}

export interface WaterLook {
  readonly top: string;
  readonly bottom: string;
  readonly foam: string;
}

/** What the renderer paints behind and under the land. */
export interface SkyTheme {
  /** Four stops, top to bottom. */
  readonly gradient: readonly [string, string, string, string];
  readonly stars: boolean;
  readonly sun: SkyLight | null;
  readonly planet: SkyPlanet | null;
  readonly clouds: boolean;
  readonly cloudColor: string;
  /** Up to two ridges behind the playfield, the far one first. */
  readonly ridges: readonly SkyRidge[];
  readonly water: WaterLook;
}

export type SceneryPropKind = 'palm' | 'flag' | 'engine' | 'beacon' | 'dish' | 'sign';

/** A decoration the renderer draws at a world point; nothing in the sim knows it is there. */
export interface SceneryProp {
  readonly kind: SceneryPropKind;
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly color?: string;
  readonly text?: string;
  readonly seed?: number;
}

/** What a terrain carries for the renderer: which scenario it is, its sky and its props. */
export interface Scenery {
  readonly id: ScenarioId;
  readonly sky: SkyTheme;
  readonly props: readonly SceneryProp[];
}

/** What a built scenario hands back: the mask, its props, and the painter of its details. */
export interface ScenarioBuild {
  readonly mask: TerrainMask;
  readonly props: readonly SceneryProp[];
  readonly paint: (tiles: TerrainTiles) => void;
}

export interface ScenarioBuildOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly waterY: number;
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly name: string;
  readonly theme: TerrainTheme;
  readonly sky: SkyTheme;
  /** Null for the procedural island, which generate.ts builds. */
  readonly build: ((options: ScenarioBuildOptions) => ScenarioBuild) | null;
}

/** Freezes a sky; typed here so the gradient stays the four stop tuple and not a string[]. */
function sky(theme: SkyTheme): SkyTheme {
  return Object.freeze(theme);
}

export const ISLAND_SKY: SkyTheme = sky({
  gradient: ['#2d6ea6', '#6aa6cf', '#a9d0e5', '#e7dcbc'],
  stars: false,
  sun: { x: 0.8, y: 0.17, radius: 34, color: '#fff3c4' },
  planet: null,
  clouds: true,
  cloudColor: '#ffffff',
  ridges: [
    { color: '#7ea6b8', alpha: 0.55 },
    { color: '#4f7a6a', alpha: 0.7 },
  ],
  water: { top: 'rgba(86, 166, 214, 0.58)', bottom: 'rgba(16, 54, 102, 0.88)', foam: 'rgba(233, 247, 255, 0.72)' },
});

const MEADOW: TerrainTheme = Object.freeze({
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

/** Steel plating: a light top skin over a darker hull. */
const STEEL: TerrainTheme = Object.freeze({
  id: 'steel',
  land: '#8c95a6',
  bedrock: '#3a3a44',
  outline: '#1f2430',
  grass: '#c2cbd8',
  grassDepthPx: 4,
  topsoil: '#747d8f',
  topsoilDepthPx: 10,
  scorch: DEFAULT_SCORCH,
});

/** Sand: a pale dry crust over darker wet sand. */
const SAND: TerrainTheme = Object.freeze({
  id: 'sand',
  land: '#d8b874',
  bedrock: '#3a3a44',
  outline: '#7a5a2a',
  grass: '#f3dfa6',
  grassDepthPx: 4,
  topsoil: '#c9a45f',
  topsoilDepthPx: 14,
  scorch: DEFAULT_SCORCH,
});

export const SCENARIOS: Readonly<Record<ScenarioId, Scenario>> = Object.freeze({
  island: Object.freeze({ id: 'island', name: 'Island', theme: MEADOW, sky: ISLAND_SKY, build: null }),
  spaceship: Object.freeze({
    id: 'spaceship',
    name: 'Spaceship',
    theme: STEEL,
    sky: sky({
      gradient: ['#04050d', '#0a0e2a', '#131842', '#1b1d48'],
      stars: true,
      sun: null,
      planet: { x: 0.2, y: 0.28, radius: 74, color: '#d08a52', shade: '#8a4a2a', ring: 'rgba(230, 200, 160, 0.6)' },
      clouds: false,
      cloudColor: '#ffffff',
      ridges: [],
      water: { top: 'rgba(60, 40, 110, 0.5)', bottom: 'rgba(6, 4, 20, 0.96)', foam: 'rgba(170, 140, 255, 0.35)' },
    }),
    build: buildSpaceship,
  }),
  castle: Object.freeze({
    id: 'castle',
    name: 'Castle',
    theme: MEADOW,
    sky: sky({
      gradient: ['#171a3f', '#4a3a6e', '#b0665a', '#f0b27a'],
      stars: true,
      sun: { x: 0.22, y: 0.2, radius: 24, color: '#eee8ff' },
      planet: null,
      clouds: true,
      cloudColor: '#d9b7c8',
      ridges: [
        { color: '#3f3556', alpha: 0.75 },
        { color: '#2a2440', alpha: 0.85 },
      ],
      water: { top: 'rgba(70, 90, 150, 0.6)', bottom: 'rgba(10, 18, 50, 0.92)', foam: 'rgba(220, 230, 255, 0.55)' },
    }),
    build: buildCastle,
  }),
  kame_house: Object.freeze({
    id: 'kame_house',
    name: 'Kame House',
    theme: SAND,
    sky: sky({
      gradient: ['#1e7fd6', '#5fb4ea', '#a9dcf3', '#e8f4d0'],
      stars: false,
      sun: { x: 0.78, y: 0.16, radius: 36, color: '#fff3c4' },
      planet: null,
      clouds: true,
      cloudColor: '#ffffff',
      ridges: [],
      water: { top: 'rgba(60, 200, 220, 0.6)', bottom: 'rgba(10, 90, 150, 0.9)', foam: 'rgba(240, 255, 255, 0.85)' },
    }),
    build: buildKameHouse,
  }),
});

export function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === 'string' && (SCENARIO_IDS as readonly string[]).includes(value);
}

/** The scenario pinned by ?map= in the URL, else null. */
export function parseScenarioParam(search: string): ScenarioId | null {
  const raw = new URLSearchParams(search).get(SCENARIO_PARAM);
  const value = raw?.trim().toLowerCase().replace(/-/g, '_');
  return isScenarioId(value) ? value : null;
}

/** The scenery of a scenario without props: what a terrain built elsewhere (a PNG, a test) carries. */
export function bareScenery(id: ScenarioId): Scenery {
  return Object.freeze({ id, sky: SCENARIOS[id].sky, props: Object.freeze([]) });
}
