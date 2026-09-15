/**
 * Explosive rows of the ultraplan rev 2 roster: bazooka, homing missile, mortar, grenade, cluster
 * bomb, banana bomb, holy hand grenade and dynamite, plus the tank cannon and the napalm gun.
 * Clustering is a field: the mortar, the cluster bomb, the banana and the napalm gun share the
 * projectile module and nest their children here.
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import {
  BOMBLET_FAILSAFE_MS,
  CLUSTER_SPEED_JITTER,
  CLUSTER_SPREAD_DEG,
  DYNAMITE_FUSE_MS,
  FUSE_DEFAULT_MS,
  FUSE_OPTIONS_MS,
  HOLY_FUSE_MS,
  INFINITE_AMMO,
  MAX_LAUNCH_SPEED,
  PLACED_RETREAT_MS,
  SPLIT_ONLY_BLAST,
  blast,
  contactProjectile,
  defineWeapon,
  grenadeProjectile,
  heldFrame,
  iconFrame,
  sourceSpeed,
} from './shared.ts';

/** Thrown bodies live long enough for a 5 s fuse plus bounces; the holy one also waits for rest. */
const GRENADE_LIFETIME_MS = 8000;
const HOLY_LIFETIME_MS = 15_000;
/** Homing: locks 0.5 s after launch, attraction ends at 4 s, explodes at 10 s (Homing Missile page). */
const HOMING_LOCK_MS = 500;
const HOMING_RELEASE_MS = 4000;
const HOMING_SELF_DESTRUCT_MS = 10_000;
/** Weak attraction so the missile arcs and can orbit a missed target (v1 tuning). */
const HOMING_TURN_RATE_RAD_PER_SEC = 2;
/** Bomblet launch speeds in source px per frame (v1 tuning; bananas spread wider). */
const BOMBLET_SPEED = sourceSpeed(8);
const BANANA_SPEED = sourceSpeed(10);
/** Napalm blobs are flung slower than bomblets so the fire stays a puddle, not a shotgun. */
const NAPALM_BLOB_SPEED = sourceSpeed(6);

const SELECTABLE_FUSE = { selectable: true, defaultMs: FUSE_DEFAULT_MS, optionsMs: FUSE_OPTIONS_MS } as const;

const BAZOOKA: WeaponDef = defineWeapon({
  id: 'bazooka',
  name: 'Bazooka',
  kind: 'PROJECTILE',
  category: 'explosive',
  icon: iconFrame('bazooka'),
  heldSprite: heldFrame('bazooka'),
  ammo: INFINITE_AMMO,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: true,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 0,
  projectile: contactProjectile('proj_rocket', 3, { trail: 'smoke', water: 'skim' }),
  blast: blast(97, 50, 10, 'medium'),
  sfx: { fire: 'wpn_bazooka_launch', impact: 'exp_medium_1', loop: 'wpn_rocket_loop' },
});

const HOMING_MISSILE: WeaponDef = defineWeapon({
  id: 'homing_missile',
  name: 'Homing Missile',
  kind: 'PROJECTILE',
  category: 'explosive',
  icon: iconFrame('homing_missile'),
  heldSprite: heldFrame('homing_missile'),
  ammo: 1,
  /** Intermediate scheme delay (prior-art.md weapon table). */
  delayTurns: 1,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: true,
  crateWeight: 2,
  projectile: {
    ...contactProjectile('proj_missile', 3, { trail: 'smoke', water: 'pass', maxLifetimeMs: HOMING_SELF_DESTRUCT_MS }),
    homing: {
      turnRateRadPerSec: HOMING_TURN_RATE_RAD_PER_SEC,
      activateAfterMs: HOMING_LOCK_MS,
      deactivateAfterMs: HOMING_RELEASE_MS,
      selfDestructMs: HOMING_SELF_DESTRUCT_MS,
    },
  },
  blast: blast(97, 50, 10, 'medium'),
  sfx: { fire: 'wpn_bazooka_launch', impact: 'exp_medium_1', loop: 'wpn_rocket_loop' },
});

