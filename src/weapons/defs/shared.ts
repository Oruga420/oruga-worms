/**
 * Shared constants and builders for the weapon data rows (ultraplan.html rev 2, "Weapon roster
 * v1" and "Simulation units and tuning").
 *
 * Spatial numbers are Worms pixels used as documented: the roster lists crater DIAMETERS, so
 * radiusPx = diameter / 2. Every speed is authored in SOURCE px per logic frame and converted
 * through config/units.ts; nothing is hand converted here.
 *
 * Source physics, derived from three worms2d.info facts (Grenade, Homing Missile and Mortar pages):
 * a full power grenade thrown near vertical returns to its altitude in 4 s (200 frames, so
 * v = 100 g), the homing missile fired straight up at full power locks 546 px above the ground
 * after 0.5 s (25 v - 312.5 g = 546), and the mortar at its steepest aim lands about 240 px away
 * (R = v^2 sin(2a) / g). The first two solve to g = 0.25 px per frame squared and v = 25 px per
 * frame; the third agrees with aim steps of 2.8125 degrees. Where the tables give no number
 * (bomblet speed, knockback impulses, sprite radii) the value is a v1 tuning choice and says so.
 */

import { GAME_CONFIG } from '../../config/game-config.ts';
import { pxPerSourceFrameToPxPerSecond, sourceFramesToTicks, ticksToMs } from '../../config/units.ts';
import type { AtlasFrameId, BlastSpec, ProjectileSpec, WaterBehavior, WeaponDef, WeaponId } from '../types.ts';

/** Ammo count meaning infinite (scheme byte >= 0x80 in the source). */
export const INFINITE_AMMO = -1;

/** Full power launch speed of the source, px per logic frame (derived, see the header). */
export const SOURCE_LAUNCH_SPEED_PX_PER_FRAME = 25;

/** Source gravity, px per logic frame squared (derived, see the header). Used for calibrations only. */
export const SOURCE_GRAVITY_PX_PER_FRAME_SQ = 0.25;

/** Full charge launch speed, world px per second. */
export const MAX_LAUNCH_SPEED = pxPerSourceFrameToPxPerSecond(SOURCE_LAUNCH_SPEED_PX_PER_FRAME);

/** Selectable grenade fuses (Grenade page: 1 to 5 s) and the default the sidecar uses. */
export const FUSE_OPTIONS_MS: readonly number[] = Object.freeze([1000, 2000, 3000, 4000, 5000]);
export const FUSE_DEFAULT_MS = 3000;
/** Holy hand grenade: fixed 3 s then rest. */
export const HOLY_FUSE_MS = 3000;
/** Dynamite: fixed 5 s. */
export const DYNAMITE_FUSE_MS = 5000;
/** Dynamite and mine always grant at least 5 s of retreat (roster and worms2d.info). */
export const PLACED_RETREAT_MS = 5000;
/** Teleport and Skip Go end the turn immediately: no retreat window. */
export const IMMEDIATE_TURN_END_MS = 0;

/** Grenade restitution presets, the single source of the 0.96 / 0.60 and 0.96 / 0.30 numbers. */
export const GRENADE_MAX = GAME_CONFIG.grenadeBounce.max;
export const GRENADE_MIN = GAME_CONFIG.grenadeBounce.min;

/** Cluster fan: -45 to +45 degrees around the direction, speeds up to 9 percent slower (Cluster Bomb page). */
export const CLUSTER_SPREAD_DEG = 90;
export const CLUSTER_SPEED_JITTER = 0.09;
/** Bomblets that never land explode 9 s after release (Cluster Bomb page). */
export const BOMBLET_FAILSAFE_MS = 9000;

/** Roster craters are diameters. */
export function craterRadiusPx(diameterPx: number): number {
  return diameterPx / 2;
}

/** Source px per frame to world px per second. */
export function sourceSpeed(pxPerFrame: number): number {
  return pxPerSourceFrameToPxPerSecond(pxPerFrame);
}

