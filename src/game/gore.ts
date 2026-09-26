/**
 * Gore (presentation only, on the render clock beside the explosion particles): blood droplets and
 * mist that fly, hit the land and stain it, gibs that bounce and bleed, wounded worms that drip,
 * brass casings that tinkle off the guns, and blood thrown on the camera lens. The sim never reads
 * any of it, so none of it can change a match.
 *
 * Stains are painted INTO the terrain tiles with source-atop (tiles.ts paintDots): they only land
 * on land, and a later crater erases a stain together with the land it sits on, so the picture
 * never shows blood floating over a hole.
 *
 * MUTATION NOTE: pooled bits are mutable by design, like particles.ts; the pool owns them and the
 * update and draw paths allocate nothing per bit.
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { createPool, type Pool } from '../core/pool.ts';
import type { Rng } from '../core/rng.ts';
import { shakeOffset, type Camera } from '../engine/camera.ts';
import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { isSolid } from '../terrain/queries.ts';
import type { TerrainData } from '../terrain/terrain.ts';
import { paintDots, type Dot } from '../terrain/tiles.ts';

/** Cosmetic gravity, world px per second squared: a little lighter than the sim's, so sprays hang. */
export const GORE_GRAVITY = 520;
export const GORE_CAPACITY = 2000;
/** Chunks lying on the ground at once; the oldest rot away past this. */
export const MAX_RESTING_CHUNKS = 90;
/** One burst never throws more droplets than this. */
export const MAX_BURST_DROPS = 170;
export const MAX_LENS_SPLATS = 14;

export type GoreKind = 'drop' | 'mist' | 'chunk';
export type ChunkShape = 'flesh' | 'guts' | 'eye' | 'bone' | 'bandana' | 'casing';
export type BloodCause = 'blast' | 'fall' | 'hit' | 'melee';

/** Body colours of the four character sheets, sampled from the sprites, by team colour index. */
export interface GibPalette {
  readonly skin: string;
  readonly dark: string;
  readonly belly: string;
}

export const GIB_PALETTES: readonly GibPalette[] = Object.freeze([
  Object.freeze({ skin: '#909060', dark: '#606040', belly: '#f0d090' }),
  Object.freeze({ skin: '#60d0b0', dark: '#308070', belly: '#f0f0c0' }),
  Object.freeze({ skin: '#f0b000', dark: '#703000', belly: '#d09020' }),
  Object.freeze({ skin: '#1c4050', dark: '#001020', belly: '#80a0a0' }),
]);

/** The body colours of a team's character sheet. */
export function bodyPalette(colorIndex: number): GibPalette {
  return GIB_PALETTES[colorIndex % GIB_PALETTES.length] ?? GIB_PALETTES[0] ?? { skin: '#909060', dark: '#606040', belly: '#f0d090' };
}

/** The sheets' bandana green, so a torn strip reads as the worm it came from. */
export const BANDANA_GREEN = '#00d000';
const BLOOD: readonly string[] = Object.freeze(['#b0101a', '#8f0a12', '#c8141e', '#6e060c']);
const MEAT = '#a3121c';
const GUTS = '#d0607a';
const GUTS_DARK = '#8a2238';
const BONE = '#efe6d2';
const BRASS = '#d4a017';
/** Stain colours, fresh to old; each is painted in its own batch. */
const STAINS: readonly string[] = Object.freeze(['rgba(128, 6, 12, 0.82)', 'rgba(150, 12, 18, 0.72)', 'rgba(86, 4, 8, 0.9)']);

export interface GoreBit {
  kind: GoreKind;
  shape: ChunkShape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left; flying bits die at 0, resting chunks fade over the last second and a half. */
  life: number;
  maxLife: number;
  /** World px: droplet half size, mist radius, chunk half length. */
  size: number;
  growth: number;
  rotation: number;
  spin: number;
  color: string;
  accent: string;
  resting: boolean;
  bounces: number;
  /** World px flown since the last trail droplet. */
  trail: number;
  /** Which stain batch a droplet paints with. */
  stain: number;
}

