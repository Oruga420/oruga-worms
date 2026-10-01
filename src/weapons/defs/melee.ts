/**
 * Melee rows of the ultraplan rev 2 roster: fire punch (uppercut that cuts the land above) and
 * baseball bat (30 damage, calibrated to throw a worm 643 px at 45 degrees), plus two supers:
 * Ryuko Ranbu, the Kyokugen style rush where the screen goes white while the worm beats its victim
 * senseless, and Gear 5, where the worm awakens white and rubbery, grabs a worm and eats it.
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import {
  INFINITE_AMMO,
  ONE_HIT_KILL_TOLL,
  defineWeapon,
  heldFrame,
  iconFrame,
  sourceSpeed,
  speedForRange45,
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

/**
 * Ryuko Ranbu: lock on to the nearest enemy in plain sight within reach, freeze, rush, sixteen
 * blows and a launching finisher. 16 x 3 + 27 is 75, the dynamite figure, spread over a beating
 * instead of a crater; the finisher throws a little higher than the bat. All v1 tuning.
 */
const RYUKO_RANGE_PX = 180;
const RYUKO_HITS = 16;
const RYUKO_HIT_DAMAGE = 3;
const RYUKO_FINISHER_DAMAGE = 27;
const RYUKO_FINISHER_KNOCKBACK = { x: BAT_COMPONENT, y: BAT_COMPONENT * 1.25 } as const;

const RYUKO_RANBU: WeaponDef = defineWeapon({
  id: 'ryuko_ranbu',
  name: 'Ryuko Ranbu',
  kind: 'MELEE',
  category: 'melee',
  icon: iconFrame('ryuko_ranbu'),
  heldSprite: heldFrame('ryuko_ranbu'),
  ammo: 1,
  /** A super needs a charged gauge: never on the opening turn. */
  delayTurns: 2,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  /** One per worm, from the loadout only: a weapon crate never hands out another super. */
  crateWeight: 0,
  /** What the heuristic and the panel read: the lock range, the whole beating and the final throw. */
  melee: {
    reachPx: RYUKO_RANGE_PX,
    arcDeg: 360,
    damage: RYUKO_HITS * RYUKO_HIT_DAMAGE + RYUKO_FINISHER_DAMAGE,
    knockback: RYUKO_FINISHER_KNOCKBACK,
  },
  combo: {
    rangePx: RYUKO_RANGE_PX,
    startupMs: 700,
    dashMs: 250,
    hits: RYUKO_HITS,
    hitIntervalMs: 85,
    damagePerHit: RYUKO_HIT_DAMAGE,
    finisherDamage: RYUKO_FINISHER_DAMAGE,
    finisherKnockback: RYUKO_FINISHER_KNOCKBACK,
    recoverMs: 900,
  },
  sfx: { fire: 'wpn_firepunch_whoosh', impact: 'wpn_firepunch_thud' },
});

/**
 * Gear 5: the drums of liberation, the worm turns white and rubbery, its arm stretches to the
 * nearest enemy in plain sight within reach, reels it into a giant mouth, bites it four times and
 * swallows it: a worm eaten is gone, whatever its health. It is the strongest super, so it comes
 * last, from turn 4, and its arm reaches only a little farther than the Ryuko Ranbu's rush.
 */
const GEAR_FIVE_RANGE_PX = 200;
const GEAR_FIVE_CHOMPS = 4;
const GEAR_FIVE_CHOMP_DAMAGE = 25;

const GEAR_FIVE: WeaponDef = defineWeapon({
  id: 'gear_five',
  name: 'Gear 5',
  kind: 'MELEE',
  category: 'melee',
  icon: iconFrame('gear_five'),
  /** Bare rubber hands: nothing to hold. */
  heldSprite: null,
  ammo: 1,
  /** Like every super: never on the opening turn. */
  delayTurns: 2,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  /** One per worm, from the loadout only: a weapon crate never hands out another super. */
  crateWeight: 0,
  /** A worm eaten is gone whatever its health: the one who eats pays for it with half its own. */
  toll: ONE_HIT_KILL_TOLL,
  /** What the heuristic and the panel read: the arm's reach and the bites (the swallow takes the rest). */
  melee: {
    reachPx: GEAR_FIVE_RANGE_PX,
    arcDeg: 360,
    damage: GEAR_FIVE_CHOMPS * GEAR_FIVE_CHOMP_DAMAGE,
    knockback: { x: 0, y: 0 },
  },
  devour: {
    rangePx: GEAR_FIVE_RANGE_PX,
    awakenMs: 2200,
    drums: 4,
    stretchMs: 320,
    reelMs: 420,
    chomps: GEAR_FIVE_CHOMPS,
    chompIntervalMs: 320,
    chompDamage: GEAR_FIVE_CHOMP_DAMAGE,
    recoverMs: 1500,
  },
  sfx: { fire: 'wpn_firepunch_thud', impact: 'wpn_bat_crack' },
});

export const MELEE = Object.freeze({
  fire_punch: FIRE_PUNCH,
  baseball_bat: BASEBALL_BAT,
  ryuko_ranbu: RYUKO_RANBU,
  gear_five: GEAR_FIVE,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
