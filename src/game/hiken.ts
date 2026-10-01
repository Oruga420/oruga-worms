/**
 * The Hiken's look (Portgas D. Ace's Fire Fist): the worm draws its fist back and its arm catches
 * fire, flames licking up off it brighter and brighter; then the fist of fire it throws, as big as a
 * house next to a worm, knuckles first, its flames streaming back behind it as it flies.
 *
 * Two halves: timing helpers on the fist's stage (unit tested) and screen space drawers the renderer
 * places (render.ts).
 */

import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import type { HikenBody } from '../sim/types.ts';
import { disc, ease, glow, oval, quadTo } from './light.ts';

export const FIRE_RED = '#e0260f';
export const FIRE_ORANGE = '#ff7a1a';
export const FIRE_YELLOW = '#ffd23f';
const FIRE_WHITE = '#fff6d6';

/** 0..1: how hard the arm burns: catching through the windup, roaring as it throws, out in the recovery. */
export function armFire(body: HikenBody): number {
  if (body.stage === 'windup') return ease(techniqueProgress(body) / 0.7);
  if (body.stage === 'fly') return 1 - ease(techniqueProgress(body) * 3);
  return 0;
}

/** How far the fist is drawn back over the windup, 0..1. */
export function drawBack(body: HikenBody): number {
  return body.stage === 'windup' ? ease(techniqueProgress(body) / 0.6) : 0;
}

/** Flame tongues off (x, y), screen space, streaming toward `angle`, as long as len and as wide as w. */
function tongues(ctx: Ctx2D, x: number, y: number, angle: number, len: number, w: number, count: number, timeMs: number, seed: number): void {
  const colors = [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW] as const;
  for (let i = 0; i < count; i += 1) {
    const flicker = 0.65 + 0.35 * Math.abs(Math.sin(timeMs / (38 + (i % 3) * 9) + i * 1.9 + seed));
    const a = angle + (i / Math.max(1, count - 1) - 0.5) * 1.1;
    const l = len * flicker * (0.6 + 0.4 * ((i * 7) % 5) / 4);
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    ctx.fillStyle = colors[i % colors.length] ?? FIRE_ORANGE;
    ctx.globalAlpha = 0.85;
    const tipX = x + Math.cos(a) * l;
    const tipY = y + Math.sin(a) * l;
    ctx.beginPath();
    ctx.moveTo(x + nx * w, y + ny * w);
    quadTo(ctx, x + nx * w, y + ny * w, x + Math.cos(a) * l * 0.5 + nx * w * 0.8, y + Math.sin(a) * l * 0.5 + ny * w * 0.8, tipX, tipY, 4);
    quadTo(ctx, tipX, tipY, x + Math.cos(a) * l * 0.5 - nx * w * 0.8, y + Math.sin(a) * l * 0.5 - ny * w * 0.8, x - nx * w, y - ny * w, 4);
    ctx.closePath();
    ctx.fill();
  }
}

/** The burning fist on the worm's arm at (x, y), screen space, as hot as `heat`. */
export function drawBurningHand(ctx: Ctx2D, x: number, y: number, z: number, heat: number, timeMs: number): void {
  if (heat <= 0.01) return;
  glow(ctx, x, y, 12 * z * heat, FIRE_ORANGE, heat);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  tongues(ctx, x, y, -Math.PI / 2, 9 * z * heat, 1.6 * z, 6, timeMs, 1);
  ctx.globalAlpha = heat;
  ctx.fillStyle = FIRE_WHITE;
  disc(ctx, x, y, 1.6 * z * heat);
  ctx.restore();
}

/**
 * The fist of fire at (x, y), screen space, flying along `angle`: a red hot fist, knuckles first, in a
 * glow, its flames streaming back behind it. r is its radius on screen.
 */
export function drawFireFist(ctx: Ctx2D, x: number, y: number, angle: number, r: number, timeMs: number): void {
  glow(ctx, x, y, r * 3, FIRE_ORANGE, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  tongues(ctx, x - Math.cos(angle) * r * 0.3, y - Math.sin(angle) * r * 0.3, angle + Math.PI, r * 3.2, r * 0.7, 9, timeMs, 3);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // The fist: a rounded block, four knuckles on its leading edge, a thumb along the top.
  ctx.fillStyle = FIRE_RED;
  ctx.beginPath();
  ctx.arc(-r * 0.15, 0, r * 0.95, Math.PI * 0.5, Math.PI * 1.5);
  ctx.lineTo(r * 0.55, -r * 0.95);
  ctx.lineTo(r * 0.55, r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = FIRE_ORANGE;
  for (let k = 0; k < 4; k += 1) disc(ctx, r * 0.6, -r * 0.72 + k * r * 0.48, r * 0.3);
  ctx.fillStyle = FIRE_YELLOW;
  oval(ctx, r * 0.05, -r * 0.62, r * 0.45, r * 0.2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = FIRE_WHITE;
  ctx.globalAlpha = 0.85;
  disc(ctx, r * 0.15, 0, r * 0.45);
  ctx.restore();
}