/** Blood thrown on the camera: screen space, it slides and fades. */
export interface LensSplat {
  /** Viewport fractions, 0..1. */
  readonly x: number;
  readonly y: number;
  /** CSS px. */
  readonly r: number;
  life: number;
  readonly maxLife: number;
  readonly seed: number;
  /** CSS px the drips have run down. */
  drip: number;
}

export interface GoreSystem {
  readonly bits: Pool<GoreBit>;
  readonly lens: LensSplat[];
  /** Stain dots waiting for the next paint, one batch per stain colour. */
  readonly pending: Dot[][];
  /** False turns every spawn into a no op (?gore=0). */
  enabled: boolean;
  /** Stain rects painted so far, for the frame overlay and the tests. */
  stains: number;
}

function createBit(): GoreBit {
  return {
    kind: 'drop',
    shape: 'flesh',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    size: 1,
    growth: 0,
    rotation: 0,
    spin: 0,
    color: '#000',
    accent: '#000',
    resting: false,
    bounces: 0,
    trail: 0,
    stain: 0,
  };
}

function resetBit(bit: GoreBit): void {
  bit.life = 0;
  bit.resting = false;
  bit.trail = 0;
}

/** ?gore=0 (or off, false) in the page URL turns the blood and the gibs off; they are on by default. */
export function goreEnabledFromSearch(search: string): boolean {
  return !/[?&]gore=(0|off|false)(&|$)/i.test(search);
}

export function createGore(capacity = GORE_CAPACITY): GoreSystem {
  return {
    bits: createPool<GoreBit>({ capacity, create: createBit, reset: resetBit, prewarm: Math.min(capacity, 400) }),
    lens: [],
    pending: STAINS.map(() => []),
    enabled: true,
    stains: 0,
  };
}

export function goreCount(gore: GoreSystem): number {
  return gore.bits.activeCount();
}

/** A fresh match: nothing flying, nothing on the lens (the stains went with the old terrain). */
export function resetGore(gore: GoreSystem): void {
  gore.bits.clear();
  gore.lens.length = 0;
  for (const dots of gore.pending) dots.length = 0;
}

function pick(colors: readonly string[], rng: Rng): string {
  return rng.pick(colors) ?? '#8f0a12';
}

function spawnDrop(gore: GoreSystem, x: number, y: number, vx: number, vy: number, size: number, rng: Rng): boolean {
  const bit = gore.bits.acquire();
  if (bit === null) return false;
  bit.kind = 'drop';
  bit.x = x;
  bit.y = y;
  bit.vx = vx;
  bit.vy = vy;
  bit.maxLife = rng.nextFloat(1.6, 3.2);
  bit.life = bit.maxLife;
  bit.size = size;
  bit.growth = 0;
  bit.color = pick(BLOOD, rng);
  bit.stain = rng.nextInt(0, STAINS.length - 1);
  bit.resting = false;
  return true;
}

function spawnMist(gore: GoreSystem, x: number, y: number, vx: number, vy: number, size: number, rng: Rng): void {
  const bit = gore.bits.acquire();
  if (bit === null) return;
  bit.kind = 'mist';
  bit.x = x;
  bit.y = y;
  bit.vx = vx;
  bit.vy = vy;
  bit.maxLife = rng.nextFloat(0.45, 0.9);
  bit.life = bit.maxLife;
  bit.size = size;
  bit.growth = size * rng.nextFloat(1.2, 2.2);
  bit.color = pick(BLOOD, rng);
  bit.resting = false;
}

export interface BloodSpec {
  /** Where the blow landed, world px, and which way it pushed (a unit vector). */
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  /** Damage dealt: more damage, more blood. */
  readonly amount: number;
  readonly cause: BloodCause;
}

