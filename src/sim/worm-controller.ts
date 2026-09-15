/**
 * Worm movement over the mask (architecture.md section C): walking with a step up of 6 px and a
 * stop at anything taller, jump and backflip impulses, falling with the canonical fall damage on
 * landing (the first landing after a blast is exempt, ultraplan rev 2 design rule), the flying
 * state after knockback that bounces off walls until slow, drowning below the water line, and
 * the rest predicate the Resolving phase waits for. Mutates the worm in place (hot path).
 */

import { isDrowned } from '../terrain/water.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import { isSolid } from '../terrain/queries.ts';
import { groundBelow } from './collision.ts';
import {
  BACKFLIP_VX_PX_PER_S,
  BACKFLIP_VY_PX_PER_S,
  DROWN_DEPTH_PX,
  DROWN_SINK_PX_PER_S,
  JUMP_VX_PX_PER_S,
  JUMP_VY_PX_PER_S,
  REST_SPEED_PX_PER_S,
  STEP_DOWN_PX,
  STEP_UP_PX,
  TERMINAL_FALL_PX_PER_S,
  WALK_SPEED_PX_PER_S,
  WORM_FLY_FRICTION,
  WORM_FLY_RESTITUTION,
  WORM_HALF_WIDTH,
  WORM_HEIGHT,
  JETPACK_MAX_SPEED_PX_PER_S,
  JETPACK_SIDE_ACCEL_PX_PER_S2,
  JETPACK_THRUST_PX_PER_S2,
} from './constants.ts';
import { fallDamage } from './damage.ts';
import { applyForces, bounce, speedOf, sweepMove as sweepBodyMove } from './integrator.ts';
import type { SimEvent, WormBody, WormIntent } from './types.ts';
import type { SimWorld } from './world.ts';

function airborne(worm: WormBody): boolean {
  return worm.motion === 'jumping' || worm.motion === 'falling' || worm.motion === 'flying' || worm.motion === 'parachuting' || worm.motion === 'jetpacking';
}

/** Free column of WORM_HEIGHT pixels above the feet at (x, feetY). */
export function headroomFree(mask: TerrainMask, x: number, feetY: number): boolean {
  const cx = Math.round(x);
  for (let dy = 1; dy <= WORM_HEIGHT; dy += 1) {
    for (let dx = -WORM_HALF_WIDTH; dx <= WORM_HALF_WIDTH; dx += 1) {
      if (isSolid(mask, cx + dx, Math.round(feetY) - dy)) return false;
    }
  }
  return true;
}

/** Solid from row y + 1 down to bottom inclusive: the pixel is part of a step rooted in the ground, not a floating ledge. */
function rootedBelow(mask: TerrainMask, x: number, y: number, bottom: number): boolean {
  for (let yy = y + 1; yy <= bottom; yy += 1) if (!isSolid(mask, x, yy)) return false;
  return true;
}

/**
 * Row of the highest ground pixel the worm can stand on at column tx, scanning its whole footprint
 * (tx minus half to tx plus half) from STEP_UP_PX above the feet down to a STEP_DOWN_PX drop.
 * Only pixels whose column stays solid down through that window count, so a spike or a step
 * rooted in the ground is stood on while a floating ledge or a ceiling is left to headroomFree.
 * Null means nothing to stand on within a step down.
 */
export function standingRow(mask: TerrainMask, tx: number, feet: number, half: number): number | null {
  const top = feet - STEP_UP_PX;
  // A drop of STEP_DOWN_PX puts the feet at feet + STEP_DOWN_PX, on a ground row one below that.
  const bottom = feet + STEP_DOWN_PX + 1;
  for (let y = top; y <= bottom; y += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const x = tx + dx;
      if (isSolid(mask, x, y) && rootedBelow(mask, x, y, bottom)) return y;
    }
  }
  return null;
}

