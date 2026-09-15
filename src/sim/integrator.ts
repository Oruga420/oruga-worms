/**
 * Velocity integration and the swept move shared by every body (architecture.md section C):
 * gravity scaled per weapon, wind on flagged bodies as a fraction of gravity, then a ray marched
 * move against the mask. Bodies are mutated in place (hot path).
 */

import { dampedBounce, vec2 } from '../core/math.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import { sweep, type Hit } from './collision.ts';
import { GRAVITY_PX_PER_S2, MIN_BOUNCE_SPEED_PX_PER_S } from './constants.ts';

export interface Moving {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Wind as a fraction of gravity: step 10 pushes a bazooka shell with 1.19 g sideways (Wind page). */
export function windAcceleration(windFraction: number, gravity = GRAVITY_PX_PER_S2): number {
  return windFraction * gravity;
}

export function applyForces(body: Moving, dt: number, gravityScale: number, windFraction: number, windAffected: boolean, gravity = GRAVITY_PX_PER_S2): void {
  body.vy += gravity * gravityScale * dt;
  if (windAffected) body.vx += windAcceleration(windFraction, gravity) * dt;
}

/** Moves the body along its velocity for dt seconds, stopping at the first solid pixel. */
export function sweepMove(mask: TerrainMask, body: Moving, dt: number, radius = 0): Hit | null {
  const result = sweep(mask, body.x, body.y, body.x + body.vx * dt, body.y + body.vy * dt, radius);
  body.x = result.x;
  body.y = result.y;
  return result.hit;
}

/**
 * Bounce response after a hit: reflects the velocity with restitution and friction, then nudges
 * the body one pixel along the normal so it does not stick. Returns false when the bounce would
 * be slower than the minimum, in which case the body stops instead.
 */
export function bounce(body: Moving, hit: Hit, restitution: number, friction: number): boolean {
  const bounced = dampedBounce(vec2(body.vx, body.vy), hit.normal, restitution, friction);
  const speed = Math.hypot(bounced.x, bounced.y);
  body.x = hit.x + hit.normal.x;
  body.y = hit.y + hit.normal.y;
  if (speed < MIN_BOUNCE_SPEED_PX_PER_S) {
    body.vx = 0;
    body.vy = 0;
    return false;
  }
  body.vx = bounced.x;
  body.vy = bounced.y;
  return true;
}

export function speedOf(body: Moving): number {
  return Math.hypot(body.vx, body.vy);
}
