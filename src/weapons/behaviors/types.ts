/**
 * The firing boundary between a weapon def, the aim from the player or the CPU, and the sim.
 * A behavior module reads the def and the aim and spawns bodies or applies immediate effects on
 * the world, then returns whether the turn ends and how many shots are left (the shotgun and the
 * longbow fire more than once). The sim owns the bodies; the match reducer reads the events.
 */

import { degToRad } from '../../core/math.ts';
import { WORM_HEIGHT } from '../../sim/constants.ts';
import type { WormBody } from '../../sim/types.ts';
import type { SimWorld } from '../../sim/world.ts';
import type { WeaponDef } from '../types.ts';

export interface FireAim {
  /** Elevation, -90 to 90, positive is up. The worm's facing gives the horizontal side. */
  readonly angleDeg: number;
  /** 0 to 1 of full charge; uncharged weapons ignore it. */
  readonly power: number;
  /** TIMED weapons: chosen fuse, snapped to a legal option by the caller. */
  readonly fuseMs?: number;
  /** TARGETED weapons and teleport: the world point the crosshair selected. */
  readonly targetPoint?: { readonly x: number; readonly y: number };
}

export interface FireContext {
  readonly world: SimWorld;
  readonly worm: WormBody;
  readonly def: WeaponDef;
  readonly aim: FireAim;
  /** Shot index within the turn, 0 based (the shotgun fires 0 then 1). */
  readonly shotIndex: number;
}

export interface FireResult {
  /** False keeps the turn for another shot (shotgun, longbow) or a utility. */
  readonly endsTurn: boolean;
  /** Shots left after this one; the match reducer passes it back as FireStarted.shotsRemaining. */
  readonly shotsRemaining: number;
  /** True while a controlled descent (parachute, jetpack) is active, so Resolving does not force settle it. */
  readonly controlledDescent?: boolean;
}

/** The muzzle: a little in front of the worm's chest, in the facing direction. */
export function muzzlePoint(worm: WormBody): { readonly x: number; readonly y: number } {
  return { x: worm.x + worm.facing * 6, y: worm.y - WORM_HEIGHT * 0.6 };
}

/** Unit aim direction from the elevation and the worm's facing (up is negative y). */
export function aimDirection(worm: WormBody, angleDeg: number): { readonly x: number; readonly y: number } {
  const a = degToRad(angleDeg);
  return { x: Math.cos(a) * worm.facing, y: -Math.sin(a) };
}

export function endsAfter(shotsRemaining: number): FireResult {
  return { endsTurn: shotsRemaining <= 0, shotsRemaining: Math.max(0, shotsRemaining) };
}