/**
 * Tries one horizontal step to targetX: a slope of at most STEP_UP_PX is climbed, a taller wall
 * blocks, a drop of at most STEP_DOWN_PX is followed, anything deeper starts a fall.
 *
 * The ground is read over the worm's whole footprint, the same width headroomFree checks above the
 * feet. Reading it on the centre column alone let a thin spike sit inside the footprint just above
 * the feet: standing beside it was fine, but every step in either direction failed the headroom
 * check and the worm froze in place (3 of 10 random islands, backlog 4.5). Now that spike is a step
 * the worm stands on and walks off.
 */
export function stepHorizontal(mask: TerrainMask, worm: WormBody, targetX: number): 'moved' | 'blocked' | 'falling' {
  const tx = Math.round(targetX);
  const feet = Math.round(worm.y);
  const row = standingRow(mask, tx, feet, WORM_HALF_WIDTH);
  if (row !== null) {
    const newFeet = row - 1;
    if (!headroomFree(mask, tx, newFeet)) return 'blocked';
    worm.x = targetX;
    worm.y = newFeet;
    return 'moved';
  }
  if (!headroomFree(mask, tx, feet)) return 'blocked';
  worm.x = targetX;
  return groundBelow(mask, worm.x, worm.y, WORM_HALF_WIDTH) ? 'moved' : 'falling';
}

function land(worm: WormBody, landingSpeed: number, events: SimEvent[]): void {
  const damage = worm.exemptNextLanding ? 0 : fallDamage(landingSpeed);
  worm.exemptNextLanding = false;
  worm.motion = 'idle';
  worm.onGround = true;
  worm.vx = 0;
  worm.vy = 0;
  worm.restTicks = 0;
  events.push({ type: 'landed', wormId: worm.id, speed: landingSpeed });
  if (damage > 0) events.push({ type: 'damage', wormId: worm.id, amount: damage, sourceTeamId: null, sourceWormId: null, cause: 'fall' });
}

/**
 * Jetpack flight while the fuel lasts: thrust against gravity on the held jump key, a sideways
 * nudge on the movement keys, both capped so a frame's travel stays inside the sweep. Fuel drains
 * only while thrusting, matching the source's per thruster burn. Empty tank: a plain fall.
 */
function stepJetpack(worm: WormBody, intent: WormIntent, dt: number): void {
  if (worm.fuelMs <= 0) {
    worm.motion = 'falling';
    return;
  }
  if (intent.thrust) {
    worm.vy -= JETPACK_THRUST_PX_PER_S2 * dt;
    worm.fuelMs = Math.max(0, worm.fuelMs - dt * 1000);
  }
  worm.vx += intent.moveX * JETPACK_SIDE_ACCEL_PX_PER_S2 * dt;
  if (intent.moveX === 0) worm.vx *= Math.max(0, 1 - 4 * dt);
  if (intent.moveX !== 0) worm.facing = intent.moveX;
  worm.vx = Math.max(-JETPACK_MAX_SPEED_PX_PER_S, Math.min(JETPACK_MAX_SPEED_PX_PER_S, worm.vx));
  worm.vy = Math.max(-JETPACK_MAX_SPEED_PX_PER_S, Math.min(JETPACK_MAX_SPEED_PX_PER_S, worm.vy));
}

function stepAirborne(world: SimWorld, worm: WormBody, intent: WormIntent, dt: number): void {
  const mask = world.terrain.mask;
  applyForces(worm, dt, 1, world.wind, worm.motion === 'parachuting', world.gravity);
  if (worm.motion === 'jetpacking') stepJetpack(worm, intent, dt);
  if (worm.motion === 'parachuting') {
    worm.vy = Math.min(worm.vy, TERMINAL_FALL_PX_PER_S * 0.15);
    // A parachute steers: the movement keys drift the worm sideways against the wind.
    worm.vx += intent.moveX * JETPACK_SIDE_ACCEL_PX_PER_S2 * 0.5 * dt;
    if (intent.moveX !== 0) worm.facing = intent.moveX;
  }
  if (worm.vy > TERMINAL_FALL_PX_PER_S) worm.vy = TERMINAL_FALL_PX_PER_S;
  const before = worm.vy;
  const hit = sweepBodyMove(mask, worm, dt, 0);
  if (hit === null) return;
  const landingOnFloor = hit.normal.y < -0.3 && before >= 0;
  if (worm.motion === 'flying' && !landingOnFloor) {
    if (!bounce(worm, hit, WORM_FLY_RESTITUTION, WORM_FLY_FRICTION)) worm.motion = 'falling';
    world.events.push({ type: 'activity', kind: 'bounce' });
    return;
  }
  if (landingOnFloor) {
    const landingSpeed = Math.hypot(worm.vx, before);
    if (worm.motion === 'flying' && landingSpeed > TERMINAL_FALL_PX_PER_S * 0.5 && bounce(worm, hit, WORM_FLY_RESTITUTION * 0.5, WORM_FLY_FRICTION)) {
      world.events.push({ type: 'activity', kind: 'bounce' });
      return;
    }
    land(worm, before, world.events);
    return;
  }
  // Side or ceiling contact while jumping or falling: kill the blocked component and keep falling.
  if (Math.abs(hit.normal.x) > 0.5) worm.vx = 0;
  if (hit.normal.y > 0.3) worm.vy = Math.max(0, worm.vy);
  worm.motion = 'falling';
}

