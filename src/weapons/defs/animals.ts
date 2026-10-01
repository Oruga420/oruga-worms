/**
 * Animal rows of the ultraplan rev 2 roster: the sheep. It runs and hops in the facing direction,
 * detonates on the second fire press or after about 20 s with the power of a dynamite. And the
 * Saibaman seed: planted in front of the worm, it grows a small green worm that fights for its team.
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

/**
 * The Saibaman seed. It goes in a stride in front of the worm; the ground shakes and cracks three
 * times over a second and a half, and a Saibaman leaps out of it about five times its own height:
 * half a worm's size and half its health, a smaller target, with the planter's team and a turn of
 * its own.
 */
const SAIBAMAN: WeaponDef = defineWeapon({
  id: 'saibaman',
  name: 'Saibaman',
  kind: 'PLACED',
  category: 'animal',
  icon: iconFrame('saibaman'),
  /** Planted with the bare hands: a seed is too small to show in them. */
  heldSprite: null,
  ammo: 1,
  /** Not on the very first turn: the fight has to have started. */
  delayTurns: 2,
  charged: false,
  /** Pushed into the ground at the feet: no launch. */
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  /** One per worm, from the loadout only: a weapon crate never hands out another; a power orb does. */
  crateWeight: 0,
  sprout: {
    plantAheadPx: 22,
    plantMs: 700,
    growMs: 1500,
    cracks: 3,
    /** 230 px/s under 625 px/s2 of gravity: a leap about 42 px high. */
    popSpeed: 230,
    holePx: 6,
    recoverMs: 1100,
    size: 0.5,
    hpShare: 0.5,
    /** Room for four Saibamen next to a team of six. */
    maxTeamWorms: 10,
  },
  sfx: { fire: 'wrm_land' },
});

export const ANIMALS = Object.freeze({
  sheep: SHEEP,
  saibaman: SAIBAMAN,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