/** How each kind of wound bleeds: a bullet exits in a tight jet, a blast sprays wide, a fall splashes. */
const WOUNDS: Readonly<Record<BloodCause, { readonly base: number; readonly perDamage: number; readonly spread: number; readonly min: number; readonly max: number; readonly back: number; readonly mist: number }>> = Object.freeze({
  hit: { base: 10, perDamage: 2.2, spread: 0.35, min: 120, max: 340, back: 0.22, mist: 0.12 },
  melee: { base: 14, perDamage: 1.7, spread: 0.8, min: 80, max: 300, back: 0.1, mist: 0.2 },
  blast: { base: 10, perDamage: 1.5, spread: 1.35, min: 90, max: 380, back: 0.05, mist: 0.25 },
  fall: { base: 8, perDamage: 1.3, spread: 1.1, min: 40, max: 170, back: 0, mist: 0.1 },
});

/** Sprays blood from a wound; returns the droplets that fit in the pool. */
export function bloodBurst(gore: GoreSystem, spec: BloodSpec, rng: Rng): number {
  if (!gore.enabled || !(spec.amount > 0)) return 0;
  const wound = WOUNDS[spec.cause];
  const count = Math.min(MAX_BURST_DROPS, Math.round(wound.base + spec.amount * wound.perDamage));
  const len = Math.hypot(spec.dx, spec.dy);
  const dx = len > 0 ? spec.dx / len : 0;
  const dy = len > 0 ? spec.dy / len : -1;
  const heading = Math.atan2(dy, dx);
  const boost = 1 + Math.min(1.2, spec.amount / 45);
  let spawned = 0;
  for (let i = 0; i < count; i += 1) {
    let angle: number;
    if (spec.cause === 'fall') {
      // A splash out to both sides of the feet, never into the ground.
      angle = -Math.PI / 2 + rng.nextFloat(-wound.spread, wound.spread);
    } else {
      const backwards = rng.next() < wound.back;
      angle = (backwards ? heading + Math.PI : heading) + rng.nextFloat(-wound.spread, wound.spread) * (backwards ? 0.7 : 1);
    }
    const speed = rng.nextFloat(wound.min, wound.max) * boost * (0.4 + rng.next() * 0.6);
    const ok = spawnDrop(gore, spec.x + rng.nextFloat(-1.5, 1.5), spec.y + rng.nextFloat(-1.5, 1.5), Math.cos(angle) * speed, Math.sin(angle) * speed - rng.nextFloat(0, 60), rng.nextFloat(0.45, 1.25), rng);
    if (!ok) break;
    spawned += 1;
  }
  const puffs = Math.max(1, Math.round(count * wound.mist * 0.25));
  for (let i = 0; i < puffs; i += 1) {
    const angle = heading + rng.nextFloat(-0.9, 0.9);
    const speed = rng.nextFloat(10, 70);
    spawnMist(gore, spec.x, spec.y, Math.cos(angle) * speed, Math.sin(angle) * speed, rng.nextFloat(1.5, 3.5) * Math.min(2, boost), rng);
  }
  return spawned;
}

function spawnChunk(gore: GoreSystem, shape: ChunkShape, x: number, y: number, vx: number, vy: number, size: number, color: string, accent: string, rng: Rng): boolean {
  const bit = gore.bits.acquire();
  if (bit === null) return false;
  bit.kind = 'chunk';
  bit.shape = shape;
  bit.x = x;
  bit.y = y;
  bit.vx = vx;
  bit.vy = vy;
  bit.maxLife = shape === 'casing' ? rng.nextFloat(6, 10) : rng.nextFloat(28, 45);
  bit.life = bit.maxLife;
  bit.size = size;
  bit.growth = 0;
  bit.rotation = rng.nextFloat(0, TWO_PI);
  bit.spin = rng.nextFloat(-14, 14);
  bit.color = color;
  bit.accent = accent;
  bit.resting = false;
  bit.bounces = shape === 'casing' ? 3 : rng.nextInt(2, 4);
  bit.trail = 0;
  bit.stain = rng.nextInt(0, STAINS.length - 1);
  return true;
}

export interface GibSpec {
  /** The body's centre, world px, and its velocity at the moment it burst. */
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Team colour index: which sheet's colours the pieces wear. */
  readonly colorIndex: number;
  /** 1 for a normal death, more for a super move's finisher. */
  readonly power?: number;
}

