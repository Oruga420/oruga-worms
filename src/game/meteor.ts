/**
 * Fujitora's meteor's look (Issho, One Piece): the worm raises its sword at the sky, a purple swirl
 * of gravity tightening over the spot it called, and a target ring on it; then the meteor coming
 * down out of the top of the world, a cratered rock in a burning corona, its trail of fire and smoke
 * streaming up behind it.
 *
 * Two halves: timing helpers on the meteor's stage (unit tested) and screen space drawers the
 * renderer places (render.ts).
 */

import { TWO_PI } from '../core/math.ts';
import { hash01 } from '../core/rng.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import type { MeteorBody } from '../sim/types.ts';
import { disc, ease, glow, glowLine, ring } from './light.ts';

export const GRAVITY_PURPLE = '#7a3cff';
const ROCK = '#5a4636';
const ROCK_DARK = '#33261c';
const ROCK_LIT = '#8a6a4e';
const CORONA = '#ff8a2a';
const CORONA_HOT = '#ffe08a';
const BLADE = '#e8eef5';

/** 0..1: the swirl of gravity over the spot: tightening through the call, held while the rock falls. */
export function gravityPull(body: MeteorBody): number {
  if (body.stage === 'call') return ease(techniqueProgress(body) / 0.7);
  if (body.stage === 'fall') return 1;
  return 1 - ease(techniqueProgress(body) / 0.3);
}

/** How high the sword is raised, 0..1. */
export function swordUp(body: MeteorBody): number {
  if (body.stage === 'call') return ease(techniqueProgress(body) / 0.4);
  if (body.stage === 'fall') return 1;
  return 1 - ease(techniqueProgress(body) / 0.5);
}

/** The swirl of gravity and the target ring over the spot (x, y), screen space. */
export function drawGravityWell(ctx: Ctx2D, x: number, y: number, z: number, pull: number, timeMs: number): void {
  if (pull <= 0.01) return;
  const r = 34 * z;
  glow(ctx, x, y, r * 1.3, GRAVITY_PURPLE, pull * 0.6);
  ctx.save();
  ctx.lineWidth = Math.max(1, 0.7 * z);
  for (let k = 0; k < 3; k += 1) {
    const t = ((timeMs / 900 + k / 3) % 1);
    ctx.globalAlpha = pull * (1 - t) * 0.8;
    ctx.strokeStyle = k % 2 === 0 ? GRAVITY_PURPLE : '#d7c4ff';
    ring(ctx, x, y, r * (1 - t) + 2 * z);
  }
  ctx.globalAlpha = pull;
  ctx.strokeStyle = '#ff3a3a';
  ctx.lineWidth = Math.max(1.5, 0.9 * z);
  const pr = (9 + Math.sin(timeMs / 120) * 1.2) * z;
  ring(ctx, x, y, pr);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TWO_PI + timeMs / 1500;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * pr * 0.55, y + Math.sin(a) * pr * 0.55);
    ctx.lineTo(x + Math.cos(a) * pr * 1.5, y + Math.sin(a) * pr * 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

/** The sword held up from the hand at (x, y), screen space: a straight blade raised as far as `up`. */
export function drawRaisedSword(ctx: Ctx2D, x: number, y: number, z: number, facing: 1 | -1, up: number): void {
  if (up <= 0.01) return;
  const a = -Math.PI / 2 + facing * (1 - up) * 0.9;
  const len = 15 * z;
  glowLine(ctx, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.1 * z, '#b8d4ff', BLADE, up);
  ctx.save();
  ctx.fillStyle = '#3a2a1e';
  disc(ctx, x, y, 1.3 * z);
  ctx.restore();
}

/**
 * The meteor at (x, y), screen space, falling along (dx, dy): the trail of fire and smoke streaming
 * back up its path, the corona, and the cratered rock. r is its radius on screen.
 */
export function drawMeteor(ctx: Ctx2D, x: number, y: number, dx: number, dy: number, r: number, timeMs: number, seed: number): void {
  // The trail: discs back along the path, hot near the rock, smoke farther up.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i <= 14; i += 1) {
    const back = i * r * 0.55;
    const wobble = Math.sin(timeMs / 50 + i) * r * 0.12;
    ctx.globalAlpha = 0.5 * (1 - i / 15);
    ctx.fillStyle = i < 5 ? CORONA_HOT : CORONA;
    disc(ctx, x - dx * back - dy * wobble, y - dy * back + dx * wobble, r * (1.05 - i * 0.045));
  }
  ctx.restore();
  ctx.save();
  for (let i = 6; i <= 16; i += 1) {
    const back = i * r * 0.7;
    ctx.globalAlpha = 0.18 * (1 - i / 17);
    ctx.fillStyle = '#4a4440';
    disc(ctx, x - dx * back + Math.sin(i * 1.7) * r * 0.4, y - dy * back, r * (0.6 + i * 0.06));
  }
  ctx.restore();
  glow(ctx, x, y, r * 2.4, CORONA, 1);
  ctx.save();
  ctx.fillStyle = ROCK_DARK;
  disc(ctx, x, y, r);
  ctx.fillStyle = ROCK;
  disc(ctx, x - r * 0.12, y - r * 0.12, r * 0.86);
  ctx.fillStyle = ROCK_LIT;
  disc(ctx, x + dx * r * 0.35, y + dy * r * 0.35, r * 0.45);
  ctx.fillStyle = ROCK_DARK;
  for (let i = 0; i < 5; i += 1) {
    const a = hash01(seed, i) * TWO_PI;
    const d = r * 0.55 * hash01(seed, i + 7);
    disc(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.1 + hash01(seed, i + 13) * 0.12));
  }
  // The leading edge white hot.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = CORONA_HOT;
  disc(ctx, x + dx * r * 0.6, y + dy * r * 0.6, r * 0.5);
  ctx.restore();
}
