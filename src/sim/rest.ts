/**
 * The "everything at rest" predicate the Resolving phase waits for (architecture.md section E,
 * the most likely hard failure of the design gets its own module and its own tests): every
 * living worm idle on the ground or dead, no live projectile, no falling crate, no live sheep,
 * no mine mid air, no super move, beam, devour, hex, sprout or technique still playing. The reducer still has the
 * inactivity and absolute caps for anything this misses.
 */

import { REST_TICKS } from './constants.ts';
import type { BeamBody, ComboBody, CrateBody, DevourBody, HexBody, MineBody, ProjectileBody, SheepBody, SproutBody, TechniqueBody, WormBody } from './types.ts';

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

export function comboDone(combo: ComboBody): boolean {
  return !combo.alive;
}

export function beamDone(beam: BeamBody): boolean {
  return !beam.alive;
}

export function devourDone(devour: DevourBody): boolean {
  return !devour.alive;
}

export function hexDone(hex: HexBody): boolean {
  return !hex.alive;
}

export function sproutDone(sprout: SproutBody): boolean {
  return !sprout.alive;
}

export function techniqueDone(technique: TechniqueBody): boolean {
  return !technique.alive;
}

export interface RestSnapshot {
  readonly worms: readonly WormBody[];
  readonly projectiles: readonly ProjectileBody[];
  readonly crates: readonly CrateBody[];
  readonly mines: readonly MineBody[];
  readonly sheep: readonly SheepBody[];
  /** Optional so a snapshot built before super moves existed still reads as it did. */
  readonly combos?: readonly ComboBody[];
  readonly beams?: readonly BeamBody[];
  readonly devours?: readonly DevourBody[];
  readonly hexes?: readonly HexBody[];
  readonly sprouts?: readonly SproutBody[];
  readonly techniques?: readonly TechniqueBody[];
}

export function allAtRest(world: RestSnapshot): boolean {
  return (
    world.worms.every(wormAtRest) &&
    world.projectiles.every(projectileAtRest) &&
    world.crates.every(crateAtRest) &&
    world.mines.every(mineAtRest) &&
    world.sheep.every(sheepAtRest) &&
    (world.combos ?? []).every(comboDone) &&
    (world.beams ?? []).every(beamDone) &&
    (world.devours ?? []).every(devourDone) &&
    (world.hexes ?? []).every(hexDone) &&
    (world.sprouts ?? []).every(sproutDone) &&
    (world.techniques ?? []).every(techniqueDone)
  );
}