/** What a worm bursts into. */
const GIB_RECIPE: readonly { readonly shape: ChunkShape; readonly count: number; readonly size: readonly [number, number] }[] = Object.freeze([
  { shape: 'flesh', count: 8, size: [1.6, 3.2] },
  { shape: 'guts', count: 3, size: [1.5, 2.3] },
  { shape: 'eye', count: 2, size: [1.2, 1.5] },
  { shape: 'bone', count: 3, size: [1.8, 3] },
  { shape: 'bandana', count: 1, size: [2.6, 3.2] },
]);

/** A worm beaten to 0 hp bursts: meat, guts, both eyes, bones, its bandana, and a shower of blood. */
export function gibBurst(gore: GoreSystem, spec: GibSpec, rng: Rng): number {
  if (!gore.enabled) return 0;
  const power = spec.power ?? 1;
  const palette = bodyPalette(spec.colorIndex);
  let chunks = 0;
  for (const part of GIB_RECIPE) {
    for (let i = 0; i < part.count; i += 1) {
      const angle = -Math.PI / 2 + rng.nextFloat(-1.5, 1.5);
      const speed = rng.nextFloat(120, 380) * power;
      const vx = spec.vx * 0.55 + Math.cos(angle) * speed;
      const vy = spec.vy * 0.55 + Math.sin(angle) * speed;
      const size = rng.nextFloat(part.size[0], part.size[1]);
      const colors: readonly [string, string] =
        part.shape === 'flesh' ? [rng.pick([palette.skin, palette.dark, palette.belly]) ?? palette.skin, MEAT]
        : part.shape === 'guts' ? [GUTS, GUTS_DARK]
        : part.shape === 'eye' ? ['#fbfbf6', '#111111']
        : part.shape === 'bone' ? [BONE, '#c9bfa6']
        : [BANDANA_GREEN, '#008a00'];
      if (spawnChunk(gore, part.shape, spec.x + rng.nextFloat(-3, 3), spec.y + rng.nextFloat(-5, 5), vx, vy, size, colors[0], colors[1], rng)) chunks += 1;
    }
  }
  // The blood: a fountain in every direction, heaviest along the way the body was going.
  const heading = Math.hypot(spec.vx, spec.vy) > 1 ? Math.atan2(spec.vy, spec.vx) : -Math.PI / 2;
  for (let i = 0; i < 3; i += 1) {
    const angle = heading + (i - 1) * 1.5;
    bloodBurst(gore, { x: spec.x, y: spec.y, dx: Math.cos(angle), dy: Math.sin(angle), amount: 22 * power, cause: 'blast' }, rng);
  }
  for (let i = 0; i < 6; i += 1) spawnMist(gore, spec.x, spec.y, rng.nextFloat(-60, 60), rng.nextFloat(-80, 10), rng.nextFloat(3, 6) * power, rng);
  return chunks;
}

/** A spent brass casing flipped out of a gun's ejection port, backward and up. */
export function ejectCasing(gore: GoreSystem, x: number, y: number, facing: 1 | -1, rng: Rng): void {
  if (!gore.enabled) return;
  spawnChunk(gore, 'casing', x, y, -facing * rng.nextFloat(40, 110), -rng.nextFloat(90, 170), 0.9, BRASS, '#8a6508', rng);
}

/** One drop from an open wound, for worms low on health. */
export function dripFrom(gore: GoreSystem, x: number, y: number, rng: Rng): void {
  if (!gore.enabled) return;
  spawnDrop(gore, x + rng.nextFloat(-2.5, 2.5), y + rng.nextFloat(-3, 3), rng.nextFloat(-12, 12), rng.nextFloat(-10, 20), rng.nextFloat(0.4, 0.8), rng);
}

