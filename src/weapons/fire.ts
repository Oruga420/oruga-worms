/**
 * Fire dispatch (architecture.md section D: a dispatch table from kind to behavior module). One
 * entry point the input layer and the CPU plan executor both call: fire(world, worm, def, aim,
 * shotIndex) spawns the sim bodies or applies the immediate effect and returns whether the turn
 * ends. Adding a weapon is a data row plus, only if it needs a genuinely new behavior, a module.
 *
 * A weapon with a toll (Gear 5, the Freezer) also costs the worm that fires it: the damage goes out
 * here, once the move has started, so the ledger books it with the move already under way.
 */

import { wormMiddleY } from '../sim/worm-size.ts';
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
  const result = behavior({ world, worm, def, aim, shotIndex });
  if (def.toll !== undefined && def.toll > 0) payToll(world, worm, def.toll);
  return result;
}

/**
 * The price of a super, out of the worm's own health: the ledger takes all it has left when that
 * is less. Nobody is credited with it, and a worm it empties still finishes its move (the
 * controller keeps it up until the move is over, the reducer does not end the turn under it).
 */
function payToll(world: SimWorld, worm: WormBody, toll: number): void {
  world.events.push({ type: 'damage', wormId: worm.id, amount: toll, sourceTeamId: null, sourceWormId: null, cause: 'toll', at: { x: worm.x, y: wormMiddleY(worm), dx: 0, dy: -1 } });
}
