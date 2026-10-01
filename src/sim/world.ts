/**
 * The simulation world (architecture.md section C): owns the terrain, the wind, gravity, the
 * seeded rng and the entity lists, and steps everything once per tick in a fixed order (worms,
 * combos, beams, devours, hexes, sprouts, techniques, projectiles, crates, mines, sheep, crate
 * pickups). Events accumulate in `events` and are
 * drained by the caller after each tick; the match reducer, the audio mixer and the particles
 * read them. Entity arrays are compacted after each step so dead bodies do not linger.
 */

import { createRng, type Rng } from '../core/rng.ts';
import type { TerrainData } from '../terrain/terrain.ts';
import { withWater } from '../terrain/terrain.ts';
import { createWater } from '../terrain/water.ts';
import { GRAVITY_PX_PER_S2, TICK_S } from './constants.ts';
import { heldByBeams, stepBeam } from './beam.ts';
import { heldWormIds, stepCombo } from './combo.ts';
import { collectCrates, stepCrate } from './crate.ts';
import { heldByDevours, stepDevour } from './devour.ts';
import { heldByHexes, stepHex } from './hex.ts';
import { heldBySprouts, stepSprout } from './sprout.ts';
import { heldByTechniques, stepTechnique } from './technique.ts';
import { stepMine } from './mine.ts';
import { stepProjectile } from './projectile.ts';
import { allAtRest } from './rest.ts';
import { stepSheep } from './sheep.ts';
import { IDLE_INTENT, type BeamBody, type ComboBody, type CrateBody, type DevourBody, type HexBody, type MineBody, type ProjectileBody, type SheepBody, type SimEvent, type SproutBody, type TechniqueBody, type WormBody, type WormIntent } from './types.ts';
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
  /** Super moves in progress (sim/combo.ts); they hold their worms while they play. */
  combos: ComboBody[];
  /** Beam supers in progress (sim/beam.ts); they hold their attackers while they play. */
  beams: BeamBody[];
  /** Gear 5 in progress (sim/devour.ts); it holds the eater, and the victim until it is swallowed. */
  devours: DevourBody[];
  /** The Freezer in progress (sim/hex.ts); it holds both worms until the burst. */
  hexes: HexBody[];
  /** Saibaman seeds in the ground (sim/sprout.ts); each holds its planter until the Saibaman is out. */
  sprouts: SproutBody[];
  /** The techniques of the anime row in progress (sim/technique.ts); each holds its worms while it plays. */
  techniques: TechniqueBody[];
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
    combos: [],
    beams: [],
    devours: [],
    hexes: [],
    sprouts: [],
    techniques: [],
    events: [],
    tick: 0,
    nextId: () => {
      ids += 1;
      return ids;
    },
  };
}

export { addWorm, type AddWormParams } from './worm-body.ts';

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
  // A worm a combo, a beam, a devour, a hex, a sprout or a technique holds is placed by it instead, right after the others moved.
  const held = heldWormIds(world.combos);
  const beaming = heldByBeams(world.beams);
  const eating = heldByDevours(world.devours);
  const hexed = heldByHexes(world.hexes);
  const planting = heldBySprouts(world.sprouts);
  const performing = heldByTechniques(world.techniques);
  // A Saibaman that leaps out of the ground this tick steps from the next one.
  for (const worm of [...world.worms]) {
    if (held.has(worm.id) || beaming.has(worm.id) || eating.has(worm.id) || hexed.has(worm.id) || planting.has(worm.id) || performing.has(worm.id)) continue;
    stepWorm(world, worm, intents.get(worm.id) ?? IDLE_INTENT, dt);
  }
  for (const combo of [...world.combos]) stepCombo(world, combo);
  for (const beam of [...world.beams]) stepBeam(world, beam);
  for (const devour of [...world.devours]) stepDevour(world, devour);
  for (const hex of [...world.hexes]) stepHex(world, hex);
  for (const sprout of [...world.sprouts]) stepSprout(world, sprout);
  for (const technique of [...world.techniques]) stepTechnique(world, technique);
  for (const projectile of [...world.projectiles]) stepProjectile(world, projectile, dt);
  for (const crate of [...world.crates]) stepCrate(world, crate, dt);
  for (const mine of [...world.mines]) stepMine(world, mine, dt);
  for (const sheep of [...world.sheep]) stepSheep(world, sheep, dt);
  collectCrates(world);
  world.projectiles = world.projectiles.filter((p) => p.alive);
  world.crates = world.crates.filter((c) => c.alive);
  world.mines = world.mines.filter((m) => m.alive);
  world.sheep = world.sheep.filter((s) => s.alive);
  world.combos = world.combos.filter((c) => c.alive);
  world.beams = world.beams.filter((b) => b.alive);
  world.devours = world.devours.filter((d) => d.alive);
  world.hexes = world.hexes.filter((h) => h.alive);
  world.sprouts = world.sprouts.filter((s) => s.alive);
  world.techniques = world.techniques.filter((t) => t.alive);
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