/** Blood on the lens: splats anywhere on screen, bigger with intensity (0..1). */
export function splatterLens(gore: GoreSystem, count: number, intensity: number, rng: Rng): void {
  if (!gore.enabled) return;
  for (let i = 0; i < count; i += 1) {
    if (gore.lens.length >= MAX_LENS_SPLATS) gore.lens.shift();
    const maxLife = rng.nextFloat(1.6, 3.2);
    gore.lens.push({
      x: rng.nextFloat(0.08, 0.92),
      y: rng.nextFloat(0.08, 0.8),
      r: rng.nextFloat(18, 42) * (0.6 + clamp(intensity, 0, 1) * 0.8),
      life: maxLife,
      maxLife,
      seed: rng.nextUint32(),
      drip: 0,
    });
  }
}

function queueStain(gore: GoreSystem, batch: number, x: number, y: number, r: number): void {
  const list = gore.pending[batch % gore.pending.length];
  if (list !== undefined) list.push({ x, y, r });
}

/**
 * A droplet splash: a main dot smeared along the way it was going, and flecks thrown ahead of it.
 * Many drops landing together pool into a stain, since every splash lands on the same land.
 */
function splash(gore: GoreSystem, bit: GoreBit, x: number, y: number, speed: number): void {
  const r = bit.size * (1.1 + Math.min(1.6, speed / 220));
  const along = bit.vx >= 0 ? 1 : -1;
  queueStain(gore, bit.stain, x, y, r);
  queueStain(gore, bit.stain, x + along * r * 1.2, y + 0.4, r * 0.7);
  if (speed > 120) {
    const fleck = r * 0.45;
    queueStain(gore, bit.stain, x + along * r * 2.6, y - r * 0.3, fleck);
    queueStain(gore, bit.stain, x - along * r * 1.1, y + r * 0.6, fleck);
  }
}

/** First solid pixel on the way from (x0, y0) to (x1, y1), sampled every 1.5 px, or null. */
function firstSolid(terrain: TerrainData, x0: number, y0: number, x1: number, y1: number): { x: number; y: number; px: number; py: number } | null {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / 1.5));
  let px = x0;
  let py = y0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (isSolid(terrain.mask, x, y)) return { x, y, px, py };
    px = x;
    py = y;
  }
  return null;
}

function stepDrop(gore: GoreSystem, bit: GoreBit, dt: number, terrain: TerrainData | null): boolean {
  const drag = Math.max(0, 1 - 0.35 * dt);
  bit.vx *= drag;
  bit.vy = bit.vy * drag + GORE_GRAVITY * dt;
  const nx = bit.x + bit.vx * dt;
  const ny = bit.y + bit.vy * dt;
  if (terrain !== null) {
    if (ny >= terrain.water.y) return false;
    if (nx < -20 || nx > terrain.width + 20 || ny > terrain.height + 20) return false;
    const hit = firstSolid(terrain, bit.x, bit.y, nx, ny);
    if (hit !== null) {
      splash(gore, bit, hit.x, hit.y, Math.hypot(bit.vx, bit.vy));
      return false;
    }
  }
  bit.x = nx;
  bit.y = ny;
  return true;
}

function stepMist(bit: GoreBit, dt: number): void {
  const drag = Math.max(0, 1 - 2.6 * dt);
  bit.vx *= drag;
  bit.vy = bit.vy * drag - 30 * dt;
  bit.x += bit.vx * dt;
  bit.y += bit.vy * dt;
  bit.size += bit.growth * dt;
}

function bleeds(bit: GoreBit): boolean {
  return bit.shape === 'flesh' || bit.shape === 'guts' || bit.shape === 'eye';
}

/** Land within three pixels under (x, y): something to lie on. */
function supported(terrain: TerrainData, x: number, y: number): boolean {
  return isSolid(terrain.mask, x, y + 1) || isSolid(terrain.mask, x, y + 2) || isSolid(terrain.mask, x, y + 3);
}

