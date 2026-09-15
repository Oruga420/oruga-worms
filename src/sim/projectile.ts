/**
 * Projectile stepping (architecture.md section C): gravity and wind, a 1 px ray marched sweep,
 * bounce with per weapon restitution while a fuse is pending or detonation on contact, fuse
 * countdown with the optional wait for rest (holy hand grenade), homing steer after the lock
 * delay, water behavior per spec (splash, skim or pass), lifetime timeout, and cluster children
 * spawned from the seeded rng at detonation. Bodies are mutated in place (hot path).
 */

import { angleOf, fromAngle } from '../core/math.ts';
import type { BlastSpec, ClusterSpec, ProjectileSpec } from '../weapons/types.ts';
import { REST_SPEED_PX_PER_S, REST_TICKS, TICK_S, WORM_HALF_WIDTH, WORM_HEIGHT } from './constants.ts';
import { explode } from './explosion.ts';
import { applyForces, bounce, speedOf, sweepMove } from './integrator.ts';
import type { ProjectileBody, ProjectileKind } from './types.ts';
import type { SimWorld } from './world.ts';

export interface SpawnProjectileParams {
  readonly kind?: ProjectileKind;
  readonly weaponId: string;
  readonly ownerTeamId: string | null;
  readonly ownerWormId: string | null;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly spec: ProjectileSpec;
  readonly blast: BlastSpec;
  readonly cluster?: ClusterSpec | null;
  readonly windAffected: boolean;
  readonly gravityScale: number;
  readonly fuseMs?: number | null;
  readonly restBeforeDetonate?: boolean;
  readonly homingTarget?: { readonly x: number; readonly y: number } | null;
}

export function spawnProjectile(world: SimWorld, params: SpawnProjectileParams): ProjectileBody {
  const fuseMs = params.fuseMs ?? null;
  const body: ProjectileBody = {
    id: world.nextId(),
    kind: params.kind ?? 'projectile',
    weaponId: params.weaponId,
    ownerTeamId: params.ownerTeamId,
    ownerWormId: params.ownerWormId,
    x: params.x,
    y: params.y,
    vx: params.vx,
    vy: params.vy,
    spec: params.spec,
    blast: params.blast,
    cluster: params.cluster ?? null,
    windAffected: params.windAffected,
    gravityScale: params.gravityScale,
    fuseTicks: fuseMs === null ? -1 : Math.max(1, Math.round(fuseMs / 1000 / TICK_S)),
    restBeforeDetonate: params.restBeforeDetonate ?? false,
    lifeTicks: Math.max(1, Math.round(params.spec.maxLifetimeMs / 1000 / TICK_S)),
    ageTicks: 0,
    homingTarget: params.homingTarget ?? null,
    restTicks: 0,
    alive: true,
    chainTriggered: false,
  };
  world.projectiles.push(body);
  world.events.push({ type: 'activity', kind: 'spawn' });
  return body;
}

function remove(world: SimWorld, p: ProjectileBody, reason: 'exploded' | 'water' | 'bounds' | 'timeout'): void {
  p.alive = false;
  world.events.push({ type: 'projectileGone', projectileId: p.id, reason });
}

function spawnChildren(world: SimWorld, p: ProjectileBody, cluster: ClusterSpec): void {
  const base = cluster.direction === 'back' ? angleOf({ x: -p.vx, y: -p.vy }) : -Math.PI / 2;
  const half = (cluster.spreadDeg * Math.PI) / 360;
  for (let i = 0; i < cluster.count; i += 1) {
    const t = cluster.count === 1 ? 0.5 : i / (cluster.count - 1);
    const angle = base - half + 2 * half * t;
    const speed = cluster.speed * (1 - world.rng.nextFloat(0, cluster.jitter));
    const v = fromAngle(angle, speed);
    spawnProjectile(world, {
      kind: 'cluster_child',
      weaponId: cluster.childWeaponId ?? `${p.weaponId}_child`,
      ownerTeamId: p.ownerTeamId,
      ownerWormId: p.ownerWormId,
      x: p.x,
      y: p.y - 2,
      vx: v.x,
      vy: v.y,
      spec: cluster.childProjectile,
      blast: cluster.childBlast,
      windAffected: false,
      gravityScale: 1,
    });
  }
}

