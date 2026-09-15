/**
 * The "everything at rest" predicate the Resolving phase waits for (architecture.md section E,
 * the most likely hard failure of the design gets its own module and its own tests): every
 * living worm idle on the ground or dead, no live projectile, no falling crate, no live sheep,
 * no mine mid air. The reducer still has the inactivity and absolute caps for anything this
 * misses.
 */

import { REST_TICKS } from './constants.ts';
import type { CrateBody, MineBody, ProjectileBody, SheepBody, WormBody } from './types.ts';

export function wormAtRest(worm: WormBody): boolean {
  if (!worm.alive || worm.motion === 'dead') return true;
  return worm.onGround && (worm.motion === 'idle' || worm.motion === 'jetpacking') && worm.restTicks >= REST_TICKS;
}

export function projectileAtRest(p: ProjectileBody): boolean {
  return !p.alive;
}

export function crateAtRest(crate: CrateBody): boolean {
  return !crate.alive || crate.landed;
}

export function mineAtRest(mine: MineBody): boolean {
  return !mine.alive || (mine.vx === 0 && mine.vy === 0 && !mine.armed);
}

export function sheepAtRest(sheep: SheepBody): boolean {
  return !sheep.alive;
}

export interface RestSnapshot {
  readonly worms: readonly WormBody[];
  readonly projectiles: readonly ProjectileBody[];
  readonly crates: readonly CrateBody[];
  readonly mines: readonly MineBody[];
  readonly sheep: readonly SheepBody[];
}

export function allAtRest(world: RestSnapshot): boolean {
  return (
    world.worms.every(wormAtRest) &&
    world.projectiles.every(projectileAtRest) &&
    world.crates.every(crateAtRest) &&
    world.mines.every(mineAtRest) &&
    world.sheep.every(sheepAtRest)
  );
}
