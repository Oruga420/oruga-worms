/**
 * Fire dispatch (architecture.md section D: a dispatch table from kind to behavior module). One
 * entry point the input layer and the CPU plan executor both call: fire(world, worm, def, aim,
 * shotIndex) spawns the sim bodies or applies the immediate effect and returns whether the turn
 * ends. Adding a weapon is a data row plus, only if it needs a genuinely new behavior, a module.
 *
 * A weapon with a toll (Gear 5, the Freezer, the Galaxian Explosion) also costs the worm that fires
 * it, and so does one with a toll share (Antares, half of what it has): the damage goes out here,
 * once the move has started, so the ledger books it with the move already under way.
 *
 * The techniques of the anime row (WeaponDef.technique) go to their own module whatever the kind of
 * their row: the kind only says how they are aimed.
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
import { fireTechnique } from './behaviors/technique.ts';
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

/** The most a toll by share can come to: the ledger works out the share of what the worm really has. */
const MAX_TOLL = 1_000_000;

export function fire(world: SimWorld, worm: WormBody, def: WeaponDef, aim: FireAim, shotIndex = 0): FireResult {
  if (!worm.alive) return endsAfter(0);
  const behavior = def.technique !== undefined ? fireTechnique : DISPATCH[def.kind];
  const result = behavior({ world, worm, def, aim, shotIndex });
  if (def.toll !== undefined && def.toll > 0) payToll(world, worm, def.toll);
  if (def.tollShare !== undefined && def.tollShare > 0) payToll(world, worm, MAX_TOLL, def.tollShare);
  return result;
}

/**
 * The price of a super, out of the worm's own health: the ledger takes all it has left when that
 * is less. Nobody is credited with it, and a worm it empties still finishes its move (the
 * controller keeps it up until the move is over, the reducer does not end the turn under it).
 */
function payToll(world: SimWorld, worm: WormBody, toll: number, share?: number): void {
  world.events.push({ type: 'damage', wormId: worm.id, amount: toll, sourceTeamId: null, sourceWormId: null, cause: 'toll', at: { x: worm.x, y: wormMiddleY(worm), dx: 0, dy: -1 }, ...(share === undefined ? {} : { share }) });
}

/** What a toll costs a worm with `hp` left: the fixed amount, or the share of its health rounded up; never more than it has. */
export function tollFor(hp: number, def: { readonly toll?: number; readonly tollShare?: number }): number {
  const left = Math.max(0, hp);
  if (def.tollShare !== undefined && def.tollShare > 0) return Math.min(left, Math.ceil(left * def.tollShare));
  return Math.min(left, def.toll ?? 0);
}