function stepGrounded(world: SimWorld, worm: WormBody, intent: WormIntent, dt: number): void {
  const mask = world.terrain.mask;
  if (intent.backflip) {
    worm.vx = BACKFLIP_VX_PX_PER_S * worm.facing;
    worm.vy = BACKFLIP_VY_PX_PER_S;
    worm.motion = 'jumping';
    worm.onGround = false;
    worm.fallStartY = worm.y;
    return;
  }
  if (intent.jump) {
    worm.vx = JUMP_VX_PX_PER_S * worm.facing;
    worm.vy = JUMP_VY_PX_PER_S;
    worm.motion = 'jumping';
    worm.onGround = false;
    worm.fallStartY = worm.y;
    return;
  }
  if (intent.moveX !== 0) {
    worm.facing = intent.moveX;
    const outcome = stepHorizontal(mask, worm, worm.x + intent.moveX * WALK_SPEED_PX_PER_S * dt);
    if (outcome === 'falling') {
      worm.motion = 'falling';
      worm.onGround = false;
      worm.fallStartY = worm.y;
      worm.vx = intent.moveX * WALK_SPEED_PX_PER_S * 0.5;
      return;
    }
    worm.motion = outcome === 'moved' ? 'walking' : 'idle';
    worm.restTicks = 0;
    return;
  }
  if (!groundBelow(mask, worm.x, worm.y, WORM_HALF_WIDTH)) {
    worm.motion = 'falling';
    worm.onGround = false;
    worm.fallStartY = worm.y;
    return;
  }
  worm.motion = 'idle';
  worm.restTicks += 1;
}

function stepDrowning(world: SimWorld, worm: WormBody, dt: number): void {
  worm.y += DROWN_SINK_PX_PER_S * dt;
  worm.drownTicks += 1;
  if (worm.y > world.terrain.water.y + DROWN_DEPTH_PX || worm.y > world.terrain.height + DROWN_DEPTH_PX) {
    worm.motion = 'dead';
    worm.alive = false;
  }
}

export function stepWorm(world: SimWorld, worm: WormBody, intent: WormIntent, dt: number): void {
  if (!worm.alive || worm.motion === 'dead') return;
  if (worm.motion === 'drowning') {
    stepDrowning(world, worm, dt);
    return;
  }
  if (isDrowned(world.terrain.water, worm.y)) {
    worm.motion = 'drowning';
    worm.vx = 0;
    worm.vy = 0;
    worm.onGround = false;
    world.events.push({ type: 'drown', wormId: worm.id });
    world.events.push({ type: 'sound', id: 'wrm_drown_gurgle', x: worm.x, y: worm.y });
    return;
  }
  if (airborne(worm)) stepAirborne(world, worm, intent, dt);
  else stepGrounded(world, worm, intent, dt);
  // A grounded worm that is still moving (sliding after a walk) is not resting yet.
  if (worm.onGround && worm.motion === 'idle' && speedOf(worm) >= REST_SPEED_PX_PER_S) worm.restTicks = 0;
}
