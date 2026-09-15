/**
 * Pooled particle system (architecture.md section G, decision 3: explosions render procedurally
 * as sparks on randomized vectors, smoke puffs with randomized rotation, scale and alpha decay,
 * and debris; section I: "pooled particle system, explosion composition"). Particles are the
 * textbook allocation churn case, so they live in a core/pool.ts pool and are updated in place.
 *
 * MUTATION NOTE: Particle objects are mutable by design; the pool owns them (see pool.ts). The
 * update and draw paths allocate nothing per particle. The explosion composer is split into a
 * pure plan (counts and speeds from radius and intensity) and a spawn step driven by a seeded
 * Rng so a replay produces the same debris.
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { createPool } from '../core/pool.ts';
import type { Rng } from '../core/rng.ts';
import { shakeOffset, type Camera } from './camera.ts';
import type { Ctx2D, Size } from './canvas-types.ts';

export const PARTICLE_KINDS = ['spark', 'smoke', 'debris'] as const;

export type ParticleKind = (typeof PARTICLE_KINDS)[number];

export const DEFAULT_PARTICLE_CAPACITY = 1024;
/** Cosmetic gravity in world px per second squared; the simulation has its own through units.ts. */
export const DEFAULT_PARTICLE_GRAVITY = 400;
/** One explosion never spawns more than this many particles. */
export const MAX_EXPLOSION_PARTICLES = 220;

const SPARK_COLORS: readonly string[] = Object.freeze(['#fff6c8', '#ffd166', '#ff9f43', '#ff6b35']);
const SMOKE_COLORS: readonly string[] = Object.freeze(['#5a5a5a', '#6e6e6e', '#8a8a8a']);
const DEBRIS_COLORS: readonly string[] = Object.freeze(['#3d2b1f', '#5b4030', '#2c2c2c']);

/** Pooled and mutable by design; world units, seconds. */
export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left; dead at 0. */
  life: number;
  maxLife: number;
  /** Radius or half size in world px. */
  size: number;
  /** Size change per second. */
  growth: number;
  alpha: number;
  rotation: number;
  /** Radians per second. */
  spin: number;
  /** Multiplier on the system gravity; negative rises. */
  gravityScale: number;
  /** Fraction of the velocity lost per second. */
  drag: number;
  color: string;
}

export function createParticle(): Particle {
  return {
    kind: 'spark',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    size: 0,
    growth: 0,
    alpha: 0,
    rotation: 0,
    spin: 0,
    gravityScale: 1,
    drag: 0,
    color: '#ffffff',
  };
}

export function resetParticle(particle: Particle): void {
  particle.life = 0;
  particle.maxLife = 0;
  particle.alpha = 0;
}

/** Alpha for the remaining life fraction (1 fresh, 0 dead). */
export function alphaCurve(kind: ParticleKind, remaining: number): number {
  const t = clamp(remaining, 0, 1);
  switch (kind) {
    case 'spark':
      return t;
    case 'smoke':
      return 0.55 * t * (2 - t);
    case 'debris':
      return t < 0.25 ? t * 4 : 1;
  }
}

/** One integration step in place; false once the particle is dead. */
export function updateParticle(particle: Particle, dtSeconds: number, gravity: number): boolean {
  particle.life -= dtSeconds;
  if (particle.life <= 0) {
    particle.life = 0;
    particle.alpha = 0;
    return false;
  }
  const damping = Math.max(0, 1 - particle.drag * dtSeconds);
  particle.vx *= damping;
  particle.vy = particle.vy * damping + gravity * particle.gravityScale * dtSeconds;
  particle.x += particle.vx * dtSeconds;
  particle.y += particle.vy * dtSeconds;
  particle.rotation += particle.spin * dtSeconds;
  particle.size = Math.max(0, particle.size + particle.growth * dtSeconds);
  particle.alpha = alphaCurve(particle.kind, particle.maxLife > 0 ? particle.life / particle.maxLife : 0);
  return true;
}

export interface ExplosionPlan {
  readonly sparks: number;
  readonly smoke: number;
  readonly debris: number;
  /** Peak launch speeds in world px per second. */
  readonly sparkSpeed: number;
  readonly smokeSpeed: number;
  readonly debrisSpeed: number;
  readonly smokeSize: number;
  readonly debrisSize: number;
}

