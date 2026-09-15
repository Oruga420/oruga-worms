/**
 * Fire dispatch (architecture.md section D: a dispatch table from kind to behavior module). One
 * entry point the input layer and the CPU plan executor both call: fire(world, worm, def, aim,
 * shotIndex) spawns the sim bodies or applies the immediate effect and returns whether the turn
 * ends. Adding a weapon is a data row plus, only if it needs a genuinely new behavior, a module.
 */

import type { WormBody } from '../sim/types.ts';
import type { SimWorld } from '../sim/world.ts';
import { fireAnimal } from './behaviors/animal.ts';
import { fireHitscan } from './behaviors/hitscan.ts';
import { fireMelee } from './behaviors/melee.ts';
import { firePlaced } from './behaviors/placed.ts';
import { fireProjectile } from './behaviors/projectile.ts';
import { fireTargeted } from './behaviors/targeted.ts';
import { endsAfter, type FireAim, type FireContext, type FireResult } from './behaviors/types.ts';
import { fireUtility } from './behaviors/utility.ts';
import type { WeaponDef, WeaponKind } from './types.ts';

export type { FireAim, FireContext, FireResult };

const DISPATCH: Readonly<Record<WeaponKind, (ctx: FireContext) => FireResult>> = Object.freeze({
  PROJECTILE: fireProjectile,
  TIMED: fireProjectile,
  HITSCAN: fireHitscan,
  MELEE: fireMelee,
  PLACED: firePlaced,
  TARGETED: fireTargeted,
  ANIMAL: fireAnimal,
  UTILITY: fireUtility,
});

export function fire(world: SimWorld, worm: WormBody, def: WeaponDef, aim: FireAim, shotIndex = 0): FireResult {
  if (!worm.alive) return endsAfter(0);
  const behavior = DISPATCH[def.kind];
  return behavior({ world, worm, def, aim, shotIndex });
}
