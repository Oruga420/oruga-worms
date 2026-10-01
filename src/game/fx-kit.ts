/**
 * The small tools every effect in the game is made of (fx.ts, technique-fx.ts): a puff of smoke, a
 * spark, a word written into the world (CHOMP!, KEKEKE!), outlined text and a star. Presentation
 * only; they mutate the particles and the effect lists they are handed.
 */

import { TWO_PI } from '../core/math.ts';
import type { Rng } from '../core/rng.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { alphaCurve, type Particle } from '../engine/particles.ts';

/** A sound effect written into the world, comic style: CHOMP!, GULP!, BURP!, HAHAHA! */
export interface Pop {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly bornAt: number;
  /** Letter height in screen px at the default zoom. */
  readonly size: number;
  readonly fill: string;
  readonly outline: string;
  /** Radians. */
  readonly tilt: number;
  /** How long it stays up, ms; POP_MS when absent. */
  readonly ms?: number;
}


/** Anything that keeps words in the world on a clock: FxState. */
export interface PopSink {
  readonly now: number;
  readonly pops: Pop[];
}

export function initPuff(p: Particle, x: number, y: number, rng: Rng, size: number, color: string, rise: number): void {
  p.kind = 'smoke';
  p.x = x;
  p.y = y;
  p.vx = rng.nextFloat(-10, 10);
  p.vy = rng.nextFloat(-rise, -rise * 0.2);
  p.maxLife = rng.nextFloat(0.45, 0.9);
  p.life = p.maxLife;
  p.size = size * rng.nextFloat(0.7, 1.2);
  p.growth = p.size * 1.3;
  p.rotation = 0;
  p.spin = 0;
  p.alpha = alphaCurve('smoke', 1);
  p.gravityScale = -0.12;
  p.drag = 1.6;
  p.color = color;
}

export function initSpark(p: Particle, x: number, y: number, vx: number, vy: number, rng: Rng, color: string, life: number): void {
  p.kind = 'spark';
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.maxLife = life * rng.nextFloat(0.6, 1.2);
  p.life = p.maxLife;
  p.size = rng.nextFloat(0.5, 1.1);
  p.growth = 0;
  p.rotation = 0;
  p.spin = 0;
  p.alpha = 1;
  p.gravityScale = 0.3;
  p.drag = 2;
  p.color = color;
}

export function pop(fx: PopSink, text: string, x: number, y: number, size: number, fill: string, outline: string, tilt: number, ms?: number): void {
  fx.pops.push(ms === undefined ? { text, x, y, bornAt: fx.now, size, fill, outline, tilt } : { text, x, y, bornAt: fx.now, size, fill, outline, tilt, ms });
}

export function drawStar(ctx: Ctx2D, x: number, y: number, outer: number, inner: number, points: number, rotation: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i / (points * 2)) * TWO_PI;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

export function outlinedText(ctx: Ctx2D, text: string, x: number, y: number, fill: string, outline: string, offset: number): void {
  ctx.fillStyle = outline;
  for (const [dx, dy] of [[-offset, 0], [offset, 0], [0, -offset], [0, offset], [offset, offset]] as const) ctx.fillText(text, x + dx, y + dy);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