/** Counts and speeds from a crater radius in world px and an intensity in [0, 1]; pure. */
export function explosionPlan(radius: number, intensity: number, cap: number = MAX_EXPLOSION_PARTICLES): ExplosionPlan {
  const r = clamp(Number.isFinite(radius) ? radius : 0, 4, 400);
  const i = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  const energy = 0.5 + i;
  const sparks = Math.round(8 + r * 0.6 * energy);
  const smoke = Math.round(3 + r * 0.15 * energy);
  const debris = Math.round(2 + r * 0.2 * i);
  const total = sparks + smoke + debris;
  const scale = total > cap ? cap / total : 1;
  return Object.freeze({
    sparks: Math.floor(sparks * scale),
    smoke: Math.floor(smoke * scale),
    debris: Math.floor(debris * scale),
    sparkSpeed: 120 + r * 3 * energy,
    smokeSpeed: 20 + r * 0.6,
    debrisSpeed: 60 + r * 2 * energy,
    smokeSize: 4 + r * 0.25,
    debrisSize: 1.5 + r * 0.02,
  });
}

export interface ExplosionSpec {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly intensity: number;
}

function pickColor(colors: readonly string[], rng: Rng): string {
  return rng.pick(colors) ?? '#ffffff';
}

function launch(particle: Particle, spec: ExplosionSpec, angle: number, speed: number): void {
  particle.x = spec.x;
  particle.y = spec.y;
  particle.vx = Math.cos(angle) * speed;
  particle.vy = Math.sin(angle) * speed;
  particle.rotation = 0;
  particle.spin = 0;
  particle.growth = 0;
}

function initSpark(particle: Particle, spec: ExplosionSpec, plan: ExplosionPlan, rng: Rng): void {
  particle.kind = 'spark';
  launch(particle, spec, rng.nextFloat(0, TWO_PI), plan.sparkSpeed * rng.nextFloat(0.3, 1));
  particle.maxLife = rng.nextFloat(0.25, 0.6);
  particle.life = particle.maxLife;
  particle.size = rng.nextFloat(0.8, 1.8);
  particle.alpha = 1;
  particle.gravityScale = 0.6;
  particle.drag = 1.5;
  particle.color = pickColor(SPARK_COLORS, rng);
}

function initSmoke(particle: Particle, spec: ExplosionSpec, plan: ExplosionPlan, rng: Rng): void {
  particle.kind = 'smoke';
  // Screen y points down, so straight up is minus half a turn; the cone opens 1.2 rad each way.
  launch(particle, spec, -Math.PI / 2 + rng.nextFloat(-1.2, 1.2), plan.smokeSpeed * rng.nextFloat(0.2, 1));
  particle.maxLife = rng.nextFloat(0.8, 1.6);
  particle.life = particle.maxLife;
  particle.size = plan.smokeSize * rng.nextFloat(0.6, 1);
  particle.growth = particle.size * 0.8;
  particle.spin = rng.nextFloat(-0.8, 0.8);
  particle.alpha = alphaCurve('smoke', 1);
  particle.gravityScale = -0.15;
  particle.drag = 1.2;
  particle.color = pickColor(SMOKE_COLORS, rng);
}

function initDebris(particle: Particle, spec: ExplosionSpec, plan: ExplosionPlan, rng: Rng): void {
  particle.kind = 'debris';
  launch(particle, spec, rng.nextFloat(-Math.PI, 0), plan.debrisSpeed * rng.nextFloat(0.4, 1));
  particle.maxLife = rng.nextFloat(0.8, 1.5);
  particle.life = particle.maxLife;
  particle.size = plan.debrisSize * rng.nextFloat(0.7, 1.4);
  particle.spin = rng.nextFloat(-8, 8);
  particle.alpha = 1;
  particle.gravityScale = 1;
  particle.drag = 0.2;
  particle.color = pickColor(DEBRIS_COLORS, rng);
}

export interface ParticleSystemOptions {
  readonly capacity?: number;
  readonly gravity?: number;
}

export interface ParticleSystem {
  readonly capacity: number;
  readonly gravity: number;
  count(): number;
  /** Acquires a pooled particle and runs init on it; null when the pool is full. */
  spawn(init: (particle: Particle) => void): Particle | null;
  /** Integrates every particle and releases the dead ones. */
  update(dtSeconds: number): void;
  forEach(visit: (particle: Particle) => void): void;
  clear(): void;
}

