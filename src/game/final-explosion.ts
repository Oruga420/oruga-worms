/**
 * The Explosión Final's look (Majin Vegeta's last stand): the worm digs in while a golden aura
 * climbs round it, brighter and wilder as the charge goes on, lightning crackling through it near
 * the end; then the burst: a sphere of white gold swelling out past the kill radius, rings of light
 * racing off it and rays through them, under the flash that whites the screen out (cinematic.ts).
 *
 * Two halves: timing helpers on the explosion's stage (unit tested) and screen space drawers the
 * renderer places (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import type { FinalBody } from '../sim/types.ts';
import { disc, ease, glow, ring } from './light.ts';

export const MAJIN_GOLD = '#ffd23f';
export const MAJIN_WHITE = '#fff8d6';
export const MAJIN_LIGHTNING = '#9fd8ff';

/** A steady 0..1 for a seed and an index, so the bolts and rays do not dance every frame. */
function hash01(seed: number, i: number): number {
  const n = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** 0..1 through the charge: the aura's height and fury. */
export function auraCharge(body: FinalBody): number {
  if (body.stage !== 'charge') return 0;
  return ease(techniqueProgress(body));
}

/** 0..1 through the burst's bloom, the first part of the recovery; null before the burst and after the bloom. */
export function finalBloom(body: FinalBody): number | null {
  if (body.stage !== 'recover' || body.burstX === null) return null;
  const t = techniqueProgress(body) / 0.75;
  return t >= 1 ? null : t;
}

/** The aura round a worm standing at (x, y), screen space: tongues of golden light and, late, lightning. */
export function drawMajinAura(ctx: Ctx2D, x: number, y: number, z: number, charge: number, seed: number, timeMs: number): void {
  if (charge <= 0.01) return;
  const h = (26 + 30 * charge) * z;
  const w = (12 + 14 * charge) * z;
  glow(ctx, x, y - h * 0.45, h * 0.9, MAJIN_GOLD, 0.35 + 0.45 * charge);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const tongues = 7;
  for (let i = 0; i < tongues; i += 1) {
    const k = i / (tongues - 1);
    const bx = x + (k - 0.5) * 2 * w;
    const flick = Math.sin(timeMs / 70 + i * 1.7) * 0.5 + 0.5;
    const th = h * (0.6 + 0.4 * (1 - Math.abs(k - 0.5) * 2)) * (0.75 + 0.25 * flick);
    ctx.globalAlpha = (0.25 + 0.45 * charge) * (0.7 + 0.3 * flick);
    ctx.fillStyle = i % 2 === 0 ? MAJIN_GOLD : MAJIN_WHITE;
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.22, y);
    ctx.lineTo(bx + Math.sin(timeMs / 90 + i) * w * 0.15, y - th);
    ctx.lineTo(bx + w * 0.22, y);
    ctx.closePath();
    ctx.fill();
  }
  // Lightning as the charge nears its end: a few bolts, redrawn every few frames.
  const bolts = Math.floor(charge * 5);
  ctx.strokeStyle = MAJIN_LIGHTNING;
  ctx.lineWidth = Math.max(1, 1.2 * z);
  for (let b = 0; b < bolts; b += 1) {
    const phase = Math.floor(timeMs / 60) + b * 7;
    ctx.globalAlpha = 0.5 + 0.5 * hash01(seed + phase, b);
    const a = hash01(seed + phase, b + 3) * TWO_PI;
    let px = x + Math.cos(a) * w * 0.4;
    let py = y - h * 0.5 + Math.sin(a) * h * 0.3;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let s = 0; s < 4; s += 1) {
      px += (hash01(seed + phase, b * 10 + s) - 0.5) * w * 1.2;
      py += (hash01(seed + phase, b * 10 + s + 5) - 0.5) * h * 0.6;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The burst at (x, y), screen space, r the kill radius, t 0..1 through the bloom: the sphere, the rings and the rays. */
export function drawFinalBurst(ctx: Ctx2D, x: number, y: number, r: number, t: number, seed: number): void {
  const fade = 1 - t;
  const sphere = r * (0.3 + 1.3 * ease(Math.min(1, t * 1.6)));
  glow(ctx, x, y, sphere * 1.5, MAJIN_GOLD, fade * 0.9);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = MAJIN_WHITE;
  disc(ctx, x, y, sphere * 0.8);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = fade * 0.8;
    ctx.strokeStyle = i === 1 ? MAJIN_WHITE : MAJIN_GOLD;
    ctx.lineWidth = Math.max(1, r * 0.07 * fade);
    ring(ctx, x, y, r * clamp(t * (1.8 + i * 0.5), 0, 3.5));
  }
  const rays = 14;
  for (let i = 0; i < rays; i += 1) {
    const a = (i / rays) * TWO_PI + hash01(seed, i) * 0.3;
    const len = r * (0.8 + 1.6 * t) * (0.7 + 0.6 * hash01(seed, i + 20));
    ctx.globalAlpha = fade * 0.7;
    ctx.strokeStyle = i % 2 === 0 ? MAJIN_GOLD : MAJIN_WHITE;
    ctx.lineWidth = Math.max(1, r * 0.05 * fade);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * sphere * 0.5, y + Math.sin(a) * sphere * 0.5);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}
