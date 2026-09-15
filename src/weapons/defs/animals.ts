/**
 * Animal rows of the ultraplan rev 2 roster: the sheep. It runs and hops in the facing direction,
 * detonates on the second fire press or after about 20 s with the power of a dynamite.
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import { blast, defineWeapon, heldFrame, iconFrame, sourceSpeed } from './shared.ts';

/** Automatic detonation after about 20 s (Sheep page). */
const SHEEP_LIFETIME_MS = 20_000;
/** Walk speed and hop impulse in source px per frame (v1 tuning). */
const SHEEP_WALK = sourceSpeed(2);
/** 200 px/s: a 32 px hop lasting 0.64 s, enough to clear a step, short enough that the sheep mostly runs. */
const SHEEP_HOP = sourceSpeed(4);

const SHEEP: WeaponDef = defineWeapon({
  id: 'sheep',
  name: 'Sheep',
  kind: 'ANIMAL',
  category: 'animal',
  icon: iconFrame('sheep'),
  heldSprite: heldFrame('sheep'),
  ammo: 1,
  charged: false,
  /** Released at the feet: no launch. */
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  spawn: {
    entityType: 'sheep',
    lifetimeMs: SHEEP_LIFETIME_MS,
    moveSpeed: SHEEP_WALK,
    hopImpulse: SHEEP_HOP,
    detonateOnSecondFire: true,
  },
  blast: blast(147, 75, 13, 'big'),
  sfx: { fire: 'wpn_sheep_baa', impact: 'exp_large' },
});

export const ANIMALS = Object.freeze({
  sheep: SHEEP,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
