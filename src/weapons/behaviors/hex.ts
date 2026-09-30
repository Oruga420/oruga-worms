/**
 * The Freezer: locks the nearest enemy in plain sight within the light's reach, by the same rule
 * as the other supers (combo.ts), and hands the timeline to the sim (sim/hex.ts): the finger up,
 * the light out to the victim and into its body, the float, the swell and the burst. With nobody
 * in sight the light flies straight ahead at chest height, as far as it gets before a wall, and
 * fizzles out; the turn is spent anyway. The shot stays open until the sim reports the hex done
 * (FireResult.sequence).
 */

import { sweep } from '../../sim/collision.ts';
import { WORM_HEIGHT } from '../../sim/constants.ts';
import { wormMiddleY } from '../../sim/worm-size.ts';
import { spawnHex } from '../../sim/hex.ts';
import { lockTarget } from './combo.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';

export function fireHex(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.hex;
  if (spec === undefined) return endsAfter(0);
  const victim = lockTarget(world, worm, spec.rangePx);
  world.events.push({ type: 'sound', id: def.sfx.fire, x: worm.x, y: worm.y });
  if (victim !== null) {
    const facing: 1 | -1 = victim.x > worm.x ? 1 : victim.x < worm.x ? -1 : worm.facing;
    spawnHex(world, { weaponId: def.id, attacker: worm, victim, spec, facing, targetX: victim.x, targetY: wormMiddleY(victim) });
    return { endsTurn: true, shotsRemaining: 0, sequence: true };
  }
  // Whiff: the light flies straight ahead at chest height and goes out at the first wall.
  const chestY = worm.y - WORM_HEIGHT * 0.6;
  const path = sweep(world.terrain.mask, worm.x, chestY, worm.x + worm.facing * spec.rangePx, chestY, 0);
  spawnHex(world, { weaponId: def.id, attacker: worm, victim: null, spec, facing: worm.facing, targetX: path.x, targetY: chestY });
  return { endsTurn: true, shotsRemaining: 0, sequence: true };
}