export function detonate(world: SimWorld, p: ProjectileBody): void {
  if (!p.alive) return;
  explode(world, { x: p.x, y: p.y, blast: p.blast, sourceTeamId: p.ownerTeamId, sourceWormId: p.ownerWormId });
  remove(world, p, 'exploded');
  if (p.cluster !== null) spawnChildren(world, p, p.cluster);
}

function steerHoming(p: ProjectileBody, dt: number): void {
  const homing = p.spec.homing;
  const target = p.homingTarget;
  if (homing === undefined || target === null) return;
  const ageMs = p.ageTicks * TICK_S * 1000;
  if (ageMs < homing.activateAfterMs) return;
  if (homing.deactivateAfterMs !== undefined && ageMs > homing.deactivateAfterMs) return;
  const speed = speedOf(p);
  if (speed === 0) return;
  const current = angleOf({ x: p.vx, y: p.vy });
  const wanted = angleOf({ x: target.x - p.x, y: target.y - p.y });
  let delta = wanted - current;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const maxTurn = homing.turnRateRadPerSec * dt;
  const turned = current + Math.max(-maxTurn, Math.min(maxTurn, delta));
  const v = fromAngle(turned, speed);
  p.vx = v.x;
  p.vy = v.y;
}

function handleWater(world: SimWorld, p: ProjectileBody): boolean {
  const waterY = world.terrain.water.y;
  if (p.y < waterY) return false;
  if (p.spec.water === 'pass') {
    if (p.y > waterY + 60) remove(world, p, 'water');
    return !p.alive;
  }
  if (p.spec.water === 'skim' && p.vy > 0 && p.vy < Math.abs(p.vx) * 0.35) {
    p.vy = -p.vy * 0.6;
    p.y = waterY - 1;
    world.events.push({ type: 'activity', kind: 'bounce' });
    return false;
  }
  world.events.push({ type: 'sound', id: 'exp_water_splash', x: p.x, y: waterY });
  remove(world, p, 'water');
  return true;
}

/** Ticks after launch during which the shell ignores the worm that fired it, so it clears the muzzle. */
const MUZZLE_GRACE_TICKS = 12;

/** A contact shell: no fuse, no rest wait, no bounce. Grenades and dynamite are not. */
function isContactProjectile(p: ProjectileBody): boolean {
  return p.fuseTicks === -1 && !p.restBeforeDetonate && p.spec.bounce === 0;
}

/**
 * Does the segment from (x0, y0) to (x1, y1), inflated by the shell's radius, cross the worm's
 * hitbox? Slab test against the box, so a fast shell (10 px a tick) cannot tunnel through a worm 9
 * px wide, which is exactly what a per tick point test allowed.
 */
