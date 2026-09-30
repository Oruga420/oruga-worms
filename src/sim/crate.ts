/**
 * Crates (architecture.md section C): spawned above the map at a free column, parachute down at
 * a fixed speed, land on the first solid pixel, and are collected on worm overlap. A blast
 * destroys a landed crate. Mutates bodies in place (hot path).
 *
 * A level's bedrock ring closes the top of the world with a 2 px ceiling. A crate comes in through
 * it and lands on the land below: both the column pick and the fall look under the ceiling. They
 * used to stop on it, so every crate in a real match came to rest at y = -1, off the top of the
 * screen, and none was ever picked up.
 */

import { BORDER_BEDROCK_PX } from '../terrain/mask.ts';
import { firstSolidBelow, isSolid } from '../terrain/queries.ts';
import { CRATE_FALL_PX_PER_S, CRATE_SIZE_PX, WORM_HALF_WIDTH } from './constants.ts';
import { wormHalfWidth, wormHeight } from './worm-size.ts';
import type { CrateBody, CrateKind, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';

/** What a crate sounds like as it appears, and as a worm takes it: the power orb shimmers in and sings. */
const SPAWN_SOUND: Readonly<Record<CrateKind, string>> = Object.freeze({ weapon: 'wld_crate_parachute', health: 'wld_crate_parachute', utility: 'wld_crate_parachute', power: 'wpn_teleport_zap' });
const PICKUP_SOUND: Readonly<Record<CrateKind, string>> = Object.freeze({ weapon: 'wld_weapon_pickup', health: 'wld_health_pickup', utility: 'wld_weapon_pickup', power: 'wpn_holy_choir' });

export function spawnCrate(world: SimWorld, kind: CrateKind, x: number): CrateBody {
  const crate: CrateBody = { id: world.nextId(), kind, x, y: -CRATE_SIZE_PX, landed: false, counted: false, alive: true };
  world.crates.push(crate);
  world.events.push({ type: 'activity', kind: 'spawn' });
  world.events.push({ type: 'sound', id: SPAWN_SOUND[kind], x, y: 0 });
  return crate;
}

/** A column with air above the surface and no worm standing there; null when none is free. */
export function pickCrateColumn(world: SimWorld, attempts = 20): number | null {
  const mask = world.terrain.mask;
  for (let i = 0; i < attempts; i += 1) {
    const x = world.rng.nextInt(16, world.terrain.width - 16);
    // Under the ceiling: a column whose land reaches right up to it has no room to drop into.
    const ground = firstSolidBelow(mask, x, BORDER_BEDROCK_PX, world.terrain.height);
    if (ground === null || ground <= BORDER_BEDROCK_PX || ground >= world.terrain.water.y) continue;
    const occupied = world.worms.some((w) => w.alive && Math.abs(w.x - x) < WORM_HALF_WIDTH * 4);
    if (!occupied) return x;
  }
  return null;
}

export function stepCrate(world: SimWorld, crate: CrateBody, dt: number): void {
  if (!crate.alive) return;
  if (!crate.landed) {
    const nextY = crate.y + CRATE_FALL_PX_PER_S * dt;
    // Through the ceiling on the way in: it is the land under it that a crate comes down on.
    const solid = firstSolidBelow(world.terrain.mask, Math.round(crate.x), Math.max(BORDER_BEDROCK_PX, Math.round(crate.y)), Math.ceil(nextY - crate.y) + 1);
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
  return Math.abs(worm.x - crate.x) <= half + wormHalfWidth(worm) && crate.y >= worm.y - wormHeight(worm) - half && crate.y <= worm.y + half;
}

export function collectCrates(world: SimWorld): void {
  for (const crate of world.crates) {
    if (!crate.alive || !crate.landed) continue;
    const worm = world.worms.find((w) => w.alive && w.motion !== 'drowning' && wormTouchesCrate(w, crate));
    if (worm === undefined) continue;
    crate.alive = false;
    world.events.push({ type: 'cratePicked', crateId: crate.id, kind: crate.kind, wormId: worm.id });
    world.events.push({ type: 'sound', id: PICKUP_SOUND[crate.kind], x: crate.x, y: crate.y });
  }
}
