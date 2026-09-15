/**
 * Crates (architecture.md section C): spawned above the map at a free column, parachute down at
 * a fixed speed, land on the first solid pixel, and are collected on worm overlap. A blast
 * destroys a landed crate. Mutates bodies in place (hot path).
 */

import { firstSolidBelow, isSolid } from '../terrain/queries.ts';
import { CRATE_FALL_PX_PER_S, CRATE_SIZE_PX, WORM_HALF_WIDTH, WORM_HEIGHT } from './constants.ts';
import type { CrateBody, CrateKind, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';

export function spawnCrate(world: SimWorld, kind: CrateKind, x: number): CrateBody {
  const crate: CrateBody = { id: world.nextId(), kind, x, y: -CRATE_SIZE_PX, landed: false, counted: false, alive: true };
  world.crates.push(crate);
  world.events.push({ type: 'activity', kind: 'spawn' });
  world.events.push({ type: 'sound', id: 'wld_crate_parachute', x, y: 0 });
  return crate;
}

/** A column with air above the surface and no worm standing there; null when none is free. */
export function pickCrateColumn(world: SimWorld, attempts = 20): number | null {
  const mask = world.terrain.mask;
  for (let i = 0; i < attempts; i += 1) {
    const x = world.rng.nextInt(16, world.terrain.width - 16);
    const ground = firstSolidBelow(mask, x, 0, world.terrain.height);
    if (ground === null || ground >= world.terrain.water.y) continue;
    const occupied = world.worms.some((w) => w.alive && Math.abs(w.x - x) < WORM_HALF_WIDTH * 4);
    if (!occupied) return x;
  }
  return null;
}

export function stepCrate(world: SimWorld, crate: CrateBody, dt: number): void {
  if (!crate.alive) return;
  if (!crate.landed) {
    const nextY = crate.y + CRATE_FALL_PX_PER_S * dt;
    const solid = firstSolidBelow(world.terrain.mask, Math.round(crate.x), Math.max(0, Math.round(crate.y)), Math.ceil(nextY - crate.y) + 1);
    if (solid !== null && solid <= nextY && solid < world.terrain.water.y) {
      crate.y = solid - 1;
      crate.landed = true;
      if (!crate.counted) {
        world.events.push({ type: 'crateLanded', crateId: crate.id, kind: crate.kind, x: crate.x, y: crate.y });
        crate.counted = true;
      }
      world.events.push({ type: 'sound', id: 'wld_crate_land', x: crate.x, y: crate.y });
      return;
    }
    crate.y = nextY;
    if (crate.y >= world.terrain.water.y) {
      crate.alive = false;
      world.events.push({ type: 'crateDestroyed', crateId: crate.id, wasCounted: crate.counted });
    }
    return;
  }
  if (!isSolid(world.terrain.mask, Math.round(crate.x), Math.round(crate.y) + 1)) crate.landed = false;
}

/** Overlap test between a landed crate and a worm's hitbox. */
export function wormTouchesCrate(worm: WormBody, crate: CrateBody): boolean {
  const half = CRATE_SIZE_PX / 2;
  return Math.abs(worm.x - crate.x) <= half + WORM_HALF_WIDTH && crate.y >= worm.y - WORM_HEIGHT - half && crate.y <= worm.y + half;
}

export function collectCrates(world: SimWorld): void {
  for (const crate of world.crates) {
    if (!crate.alive || !crate.landed) continue;
    const worm = world.worms.find((w) => w.alive && w.motion !== 'drowning' && wormTouchesCrate(w, crate));
    if (worm === undefined) continue;
    crate.alive = false;
    world.events.push({ type: 'cratePicked', crateId: crate.id, kind: crate.kind, wormId: worm.id });
    world.events.push({ type: 'sound', id: crate.kind === 'health' ? 'wld_health_pickup' : 'wld_weapon_pickup', x: crate.x, y: crate.y });
  }
}