function stepChunk(gore: GoreSystem, bit: GoreBit, dt: number, terrain: TerrainData | null, rng: Rng): boolean {
  if (bit.resting) {
    // Resting on the ground: only rot away. The ground may have been blown out from under it.
    if (terrain !== null && !supported(terrain, bit.x, bit.y)) {
      bit.resting = false;
      bit.bounces = 1;
    }
    return true;
  }
  bit.vy += GORE_GRAVITY * 1.1 * dt;
  bit.vx *= Math.max(0, 1 - 0.2 * dt);
  bit.rotation += bit.spin * dt;
  const nx = bit.x + bit.vx * dt;
  const ny = bit.y + bit.vy * dt;
  if (terrain === null) {
    bit.x = nx;
    bit.y = ny;
    return true;
  }
  if (ny >= terrain.water.y + 4) return false;
  if (nx < -30 || nx > terrain.width + 30 || ny > terrain.height + 30) return false;
  const moved = Math.hypot(nx - bit.x, ny - bit.y);
  const hit = firstSolid(terrain, bit.x, bit.y, nx, ny);
  if (hit === null) {
    bit.x = nx;
    bit.y = ny;
    if (bleeds(bit)) {
      bit.trail += moved;
      if (bit.trail > 5) {
        bit.trail = 0;
        spawnDrop(gore, bit.x, bit.y, bit.vx * 0.2 + rng.nextFloat(-15, 15), bit.vy * 0.2, rng.nextFloat(0.35, 0.7), rng);
      }
    }
    return true;
  }
  const speed = Math.hypot(bit.vx, bit.vy);
  if (bit.shape !== 'casing') queueStain(gore, bit.stain, hit.x, hit.y, Math.min(3.5, bit.size * (0.6 + speed / 300)));
  bit.x = hit.px;
  bit.y = hit.py;
  const floor = supported(terrain, bit.x, bit.y);
  const wallRight = isSolid(terrain.mask, bit.x + 1.5, bit.y);
  const wallLeft = isSolid(terrain.mask, bit.x - 1.5, bit.y);
  if (floor || (!wallLeft && !wallRight)) {
    bit.vy = -Math.abs(bit.vy) * 0.34;
    bit.vx *= 0.62;
  } else {
    bit.vx = -bit.vx * 0.4;
    bit.vy *= 0.8;
  }
  bit.spin *= 0.6;
  bit.bounces -= 1;
  if (floor && (bit.bounces <= 0 || speed < 45)) {
    bit.resting = true;
    bit.vx = 0;
    bit.vy = 0;
    bit.spin = 0;
  }
  return true;
}

/** Keeps the ground from turning into a butcher's floor: the oldest resting chunks rot first. */
function capResting(gore: GoreSystem): void {
  let resting = 0;
  gore.bits.forEach((bit) => {
    if (bit.kind === 'chunk' && bit.resting) resting += 1;
  });
  if (resting <= MAX_RESTING_CHUNKS) return;
  let excess = resting - MAX_RESTING_CHUNKS;
  gore.bits.forEach((bit) => {
    if (excess > 0 && bit.kind === 'chunk' && bit.resting && bit.life > 1.5) {
      bit.life = 1.5;
      excess -= 1;
    }
  });
}

function flushStains(gore: GoreSystem, terrain: TerrainData | null): void {
  gore.pending.forEach((dots, index) => {
    if (dots.length === 0) return;
    if (terrain !== null) gore.stains += paintDots(terrain.tiles, dots, STAINS[index] ?? STAINS[0] ?? '#700');
    dots.length = 0;
  });
}

/** One step: flight, the land and the water, stains painted in batches, the lens drying up. */
export function updateGore(gore: GoreSystem, dt: number, terrain: TerrainData | null, rng: Rng): void {
  const step = Math.max(0, dt);
  gore.bits.sweep((bit) => {
    bit.life -= step;
    if (bit.life <= 0) return true;
    switch (bit.kind) {
      case 'drop':
        return !stepDrop(gore, bit, step, terrain);
      case 'mist':
        stepMist(bit, step);
        return false;
      case 'chunk':
        return !stepChunk(gore, bit, step, terrain, rng);
    }
  });
  capResting(gore);
  flushStains(gore, terrain);
  for (let i = gore.lens.length - 1; i >= 0; i -= 1) {
    const splat = gore.lens[i];
    if (splat === undefined) continue;
    splat.life -= step;
    splat.drip = Math.min(splat.r * 2.6, splat.drip + step * (8 + splat.r * 0.5));
    if (splat.life <= 0) gore.lens.splice(i, 1);
  }
}

