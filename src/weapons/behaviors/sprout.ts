/**
 * The Saibaman seed: finds the ground a stride in front of the worm (or nearer, or behind) and hands
 * the timeline to the sim (sim/sprout.ts): the planting, the ground shaking and cracking, and the
 * Saibaman leaping out. With no ground to plant in, or a full team, the seed withers; the turn is
 * spent anyway. The shot stays open until the sim reports the sprout done (FireResult.sequence).
 */

import { plantSpot, spawnSprout } from '../../sim/sprout.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';

export function fireSprout(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.sprout;
  if (spec === undefined) return endsAfter(0);
  const spot = plantSpot(world.terrain.mask, world.terrain.water.y, worm.x, worm.y, worm.facing, spec);
  world.events.push({ type: 'sound', id: def.sfx.fire, x: worm.x, y: worm.y });
  spawnSprout(world, { weaponId: def.id, planter: worm, spec, spot });
  return { endsTurn: true, shotsRemaining: 0, sequence: true };
}
