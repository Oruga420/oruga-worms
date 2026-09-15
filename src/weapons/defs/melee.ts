/**
 * Melee rows of the ultraplan rev 2 roster: fire punch (uppercut that cuts the land above) and
 * baseball bat (30 damage, calibrated to throw a worm 643 px at 45 degrees).
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import {
  INFINITE_AMMO,
  SOURCE_GRAVITY_PX_PER_FRAME_SQ,
  defineWeapon,
  heldFrame,
  iconFrame,
  sourceSpeed,
} from './shared.ts';

/** Detailed_Weapon_Settings: bat at 3 stars, hit distance measured at 45 degrees. */
export const BAT_THROW_RANGE_PX = 643;
/** The bat aims from horizontal to about 75 degrees up (Baseball Bat page). */
const BAT_ARC_DEG = 75;
/** Fire punch: straight up, hits what stands above (Fire Punch page); reach and arc are v1 tuning. */
const FIRE_PUNCH_REACH_PX = 24;
const FIRE_PUNCH_ARC_DEG = 90;
/** The punch carves a worm wide channel upward (v1 tuning, a 9 x 16 worm fits through). */
const FIRE_PUNCH_CARVE_RADIUS_PX = 12;
/** Fire punch push, source px per frame: high and short arc (v1 tuning). */
const FIRE_PUNCH_PUSH_X = 4;
const FIRE_PUNCH_PUSH_Y = 12;

/**
 * Launch speed that lands a body rangePx away at 45 degrees under the source gravity:
 * R = v^2 / g, so v = sqrt(R g) in px per frame, then through units.ts.
 */
function speedForRange45(rangePx: number): number {
  return sourceSpeed(Math.sqrt(rangePx * SOURCE_GRAVITY_PX_PER_FRAME_SQ));
}

const BAT_LAUNCH_SPEED = speedForRange45(BAT_THROW_RANGE_PX);
const BAT_COMPONENT = BAT_LAUNCH_SPEED * Math.SQRT1_2;

const FIRE_PUNCH: WeaponDef = defineWeapon({
  id: 'fire_punch',
  name: 'Fire Punch',
  kind: 'MELEE',
  category: 'melee',
  icon: iconFrame('fire_punch'),
  heldSprite: heldFrame('fire_punch'),
  ammo: INFINITE_AMMO,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 0,
  melee: {
    reachPx: FIRE_PUNCH_REACH_PX,
    arcDeg: FIRE_PUNCH_ARC_DEG,
    damage: 30,
    knockback: { x: sourceSpeed(FIRE_PUNCH_PUSH_X), y: sourceSpeed(FIRE_PUNCH_PUSH_Y) },
    carveRadiusPx: FIRE_PUNCH_CARVE_RADIUS_PX,
  },
  sfx: { fire: 'wpn_firepunch_whoosh', impact: 'wpn_firepunch_thud' },
});

const BASEBALL_BAT: WeaponDef = defineWeapon({
  id: 'baseball_bat',
  name: 'Baseball Bat',
  kind: 'MELEE',
  category: 'melee',
  icon: iconFrame('baseball_bat'),
  heldSprite: heldFrame('baseball_bat'),
  ammo: 1,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  melee: {
    reachPx: 20,
    arcDeg: BAT_ARC_DEG,
    damage: 30,
    knockback: { x: BAT_COMPONENT, y: BAT_COMPONENT },
    throwRangePx: BAT_THROW_RANGE_PX,
  },
  sfx: { fire: 'wpn_bat_crack' },
});

export const MELEE = Object.freeze({
  fire_punch: FIRE_PUNCH,
  baseball_bat: BASEBALL_BAT,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