function drawChunk(ctx: Ctx2D, bit: GoreBit, sx: number, sy: number, z: number): void {
  const s = Math.max(0.8, bit.size * z);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(bit.rotation);
  switch (bit.shape) {
    case 'flesh':
      ctx.fillStyle = bit.color;
      ctx.beginPath();
      ctx.moveTo(-s, -0.3 * s);
      ctx.lineTo(-0.25 * s, -0.85 * s);
      ctx.lineTo(0.85 * s, -0.5 * s);
      ctx.lineTo(s, 0.35 * s);
      ctx.lineTo(0.15 * s, 0.9 * s);
      ctx.lineTo(-0.8 * s, 0.6 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = bit.accent;
      ctx.beginPath();
      ctx.arc(0.1 * s, 0.1 * s, 0.5 * s, 0, TWO_PI);
      ctx.fill();
      break;
    case 'guts':
      ctx.fillStyle = bit.color;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.arc((i - 1.5) * s * 0.75, Math.sin(i * 1.9) * s * 0.35, s * 0.46, 0, TWO_PI);
        ctx.fill();
      }
      ctx.fillStyle = bit.accent;
      ctx.beginPath();
      ctx.arc(-0.4 * s, 0.1 * s, s * 0.22, 0, TWO_PI);
      ctx.fill();
      break;
    case 'eye':
      // The optic nerve trails behind the eyeball.
      ctx.strokeStyle = MEAT;
      ctx.lineWidth = Math.max(1, s * 0.3);
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(-s * 2, s * 0.5);
      ctx.stroke();
      ctx.fillStyle = bit.color;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = bit.accent;
      ctx.beginPath();
      ctx.arc(s * 0.4, 0, s * 0.45, 0, TWO_PI);
      ctx.fill();
      break;
    case 'bone':
      ctx.fillStyle = bit.color;
      ctx.fillRect(-s, -0.22 * s, 2 * s, 0.44 * s);
      ctx.beginPath();
      ctx.arc(-s, -0.2 * s, 0.32 * s, 0, TWO_PI);
      ctx.arc(-s, 0.2 * s, 0.32 * s, 0, TWO_PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s, -0.2 * s, 0.32 * s, 0, TWO_PI);
      ctx.arc(s, 0.2 * s, 0.32 * s, 0, TWO_PI);
      ctx.fill();
      break;
    case 'bandana':
      ctx.fillStyle = bit.color;
      ctx.fillRect(-s, -0.32 * s, 2 * s, 0.64 * s);
      ctx.fillStyle = bit.accent;
      ctx.fillRect(-s, 0.1 * s, 2 * s, 0.22 * s);
      ctx.fillStyle = MEAT;
      ctx.fillRect(0.3 * s, -0.32 * s, 0.35 * s, 0.35 * s);
      break;
    case 'casing':
      ctx.fillStyle = bit.color;
      ctx.fillRect(-0.9 * s, -0.4 * s, 1.8 * s, 0.8 * s);
      ctx.fillStyle = bit.accent;
      ctx.fillRect(-0.9 * s, -0.4 * s, 0.4 * s, 0.8 * s);
      break;
  }
  ctx.restore();
}

/**
 * World space: mist, then droplets, then chunks, through the camera like the particles. On the
 * super move's white screen (whiteout above one half) only what is flying shows: the fresh blood
 * of the beating, red on white, not the old pieces lying about.
 */
