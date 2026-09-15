/**
 * Placed rows of the ultraplan rev 2 roster: the mine. Dynamite is PLACED too but lives with the
 * explosives because it is a fused body; the mine is a persistent proximity entity.
 */

import { GAME_CONFIG } from '../../config/game-config.ts';
import type { WeaponDef, WeaponId } from '../types.ts';
import { PLACED_RETREAT_MS, blast, defineWeapon, grenadeProjectile, heldFrame, iconFrame } from './shared.ts';

/** Detection range: a 45 degree tilted square with a 48 px centre to vertex radius (Mine page). */
const MINE_TRIGGER_RADIUS_PX = 48;
/** A placed mine persists across turns: no lifetime cap (0 means none, validated as mine only). */
const PERSISTENT = 0;

const MINE: WeaponDef = defineWeapon({
  id: 'mine',
  name: 'Mine',
  kind: 'PLACED',
  category: 'explosive',
  icon: iconFrame('mine'),
  heldSprite: heldFrame('mine'),
  ammo: 2,
  charged: false,
  /** Dropped at the feet: no launch. */
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  retreatMs: PLACED_RETREAT_MS,
  requiresTargetSelect: false,
  crateWeight: 2,
  /** Bounces exactly like a MAX grenade (Mine page) and is set off by nearby blasts. */
  projectile: grenadeProjectile('proj_mine', 4, 'max', PERSISTENT, { chainReaction: true, detonateOnTimeout: false }),
  blast: blast(97, 50, 10, 'medium'),
  spawn: {
    entityType: 'mine',
    lifetimeMs: PERSISTENT,
    moveSpeed: 0,
    hopImpulse: 0,
    detonateOnSecondFire: false,
    proximityPx: MINE_TRIGGER_RADIUS_PX,
    /** Placed mine fuse is fixed at 3 s after the proximity trigger (bug hunt rule, config). */
    armDelayMs: GAME_CONFIG.mines.placedFuseMs,
  },
  sfx: { fire: 'wpn_mine_arm', impact: 'exp_medium_1', arm: 'wpn_mine_beep' },
});

export const PLACED = Object.freeze({
  mine: MINE,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