/** A duration in source logic frames to ms (uzi fires every 6 frames, minigun every 3). */
export function sourceFramesToMs(frames: number): number {
  return ticksToMs(sourceFramesToTicks(frames));
}

export function iconFrame(id: WeaponId): AtlasFrameId {
  return `weapon_icon_${id}`;
}

export function heldFrame(id: WeaponId): AtlasFrameId {
  return `weapon_held_${id}`;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/** Data rows are never mutated: every def is frozen to its leaves at module load. */
export function defineWeapon(def: WeaponDef): WeaponDef {
  return deepFreeze(def);
}

export interface ContactOptions {
  readonly trail?: ProjectileSpec['trail'];
  readonly water?: WaterBehavior;
  readonly maxLifetimeMs?: number;
  readonly spinWithVelocity?: boolean;
  readonly detonateOnTimeout?: boolean;
}

/** Default lifetime cap for shells and arrows: about 400 ticks, the heuristic search horizon. */
export const SHELL_LIFETIME_MS = 7000;

/** A body that detonates on contact: shells, arrows, bomblets, bombs. Radius is a v1 tuning value. */
export function contactProjectile(sprite: AtlasFrameId, radiusPx: number, options: ContactOptions = {}): ProjectileSpec {
  return {
    sprite,
    radiusPx,
    bounce: 0,
    friction: 0,
    trail: options.trail ?? 'none',
    detonateOnTimeout: options.detonateOnTimeout ?? true,
    maxLifetimeMs: options.maxLifetimeMs ?? SHELL_LIFETIME_MS,
    spinWithVelocity: options.spinWithVelocity ?? true,
    chainReaction: false,
    water: options.water ?? 'splash',
  };
}

export interface GrenadeOptions {
  readonly trail?: ProjectileSpec['trail'];
  readonly water?: WaterBehavior;
  readonly chainReaction?: boolean;
  readonly detonateOnTimeout?: boolean;
}

/**
 * A grenade family body. bounce is the vertical (normal) fraction kept and friction the horizontal
 * (tangential) fraction kept, straight from the config presets: MAX 0.96 / 0.60, MIN 0.96 / 0.30.
 */
export function grenadeProjectile(
  sprite: AtlasFrameId,
  radiusPx: number,
  bounceMode: NonNullable<ProjectileSpec['bounceMode']>,
  maxLifetimeMs: number,
  options: GrenadeOptions = {},
): ProjectileSpec {
  const preset = bounceMode === 'min' ? GRENADE_MIN : GRENADE_MAX;
  return {
    sprite,
    radiusPx,
    bounce: preset.y,
    friction: preset.x,
    bounceMode,
    trail: options.trail ?? 'none',
    detonateOnTimeout: options.detonateOnTimeout ?? true,
    maxLifetimeMs,
    spinWithVelocity: false,
    chainReaction: options.chainReaction ?? false,
    water: options.water ?? 'splash',
  };
}

const SHAKE_BY_PARTICLE: Readonly<Record<BlastSpec['particle'], number>> = Object.freeze({
  small: 1,
  medium: 4,
  big: 6,
  holy: 10,
});

/**
 * A carving blast from a roster row: crater DIAMETER in px, max damage, and the centre knockback
 * in source px per frame (v1 tuning, converted to px per second).
 */
export function blast(
  craterDiameterPx: number,
  maxDamage: number,
  knockbackPxPerFrame: number,
  particle: BlastSpec['particle'],
): BlastSpec {
  return {
    radiusPx: craterRadiusPx(craterDiameterPx),
    maxDamage,
    knockback: sourceSpeed(knockbackPxPerFrame),
    carve: true,
    shake: SHAKE_BY_PARTICLE[particle],
    particle,
  };
}

/** A parent shell that only splits into children (mortar, cluster bomb): no damage, no crater. */
export const SPLIT_ONLY_BLAST: BlastSpec = Object.freeze({
  radiusPx: 0,
  maxDamage: 0,
  knockback: 0,
  carve: false,
  shake: 0,
  particle: 'small',
});