export function drawGore(ctx: Ctx2D, gore: GoreSystem, camera: Camera, viewport: Size, whiteout = 0): void {
  if (gore.bits.activeCount() === 0) return;
  const z = camera.zoom;
  const shake = shakeOffset(camera.shake);
  const ox = viewport.w / 2 - (camera.x + shake.x) * z;
  const oy = viewport.h / 2 - (camera.y + shake.y) * z;
  ctx.save();
  gore.bits.forEach((bit) => {
    if (bit.kind !== 'mist') return;
    ctx.globalAlpha = 0.42 * clamp(bit.life / bit.maxLife, 0, 1);
    ctx.fillStyle = bit.color;
    ctx.beginPath();
    ctx.arc(bit.x * z + ox, bit.y * z + oy, Math.max(0.5, bit.size * z), 0, TWO_PI);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  gore.bits.forEach((bit) => {
    if (bit.kind !== 'drop') return;
    const half = Math.max(0.6, bit.size * z);
    const sx = bit.x * z + ox;
    const sy = bit.y * z + oy;
    ctx.fillStyle = bit.color;
    ctx.fillRect(sx - half, sy - half, half * 2, half * 2);
    // A fast drop smears into a streak behind it.
    const speed = Math.hypot(bit.vx, bit.vy);
    if (speed > 120) {
      const k = Math.min(0.02, 5 / speed);
      ctx.fillRect(sx - bit.vx * k * z - half * 0.7, sy - bit.vy * k * z - half * 0.7, half * 1.4, half * 1.4);
    }
  });
  gore.bits.forEach((bit) => {
    if (bit.kind !== 'chunk' || (bit.resting && whiteout > 0.5)) return;
    ctx.globalAlpha = bit.resting ? clamp(bit.life / 1.5, 0, 1) : 1;
    drawChunk(ctx, bit, bit.x * z + ox, bit.y * z + oy, z);
  });
  ctx.restore();
}

/** Deterministic 0..1 from a seed and an index, so a splat keeps its shape while it fades. */
function hash01(seed: number, index: number): number {
  let h = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Screen space: blood on the camera lens, with drips running down. */
export function drawLens(ctx: Ctx2D, gore: GoreSystem, viewport: Size): void {
  if (gore.lens.length === 0) return;
  ctx.save();
  for (const splat of gore.lens) {
    const fade = clamp(splat.life / splat.maxLife, 0, 1);
    const cx = splat.x * viewport.w;
    const cy = splat.y * viewport.h;
    const r = splat.r;
    ctx.globalAlpha = 0.66 * Math.sqrt(fade);
    ctx.fillStyle = '#6a0008';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, TWO_PI);
    ctx.fill();
    for (let i = 0; i < 7; i += 1) {
      const a = hash01(splat.seed, i) * TWO_PI;
      const d = r * (0.45 + hash01(splat.seed, i + 20) * 0.7);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.14 + hash01(splat.seed, i + 40) * 0.3), 0, TWO_PI);
      ctx.fill();
    }
    for (let i = 0; i < 9; i += 1) {
      const a = hash01(splat.seed, i + 60) * TWO_PI;
      const d = r * (1.2 + hash01(splat.seed, i + 80) * 1.1);
      ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + hash01(splat.seed, i + 90) * 3, 2 + hash01(splat.seed, i + 95) * 3);
    }
    // Drips: two or three runs down the glass from the bottom of the blob.
    const drips = 2 + Math.floor(hash01(splat.seed, 100) * 2);
    for (let i = 0; i < drips; i += 1) {
      const dx = (hash01(splat.seed, 110 + i) - 0.5) * r;
      const w = r * (0.1 + hash01(splat.seed, 120 + i) * 0.1);
      const run = splat.drip * (0.5 + hash01(splat.seed, 130 + i) * 0.5);
      ctx.fillRect(cx + dx - w / 2, cy + r * 0.3, w, run);
      ctx.beginPath();
      ctx.arc(cx + dx, cy + r * 0.3 + run, w * 0.75, 0, TWO_PI);
      ctx.fill();
    }
    ctx.fillStyle = '#3c0004';
    ctx.globalAlpha = 0.5 * fade;
    ctx.beginPath();
    ctx.arc(cx - r * 0.1, cy - r * 0.08, r * 0.34, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}