const MORTAR: WeaponDef = defineWeapon({
  id: 'mortar',
  name: 'Mortar',
  kind: 'PROJECTILE',
  category: 'explosive',
  icon: iconFrame('mortar'),
  heldSprite: heldFrame('mortar'),
  ammo: 5,
  /** Power fixed at maximum (Mortar page). */
  charged: false,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  projectile: contactProjectile('proj_bomb_small', 3, { trail: 'smoke' }),
  /** The shell only splits; the roster damage column is the five bomblets. */
  blast: SPLIT_ONLY_BLAST,
  cluster: {
    count: 5,
    direction: 'back',
    spreadDeg: CLUSTER_SPREAD_DEG,
    speed: BOMBLET_SPEED,
    jitter: CLUSTER_SPEED_JITTER,
    childWeaponId: 'mortar_bomblet',
    childProjectile: contactProjectile('proj_pellet', 2, { maxLifetimeMs: BOMBLET_FAILSAFE_MS, spinWithVelocity: false }),
    childBlast: blast(35, 15, 5, 'small'),
  },
  sfx: { fire: 'wpn_bazooka_launch', impact: 'wpn_cluster_split' },
});

const GRENADE: WeaponDef = defineWeapon({
  id: 'grenade',
  name: 'Grenade',
  kind: 'TIMED',
  category: 'explosive',
  icon: iconFrame('grenade'),
  heldSprite: heldFrame('grenade'),
  ammo: INFINITE_AMMO,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 0,
  fuse: SELECTABLE_FUSE,
  projectile: grenadeProjectile('proj_grenade', 4, 'selectable', GRENADE_LIFETIME_MS),
  blast: blast(97, 50, 10, 'medium'),
  sfx: { fire: 'wpn_grenade_throw', impact: 'exp_medium_1' },
});

const CLUSTER_BOMB: WeaponDef = defineWeapon({
  id: 'cluster_bomb',
  name: 'Cluster Bomb',
  kind: 'TIMED',
  category: 'explosive',
  icon: iconFrame('cluster_bomb'),
  heldSprite: heldFrame('cluster_bomb'),
  ammo: 3,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  fuse: SELECTABLE_FUSE,
  projectile: grenadeProjectile('proj_cluster', 4, 'selectable', GRENADE_LIFETIME_MS),
  blast: SPLIT_ONLY_BLAST,
  cluster: {
    count: 5,
    direction: 'up',
    spreadDeg: CLUSTER_SPREAD_DEG,
    speed: BOMBLET_SPEED,
    jitter: CLUSTER_SPEED_JITTER,
    childWeaponId: 'cluster_bomblet',
    childProjectile: contactProjectile('proj_pellet', 2, { maxLifetimeMs: BOMBLET_FAILSAFE_MS, spinWithVelocity: false }),
    childBlast: blast(47, 20, 6, 'small'),
  },
  sfx: { fire: 'wpn_grenade_throw', impact: 'wpn_cluster_split' },
});

const BANANA_BOMB: WeaponDef = defineWeapon({
  id: 'banana_bomb',
  name: 'Banana Bomb',
  kind: 'TIMED',
  category: 'explosive',
  icon: iconFrame('banana_bomb'),
  heldSprite: heldFrame('banana_bomb'),
  /** Crate only, weight 1 (roster and prior-art.md). */
  ammo: 0,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 1,
  fuse: SELECTABLE_FUSE,
  /** Forced MAX bounce (Banana Bomb page). */
  projectile: grenadeProjectile('proj_banana', 4, 'max', GRENADE_LIFETIME_MS),
  /** The first bomb has dynamite power (prior-art.md), then five bananas of 75. */
  blast: blast(147, 75, 13, 'big'),
  cluster: {
    count: 5,
    direction: 'up',
    spreadDeg: CLUSTER_SPREAD_DEG,
    speed: BANANA_SPEED,
    jitter: CLUSTER_SPEED_JITTER,
    childWeaponId: 'banana_bomblet',
    childProjectile: contactProjectile('proj_banana', 4, { maxLifetimeMs: BOMBLET_FAILSAFE_MS, spinWithVelocity: false }),
    childBlast: blast(147, 75, 13, 'big'),
  },
  sfx: { fire: 'wpn_grenade_throw', impact: 'exp_large' },
});

const HOLY_HAND_GRENADE: WeaponDef = defineWeapon({
  id: 'holy_hand_grenade',
  name: 'Holy Hand Grenade',
  kind: 'TIMED',
  category: 'explosive',
  icon: iconFrame('holy_hand_grenade'),
  heldSprite: heldFrame('holy_hand_grenade'),
  ammo: 1,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 1,
  /** Fixed 3 s, then it waits until fully at rest (Holy Hand Grenade page). */
  fuse: { selectable: false, defaultMs: HOLY_FUSE_MS, optionsMs: [HOLY_FUSE_MS], restBeforeDetonate: true },
  projectile: grenadeProjectile('proj_holy', 6, 'min', HOLY_LIFETIME_MS, { trail: 'sparkle' }),
  blast: blast(199, 100, 16, 'holy'),
  sfx: { fire: 'wpn_grenade_throw', impact: 'wpn_holy_blast', arm: 'wpn_holy_choir' },
});

