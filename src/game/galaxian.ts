/**
 * The Galaxian Explosion's look (Saga of Gemini): the night falls round the worm as it crosses its
 * arms overhead, and the cosmos opens behind it: a spiral galaxy turning and growing, stars all
 * round and planets swinging by. Then the galaxy it hurls, turning fast and shedding stardust as it
 * flies, and where it goes off, galaxies bursting: rings of starlight racing out and planets flung
 * every way.
 *
 * Two halves: timing helpers on the galaxy's stage (unit tested) and screen space drawers the
 * renderer places (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { hash01 } from '../core/rng.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import type { GalaxyBody } from '../sim/types.ts';
import { disc, ease, glint, glow } from './light.ts';

export const COSMOS_VIOLET = '#9b5cff';
export const COSMOS_PINK = '#ff7ad9';
export const COSMOS_BLUE = '#5ab8ff';
const STAR = '#fdf7ff';

/** 0..1: how much of the cosmos has opened behind the worm: through the charge, and gone soon after the throw. */
export function cosmosOpen(body: GalaxyBody): number {
  if (body.stage === 'charge') return ease(techniqueProgress(body) / 0.8);
  if (body.stage === 'fly') return 1 - ease(techniqueProgress(body) * 4);
  return 0;
}

/** 0..1 through the burst's bloom, the first part of the recovery; null before the burst and after the bloom. */
export function burstBloom(body: GalaxyBody): number | null {
  if (body.stage !== 'recover' || body.burstX === null) return null;
  const t = techniqueProgress(body) / 0.7;
  return t >= 1 ? null : t;
}

/** A spiral galaxy at (x, y), screen space: a white core, three arms of stars in violet, pink and blue. */
export function drawGalaxy(ctx: Ctx2D, x: number, y: number, r: number, rotation: number, alpha: number): void {
  if (alpha <= 0.01 || r <= 0.5) return;
  glow(ctx, x, y, r * 1.25, COSMOS_VIOLET, alpha * 0.8);
  glow(ctx, x, y, r * 0.5, COSMOS_PINK, alpha);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const colors = [COSMOS_VIOLET, COSMOS_PINK, COSMOS_BLUE] as const;
  for (let arm = 0; arm < 3; arm += 1) {
    for (let i = 1; i <= 16; i += 1) {
      const t = i / 16;
      const a = rotation + (arm * TWO_PI) / 3 + t * 3.4;
      const d = r * t;
      ctx.globalAlpha = alpha * (1 - t * 0.7);
      ctx.fillStyle = i % 4 === 0 ? STAR : colors[arm] ?? COSMOS_VIOLET;
      disc(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.62, Math.max(0.5, r * 0.09 * (1.2 - t)));
    }
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = STAR;
  disc(ctx, x, y, r * 0.16);
  glint(ctx, x, y, r * 0.55, rotation * 0.5, 4);
  ctx.restore();
}

/** A planet: a shaded ball, with a ring when `ringed`. */
export function drawPlanet(ctx: Ctx2D, x: number, y: number, r: number, color: string, shade: string, ringed: boolean, alpha: number): void {
  if (alpha <= 0.01 || r <= 0.3) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = shade;
  disc(ctx, x, y, r);
  ctx.fillStyle = color;
  disc(ctx, x - r * 0.25, y - r * 0.25, r * 0.75);
  if (ringed) {
    ctx.strokeStyle = '#f2e3b3';
    ctx.lineWidth = Math.max(0.6, r * 0.25);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.scale(1, 0.32);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, TWO_PI);
    ctx.restore();
    ctx.stroke();
  }
  ctx.restore();
}

const PLANETS = Object.freeze([
  { color: '#ffb35c', shade: '#a8531c', ringed: true, orbit: 1.2, speed: 0.0011, size: 0.11 },
  { color: '#7fe3d6', shade: '#1f7f86', ringed: false, orbit: 0.85, speed: -0.0016, size: 0.08 },
  { color: '#ff7a7a', shade: '#8f2430', ringed: false, orbit: 1.45, speed: 0.0008, size: 0.06 },
] as const);

/**
 * The cosmos behind a worm whose middle is at (x, y) on screen, open as far as `open`: a field of
 * stars round it, the big galaxy turning over its head and behind it, and planets on their orbits.
 * z is the world zoom; seed keeps the stars where they are.
 */
export function drawCosmos(ctx: Ctx2D, x: number, y: number, z: number, open: number, facing: 1 | -1, seed: number, timeMs: number): void {
  if (open <= 0.01) return;
  const reach = 70 * z * (0.4 + 0.6 * open);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i += 1) {
    const a = hash01(seed, i) * TWO_PI;
    const d = reach * Math.sqrt(hash01(seed, i + 100));
    const twinkle = 0.5 + 0.5 * Math.sin(timeMs / (90 + hash01(seed, i + 200) * 120) + i);
    ctx.globalAlpha = open * twinkle * 0.9;
    ctx.fillStyle = i % 5 === 0 ? COSMOS_PINK : i % 3 === 0 ? COSMOS_BLUE : STAR;
    disc(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.75, Math.max(0.5, (0.3 + hash01(seed, i + 300) * 0.5) * z));
  }
  ctx.restore();
  const gx = x - facing * 10 * z;
  const gy = y - 24 * z;
  drawGalaxy(ctx, gx, gy, 30 * z * (0.3 + 0.7 * open), timeMs / 700, open);
  for (const [i, planet] of PLANETS.entries()) {
    const a = timeMs * planet.speed + i * 2.1;
    const d = 34 * z * planet.orbit * (0.5 + 0.5 * open);
    drawPlanet(ctx, gx + Math.cos(a) * d, gy + Math.sin(a) * d * 0.45, 30 * z * planet.size, planet.color, planet.shade, planet.ringed, open);
  }
}

/** The galaxy in flight at (x, y), screen space. */
export function drawThrownGalaxy(ctx: Ctx2D, x: number, y: number, z: number, timeMs: number): void {
  drawGalaxy(ctx, x, y, 11 * z, timeMs / 90, 1);
}

/**
 * Galaxies bursting at (x, y), screen space, t 0..1 through the bloom: rings of starlight racing
 * out, a flash at the heart, and planets flung every way and shrinking. r is the kill radius on screen.
 */
export function drawGalaxyBurst(ctx: Ctx2D, x: number, y: number, r: number, t: number, seed: number): void {
  const fade = 1 - t;
  glow(ctx, x, y, r * (0.6 + t * 1.2), COSMOS_VIOLET, fade);
  glow(ctx, x, y, r * 0.5 * (1 - t * 0.5), STAR, fade * 0.9);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const colors = [COSMOS_PINK, COSMOS_BLUE, COSMOS_VIOLET, STAR] as const;
  colors.forEach((color, i) => {
    ctx.globalAlpha = fade * 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, r * 0.08 * fade);
    ctx.beginPath();
    ctx.arc(x, y, r * clamp(t * (1.6 + i * 0.35), 0, 3), 0, TWO_PI);
    ctx.stroke();
  });
  ctx.restore();
  for (let i = 0; i < 8; i += 1) {
    const a = hash01(seed, i) * TWO_PI;
    const d = r * (0.3 + t * (1.4 + hash01(seed, i + 9) * 1.2));
    const planet = PLANETS[i % PLANETS.length] ?? PLANETS[0];
    drawPlanet(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.09 * (1 - t * 0.6), planet.color, planet.shade, i % 3 === 0, fade);
  }
}
