/**
 * Targeted rows of the ultraplan rev 2 roster: the air strike. A plane crosses from the side the
 * player picks and releases five bombs of 30 with 61 px craters around the cursor x.
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import { blast, contactProjectile, defineWeapon, iconFrame, sourceSpeed } from './shared.ts';

/** Bombs fall from the top edge of the world; spacing and plane speed are v1 tuning values. */
const BOMB_SPACING_PX = 28;
const BOMB_SPAWN_Y = 0;
const BOMB_LIFETIME_MS = 10_000;
const PLANE_SPEED = sourceSpeed(16);

const AIR_STRIKE: WeaponDef = defineWeapon({
  id: 'air_strike',
  name: 'Air Strike',
  kind: 'TARGETED',
  category: 'air',
  icon: iconFrame('air_strike'),
  /** The worm holds nothing; the crosshair is the whole interaction. */
  heldSprite: null,
  ammo: 1,
  /** Intermediate scheme delay (prior-art.md weapon table). */
  delayTurns: 5,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: true,
  crateWeight: 1,
  strike: {
    count: 5,
    spacingPx: BOMB_SPACING_PX,
    spawnY: BOMB_SPAWN_Y,
    childWeaponId: 'strike_bomb',
    childProjectile: contactProjectile('proj_bomb', 4, { maxLifetimeMs: BOMB_LIFETIME_MS }),
    childBlast: blast(61, 30, 7, 'medium'),
    planeSprite: 'entity_plane',
    planeSpeed: PLANE_SPEED,
  },
  sfx: { fire: 'wpn_airstrike_flyby', impact: 'exp_medium_1', arm: 'wpn_bomb_whistle' },
});

export const STRIKES = Object.freeze({
  air_strike: AIR_STRIKE,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
