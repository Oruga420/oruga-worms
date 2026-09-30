/**
 * Gear 5: locks the nearest enemy in plain sight within the rubber arm's reach, by the same rule
 * as the Ryuko Ranbu (combo.ts), and hands the timeline to the sim (sim/devour.ts): the awakening,
 * the arm out to the victim and back with it, the bites, the swallow and the burp. With nobody in
 * reach the arm grabs at the air as far as it gets before a wall, and the turn is spent anyway.
 * The shot stays open until the sim reports the devour done (FireResult.sequence).
 */

import { sweep } from '../../sim/collision.ts';
import { WORM_HALF_WIDTH, WORM_HEIGHT } from '../../sim/constants.ts';
import { wormMiddleY } from '../../sim/worm-size.ts';
import { spawnDevour } from '../../sim/devour.ts';
import { lockTarget } from './combo.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';

export function fireDevour(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.devour;
  if (spec === undefined) return endsAfter(0);
  const victim = lockTarget(world, worm, spec.rangePx);
  world.events.push({ type: 'sound', id: def.sfx.fire, x: worm.x, y: worm.y });
  if (victim !== null) {
    const facing: 1 | -1 = victim.x > worm.x ? 1 : victim.x < worm.x ? -1 : worm.facing;
    spawnDevour(world, { weaponId: def.id, eater: worm, victim, spec, facing, reachX: victim.x, reachY: wormMiddleY(victim) });
    return { endsTurn: true, shotsRemaining: 0, sequence: true };
  }
  // Whiff: the arm shoots out at chest height and stops short of the first wall.
  const chestY = worm.y - WORM_HEIGHT * 0.55;
  const path = sweep(world.terrain.mask, worm.x, chestY, worm.x + worm.facing * spec.rangePx, chestY, 0);
  const reach = Math.max(0, Math.abs(path.x - worm.x) - (path.hit === null ? 0 : WORM_HALF_WIDTH));
  spawnDevour(world, { weaponId: def.id, eater: worm, victim: null, spec, facing: worm.facing, reachX: worm.x + worm.facing * reach, reachY: chestY });
  return { endsTurn: true, shotsRemaining: 0, sequence: true };
}
