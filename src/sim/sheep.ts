/**
 * The sheep (architecture.md section C): walks in the facing direction, hops on a timer to clear
 * small obstacles, turns around at walls, and detonates on the second fire press or when its
 * lifetime runs out. Mutates bodies in place (hot path).
 */

import { firstAirAbove, isSolid } from '../terrain/queries.ts';
import type { BlastSpec, SpawnSpec } from '../weapons/types.ts';
import { SHEEP_HOP_INTERVAL_S, STEP_UP_PX, TICK_S } from './constants.ts';
import { groundBelow } from './collision.ts';
import { explode } from './explosion.ts';
import { applyForces, sweepMove } from './integrator.ts';
import type { SheepBody } from './types.ts';
import type { SimWorld } from './world.ts';

export interface SpawnSheepParams {
  readonly ownerTeamId: string | null;
  readonly ownerWormId: string | null;
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  readonly spec: SpawnSpec;
  readonly blast: BlastSpec;
}

const SHEEP_HALF_WIDTH = 4;

export function spawnSheep(world: SimWorld, params: SpawnSheepParams): SheepBody {
  const sheep: SheepBody = {
    id: world.nextId(),
    ownerTeamId: params.ownerTeamId,
    ownerWormId: params.ownerWormId,
    x: params.x,
    y: params.y,
    vx: 0,
    vy: 0,
    facing: params.facing,
    spec: params.spec,
    blast: params.blast,
    lifeTicks: Math.max(1, Math.round(params.spec.lifetimeMs / 1000 / TICK_S)),
    hopTicks: Math.round(SHEEP_HOP_INTERVAL_S / TICK_S),
    onGround: true,
    alive: true,
    detonateRequested: false,
  };
  world.sheep.push(sheep);
  world.events.push({ type: 'activity', kind: 'spawn' });
  world.events.push({ type: 'sound', id: 'wpn_sheep_baa', x: sheep.x, y: sheep.y });
  return sheep;
}

export function detonateSheep(world: SimWorld, sheep: SheepBody): void {
  if (!sheep.alive) return;
  sheep.alive = false;
  explode(world, { x: sheep.x, y: sheep.y, blast: sheep.blast, sourceTeamId: sheep.ownerTeamId, sourceWormId: sheep.ownerWormId, soundId: 'exp_medium_1' });
}

export function stepSheep(world: SimWorld, sheep: SheepBody, dt: number): void {
  if (!sheep.alive) return;
  sheep.lifeTicks -= 1;
  if (sheep.detonateRequested || sheep.lifeTicks <= 0) {
    detonateSheep(world, sheep);
    return;
  }
  const mask = world.terrain.mask;
  if (sheep.y >= world.terrain.water.y) {
    sheep.alive = false;
    world.events.push({ type: 'sound', id: 'exp_water_splash', x: sheep.x, y: sheep.y });
    return;
  }
  if (sheep.onGround) {
    sheep.hopTicks -= 1;
    // The map edge is a wall too. Without this the sheep walks off the island and drowns without a
    // bang on any map narrower than its 2000 px of range, which is every map.
    const edgeMargin = SHEEP_HALF_WIDTH * 2;
    if ((sheep.facing === 1 && sheep.x >= world.terrain.width - edgeMargin) || (sheep.facing === -1 && sheep.x <= edgeMargin)) {
      sheep.facing = sheep.facing === 1 ? -1 : 1;
    }
    const targetX = sheep.x + sheep.facing * sheep.spec.moveSpeed * dt;
    const tx = Math.round(targetX);
    const feet = Math.round(sheep.y);
    if (isSolid(mask, tx, feet)) {
      const above = firstAirAbove(mask, tx, feet, STEP_UP_PX);
      if (above === null) {
        sheep.facing = sheep.facing === 1 ? -1 : 1;
      } else {
        sheep.x = targetX;
        sheep.y = above;
      }
    } else {
      sheep.x = targetX;
    }
    if (!groundBelow(mask, sheep.x, sheep.y, SHEEP_HALF_WIDTH)) {
      sheep.onGround = false;
      sheep.vx = sheep.facing * sheep.spec.moveSpeed * 0.5;
    } else if (sheep.hopTicks <= 0) {
      sheep.hopTicks = Math.round(SHEEP_HOP_INTERVAL_S / TICK_S);
      sheep.onGround = false;
      sheep.vx = sheep.facing * sheep.spec.moveSpeed;
      sheep.vy = -sheep.spec.hopImpulse;
      world.events.push({ type: 'sound', id: 'wpn_sheep_boing', x: sheep.x, y: sheep.y });
    }
    return;
  }
  applyForces(sheep, dt, 1, 0, false, world.gravity);
  const hit = sweepMove(mask, sheep, dt, 0);
  if (hit !== null) {
    if (hit.normal.y < -0.3 && sheep.vy >= 0) {
      sheep.onGround = true;
      sheep.vx = 0;
      sheep.vy = 0;
      world.events.push({ type: 'activity', kind: 'bounce' });
    } else {
      sheep.facing = sheep.facing === 1 ? -1 : 1;
      sheep.vx = -sheep.vx * 0.3;
    }
  }
}