const DYNAMITE: WeaponDef = defineWeapon({
  id: 'dynamite',
  name: 'Dynamite',
  kind: 'PLACED',
  category: 'explosive',
  icon: iconFrame('dynamite'),
  heldSprite: heldFrame('dynamite'),
  ammo: 1,
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
  fuse: { selectable: false, defaultMs: DYNAMITE_FUSE_MS, optionsMs: [DYNAMITE_FUSE_MS] },
  /** Does not roll (Dynamite page): bounce 0 on a PLACED kind means it stops dead. */
  projectile: contactProjectile('proj_dynamite', 4, { maxLifetimeMs: GRENADE_LIFETIME_MS, spinWithVelocity: false }),
  blast: blast(147, 75, 13, 'big'),
  sfx: { fire: 'wpn_grenade_throw', impact: 'exp_large', loop: 'wpn_dynamite_fuse' },
});

/**
 * Tank cannon: the heavy artillery piece. It is a flat, fast shell rather than a lobbed one, so
 * it is authored at full launch speed with a reduced gravity scale, which is what makes the arc
 * read as a cannon instead of a bazooka. Wind does not move a shell this heavy.
 *
 * Scope note: this is a tank GUN, not a drivable tank. A vehicle the worm rides would be a new
 * sim entity with its own movement and collision, not a weapon row.
 */
const TANK: WeaponDef = defineWeapon({
  id: 'tank',
  name: 'Tank Cannon',
  kind: 'PROJECTILE',
  category: 'explosive',
  icon: iconFrame('tank'),
  heldSprite: heldFrame('tank'),
  ammo: 1,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  /** Flat trajectory: the shell drops at a third of the usual rate (v1 tuning). */
  gravityScale: 0.34,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  projectile: contactProjectile('proj_shell', 4, { trail: 'smoke', water: 'splash' }),
  /** The biggest single crater in the roster after the holy hand grenade (v1 tuning). */
  blast: blast(160, 65, 14, 'big'),
  /** No tank cue in the audio plan yet; the bazooka launch stands in. */
  sfx: { fire: 'wpn_bazooka_launch', impact: 'exp_large', loop: 'wpn_rocket_loop' },
});

/**
 * Napalm gun: a charged shell that bursts into a wide spray of burning blobs. The blobs bounce
 * (they use the grenade family body with the low restitution preset) so the fire spreads along
 * the ground instead of punching one hole, and each blob carves only a small crater. Area denial,
 * not a single big hit: the damage lives in the count, not in any one blob.
 */
const NAPALM: WeaponDef = defineWeapon({
  id: 'napalm',
  name: 'Napalm Gun',
  kind: 'PROJECTILE',
  category: 'explosive',
  icon: iconFrame('napalm'),
  heldSprite: heldFrame('napalm'),
  ammo: 1,
  charged: true,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: true,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  projectile: contactProjectile('proj_canister', 3, { trail: 'smoke' }),
  blast: SPLIT_ONLY_BLAST,
  cluster: {
    count: 14,
    direction: 'up',
    spreadDeg: CLUSTER_SPREAD_DEG,
    speed: NAPALM_BLOB_SPEED,
    jitter: CLUSTER_SPEED_JITTER,
    childWeaponId: 'napalm_blob',
    /** Blobs roll and settle before they burn out, so they use the low bounce grenade body. */
    childProjectile: grenadeProjectile('proj_flame', 2, 'min', BOMBLET_FAILSAFE_MS),
    childBlast: blast(29, 12, 3, 'small'),
  },
  sfx: { fire: 'wpn_bazooka_launch', impact: 'exp_small_1', loop: 'wpn_napalm_loop' },
});

export const EXPLOSIVES = Object.freeze({
  bazooka: BAZOOKA,
  homing_missile: HOMING_MISSILE,
  mortar: MORTAR,
  grenade: GRENADE,
  cluster_bomb: CLUSTER_BOMB,
  banana_bomb: BANANA_BOMB,
  holy_hand_grenade: HOLY_HAND_GRENADE,
  tank: TANK,
  napalm: NAPALM,
  dynamite: DYNAMITE,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