export function createParticleSystem(options: ParticleSystemOptions = {}): ParticleSystem {
  const capacity = options.capacity ?? DEFAULT_PARTICLE_CAPACITY;
  const gravity = options.gravity ?? DEFAULT_PARTICLE_GRAVITY;
  const pool = createPool<Particle>({
    capacity,
    create: createParticle,
    reset: resetParticle,
    prewarm: Math.min(capacity, 256),
  });
  return {
    capacity,
    gravity,
    count: () => pool.activeCount(),
    spawn: (init) => {
      const particle = pool.acquire();
      if (particle === null) return null;
      init(particle);
      return particle;
    },
    update: (dtSeconds) => {
      const step = Math.max(0, dtSeconds);
      pool.sweep((particle) => !updateParticle(particle, step, gravity));
    },
    forEach: (visit) => pool.forEach(visit),
    clear: () => pool.clear(),
  };
}

/** Spawns an explosion's sparks, smoke and debris; returns how many fit in the pool. */
export function spawnExplosion(system: ParticleSystem, spec: ExplosionSpec, rng: Rng): number {
  const plan = explosionPlan(spec.radius, spec.intensity);
  let spawned = 0;
  const batch = (count: number, init: (particle: Particle) => void): boolean => {
    for (let n = 0; n < count; n += 1) {
      if (system.spawn(init) === null) return false;
      spawned += 1;
    }
    return true;
  };
  if (!batch(plan.smoke, (particle) => initSmoke(particle, spec, plan, rng))) return spawned;
  if (!batch(plan.debris, (particle) => initDebris(particle, spec, plan, rng))) return spawned;
  batch(plan.sparks, (particle) => initSpark(particle, spec, plan, rng));
  return spawned;
}

function drawSmoke(ctx: Ctx2D, particle: Particle, zoom: number, ox: number, oy: number): void {
  ctx.globalAlpha = particle.alpha;
  ctx.fillStyle = particle.color;
  ctx.beginPath();
  ctx.arc(particle.x * zoom + ox, particle.y * zoom + oy, Math.max(0.5, particle.size * zoom), 0, TWO_PI);
  ctx.fill();
}

function drawDebris(ctx: Ctx2D, particle: Particle, zoom: number, ox: number, oy: number): void {
  const half = Math.max(0.5, particle.size * zoom);
  ctx.globalAlpha = particle.alpha;
  ctx.fillStyle = particle.color;
  ctx.save();
  ctx.translate(particle.x * zoom + ox, particle.y * zoom + oy);
  ctx.rotate(particle.rotation);
  ctx.fillRect(-half, -half * 0.6, half * 2, half * 1.2);
  ctx.restore();
}

function drawSpark(ctx: Ctx2D, particle: Particle, zoom: number, ox: number, oy: number): void {
  const half = Math.max(0.5, particle.size * zoom);
  ctx.globalAlpha = particle.alpha;
  ctx.fillStyle = particle.color;
  ctx.fillRect(particle.x * zoom + ox - half, particle.y * zoom + oy - half, half * 2, half * 2);
}

/** Draws smoke, then debris, then additive sparks; the camera maps world px to CSS px. */
export function drawParticles(ctx: Ctx2D, system: ParticleSystem, camera: Camera, viewport: Size): void {
  if (system.count() === 0) return;
  const zoom = camera.zoom;
  const shake = shakeOffset(camera.shake);
  const ox = viewport.w / 2 - (camera.x + shake.x) * zoom;
  const oy = viewport.h / 2 - (camera.y + shake.y) * zoom;
  ctx.save();
  system.forEach((particle) => {
    if (particle.kind === 'smoke') drawSmoke(ctx, particle, zoom, ox, oy);
  });
  system.forEach((particle) => {
    if (particle.kind === 'debris') drawDebris(ctx, particle, zoom, ox, oy);
  });
  ctx.globalCompositeOperation = 'lighter';
  system.forEach((particle) => {
    if (particle.kind === 'spark') drawSpark(ctx, particle, zoom, ox, oy);
  });
  ctx.restore();
}