function segmentWormEntry(x0: number, y0: number, x1: number, y1: number, radius: number, wormX: number, wormFeetY: number): number | null {
  const minX = wormX - WORM_HALF_WIDTH - radius;
  const maxX = wormX + WORM_HALF_WIDTH + radius;
  const minY = wormFeetY - WORM_HEIGHT - radius;
  const maxY = wormFeetY + radius;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tMin = 0;
  let tMax = 1;
  for (const [d, o, lo, hi] of [
    [dx, x0, minX, maxX],
    [dy, y0, minY, maxY],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const inv = 1 / d;
    const tA = (lo - o) * inv;
    const tB = (hi - o) * inv;
    tMin = Math.max(tMin, Math.min(tA, tB));
    tMax = Math.min(tMax, Math.max(tA, tB));
    if (tMin > tMax) return null;
  }
  return tMin;
}

/**
 * The first live worm the shell's path crossed this tick, or null. The owner is skipped while
 * the shell is young; after that the shooter is a target like anyone else, as in the source game.
 */
function wormInPath(world: SimWorld, p: ProjectileBody, fromX: number, fromY: number): { readonly x: number; readonly y: number } | null {
  let nearest: { readonly x: number; readonly y: number } | null = null;
  let nearestEntry = Infinity;
  for (const worm of world.worms) {
    if (!worm.alive) continue;
    if (worm.id === p.ownerWormId && p.ageTicks <= MUZZLE_GRACE_TICKS) continue;
    const entry = segmentWormEntry(fromX, fromY, p.x, p.y, p.spec.radiusPx, worm.x, worm.y);
    if (entry !== null && entry < nearestEntry) {
      nearestEntry = entry;
      nearest = { x: worm.x, y: worm.y - WORM_HEIGHT / 2 };
    }
  }
  return nearest;
}

export function stepProjectile(world: SimWorld, p: ProjectileBody, dt: number): void {
  if (!p.alive) return;
  p.ageTicks += 1;
  p.lifeTicks -= 1;
  if (p.chainTriggered) {
    detonate(world, p);
    return;
  }
  if (p.fuseTicks > 0) {
    p.fuseTicks -= 1;
    if (p.fuseTicks === 0 && (!p.restBeforeDetonate || p.restTicks >= REST_TICKS)) {
      detonate(world, p);
      return;
    }
  } else if (p.fuseTicks === 0 && p.restBeforeDetonate && p.restTicks >= REST_TICKS) {
    detonate(world, p);
    return;
  }
  if (p.homingTarget !== null && p.spec.homing !== undefined) {
    // The missile blows itself up at the self destruct time even when the lifetime says remove.
    const selfDestructTicks = Math.round(p.spec.homing.selfDestructMs / 1000 / TICK_S);
    if (p.ageTicks >= selfDestructTicks) {
      detonate(world, p);
      return;
    }
    steerHoming(p, dt);
  }
  if (p.lifeTicks <= 0) {
    if (p.spec.detonateOnTimeout) detonate(world, p);
    else remove(world, p, 'timeout');
    return;
  }
  const resting = speedOf(p) < REST_SPEED_PX_PER_S && p.restTicks > 0;
  if (!resting) applyForces(p, dt, p.gravityScale, world.wind, p.windAffected, world.gravity);
  const fromX = p.x;
  const fromY = p.y;
  const hit = sweepMove(world.terrain.mask, p, dt, p.spec.radiusPx);
  // A contact shell that crossed a worm this tick detonates on the worm, not on the ground behind
  // it. The sweep knows only the terrain mask, so without this a rocket sailed through a worm on a
  // ledge and cratered somewhere else: the ground took the hit, the worm did not.
  if (isContactProjectile(p)) {
    const struck = wormInPath(world, p, fromX, fromY);
    if (struck !== null) {
      p.x = struck.x;
      p.y = struck.y;
      detonate(world, p);
      return;
    }
  }
  if (hit !== null) {
    const waitsForFuse = p.fuseTicks !== -1 || p.restBeforeDetonate;
    if (!waitsForFuse) {
      detonate(world, p);
      return;
    }
    // A fused body with zero restitution (dynamite) rests on contact until its fuse expires.
    if (p.spec.bounce === 0) {
      p.vx = 0;
      p.vy = 0;
      p.restTicks += 1;
      return;
    }
    if (bounce(p, hit, p.spec.bounce, p.spec.friction)) {
      p.restTicks = 0;
      world.events.push({ type: 'activity', kind: 'bounce' });
      world.events.push({ type: 'sound', id: p.spec.bounce > 0.9 ? 'wpn_banana_boing' : 'wpn_grenade_bounce_1', x: p.x, y: p.y });
    } else {
      p.restTicks += 1;
    }
  } else if (speedOf(p) < REST_SPEED_PX_PER_S) {
    p.restTicks += 1;
  } else {
    p.restTicks = 0;
  }
  if (p.x < -64 || p.x > world.terrain.width + 64 || p.y > world.terrain.height + 64) {
    remove(world, p, 'bounds');
    return;
  }
  handleWater(world, p);
}
