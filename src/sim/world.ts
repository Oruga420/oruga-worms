/**
 * The simulation world (architecture.md section C): owns the terrain, the wind, gravity, the
 * seeded rng and the entity lists, and steps everything once per tick in a fixed order (worms,
 * projectiles, crates, mines, sheep, crate pickups). Events accumulate in `events` and are
 * drained by the caller after each tick; the match reducer, the audio mixer and the particles
 * read them. Entity arrays are compacted after each step so dead bodies do not linger.
 */

import { createRng, type Rng } from '../core/rng.ts';
import type { TerrainData } from '../terrain/terrain.ts';
import { withWater } from '../terrain/terrain.ts';
import { createWater } from '../terrain/water.ts';
import { GRAVITY_PX_PER_S2, TICK_S } from './constants.ts';
import { collectCrates, stepCrate } from './crate.ts';
import { stepMine } from './mine.ts';
import { stepProjectile } from './projectile.ts';
import { allAtRest } from './rest.ts';
import { stepSheep } from './sheep.ts';
import { IDLE_INTENT, type CrateBody, type MineBody, type ProjectileBody, type SheepBody, type SimEvent, type WormBody, type WormIntent } from './types.ts';
import { stepWorm } from './worm-controller.ts';

export interface SimWorld {
  terrain: TerrainData;
  /** Wind as a fraction of gravity, -1.19..1.19, positive blows right. */
  wind: number;
  readonly gravity: number;
  readonly rng: Rng;
  readonly worms: WormBody[];
  projectiles: ProjectileBody[];
  crates: CrateBody[];
  mines: MineBody[];
  sheep: SheepBody[];
  readonly events: SimEvent[];
  tick: number;
  nextId(): number;
}

export interface WorldOptions {
  readonly seed: number;
  readonly wind?: number;
  readonly gravity?: number;
}

export function createWorld(terrain: TerrainData, options: WorldOptions): SimWorld {
  let ids = 0;
  return {
    terrain,
    wind: options.wind ?? 0,
    gravity: options.gravity ?? GRAVITY_PX_PER_S2,
    rng: createRng(options.seed),
    worms: [],
    projectiles: [],
    crates: [],
    mines: [],
    sheep: [],
    events: [],
    tick: 0,
    nextId: () => {
      ids += 1;
      return ids;
    },
  };
}

export interface AddWormParams {
  readonly id: string;
  readonly teamId: string;
  readonly x: number;
  readonly y: number;
  readonly facing?: 1 | -1;
}

export function addWorm(world: SimWorld, params: AddWormParams): WormBody {
  const worm: WormBody = {
    id: params.id,
    teamId: params.teamId,
    x: params.x,
    y: params.y,
    vx: 0,
    vy: 0,
    facing: params.facing ?? 1,
    motion: 'idle',
    onGround: true,
    fallStartY: params.y,
    exemptNextLanding: false,
    restTicks: 0,
    alive: true,
    fuelMs: 0,
    drownTicks: 0,
  };
  world.worms.push(worm);
  return worm;
}

export function findWorm(world: SimWorld, id: string): WormBody | undefined {
  return world.worms.find((w) => w.id === id);
}

export function setWaterY(world: SimWorld, y: number): void {
  world.terrain = withWater(world.terrain, createWater(y));
}

/** One fixed step. Intents are per worm id; missing ids idle. Returns the events of this tick and clears the queue. */
export function stepWorld(world: SimWorld, intents: ReadonlyMap<string, WormIntent> = new Map()): SimEvent[] {
  const dt = TICK_S;
  world.tick += 1;
  // Snapshots: bodies spawned during this tick (cluster children, strike bombs) step from the next tick.
  for (const worm of world.worms) stepWorm(world, worm, intents.get(worm.id) ?? IDLE_INTENT, dt);
  for (const projectile of [...world.projectiles]) stepProjectile(world, projectile, dt);
  for (const crate of [...world.crates]) stepCrate(world, crate, dt);
  for (const mine of [...world.mines]) stepMine(world, mine, dt);
  for (const sheep of [...world.sheep]) stepSheep(world, sheep, dt);
  collectCrates(world);
  world.projectiles = world.projectiles.filter((p) => p.alive);
  world.crates = world.crates.filter((c) => c.alive);
  world.mines = world.mines.filter((m) => m.alive);
  world.sheep = world.sheep.filter((s) => s.alive);
  const events = world.events.splice(0, world.events.length);
  return events;
}

export function worldAtRest(world: SimWorld): boolean {
  return allAtRest(world);
}

/** Steps until everything is at rest or maxTicks pass; returns the ticks used and all events. */
export function settle(world: SimWorld, maxTicks: number): { ticks: number; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let ticks = 0;
  while (ticks < maxTicks && !worldAtRest(world)) {
    events.push(...stepWorld(world));
    ticks += 1;
  }
  return { ticks, events };
}
