/**
 * Animal weapons: the sheep is released at the worm's feet, walks in the facing direction and
 * detonates on the second fire press or after its lifetime. This module spawns it; the second
 * press is a sim call (detonateSheep) the input layer makes.
 */

import { spawnSheep } from '../../sim/sheep.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';

export function fireAnimal(ctx: FireContext): FireResult {
  const { def, worm, world } = ctx;
  if (def.spawn === undefined || def.blast === undefined) return endsAfter(0);
  spawnSheep(world, { ownerTeamId: worm.teamId, ownerWormId: worm.id, x: worm.x + worm.facing * 6, y: worm.y - 4, facing: worm.facing, spec: def.spawn, blast: def.blast });
  return endsAfter(0);
}
