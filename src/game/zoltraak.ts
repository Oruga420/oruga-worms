/**
 * Zoltraak's look (Frieren's offensive magic): a staff in the mage's hand, then magic circles opening
 * round it one by one, each a turning wheel of light: two rings, a star in the middle and runes round
 * the rim, opening with a flash; then each circle fires in turn, a beam of white light with a pale
 * blue glow from the circle to where it ends, and goes dim after.
 *
 * Two halves: timing helpers on the circles (unit tested) and screen space drawers the renderer
 * places (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import { ticksFor } from '../sim/techniques/common.ts';
import { circleTicks } from '../sim/techniques/zoltraak.ts';
import type { ZoltraakBody } from '../sim/types.ts';
import { disc, ease, glow, glowLine, ring } from './light.ts';

export const MAGIC_WHITE = '#f4fbff';
export const MAGIC_BLUE = '#8fd8ff';
const MAGIC_DEEP = '#3a7bd5';
const STAFF = '#6b4a2b';
const GEM = '#e8304a';

/** How a circle k (0 based) is: how far it has opened, 0..1, and how bright (it flashes as it opens, flares as it fires, dims after). */
export function circleLook(body: ZoltraakBody, k: number): { readonly open: number; readonly bright: number } {
  const opens = circleTicks(body.spec, body.circles.length)[k];
  if (opens === undefined) return { open: 0, bright: 0 };
  if (body.stage === 'form') {
    const since = body.stageTicks - opens;
    if (since < 0) return { open: 0, bright: 0 };
    return { open: ease(since / 10), bright: 0.6 + 0.4 * Math.exp(-since / 6) };
  }
  if (body.stage === 'fire') {
    const fired = body.ends.length > k;
    const since = fired ? body.stageTicks - (1 + k * ticksFor(body.spec.fireIntervalMs)) : Infinity;
    return { open: 1, bright: fired ? 0.45 + 0.55 * Math.exp(-since / 5) : 0.65 };
  }
  // Recovery: the circles close.
  const t = ease(techniqueProgress(body) / 0.6);
  return { open: 1 - t, bright: 0.45 * (1 - t) };
}

/** Beam k's light, 0..1: full the tick it fires, gone a few ticks later. */
export function beamLight(body: ZoltraakBody, k: number): number {
  if (body.ends.length <= k) return 0;
  const every = ticksFor(body.spec.fireIntervalMs);
  const since = body.stage === 'fire' ? body.stageTicks - (1 + k * every) : body.stage === 'recover' ? body.stageTicks + (body.ends.length - 1 - k) * every + every : Infinity;
  return clamp(1 - since / 12, 0, 1);
}

/** 0..1: the staff out, through the casting, gone in the recovery. */
export function staffOut(body: ZoltraakBody): number {
  if (body.stage === 'recover') return 1 - ease(techniqueProgress(body) / 0.6);
  return 1;
}

/**
 * A magic circle at (x, y), screen space, radius r, opened as far as `open`, as bright as `bright`:
 * an outer ring with runes on its rim, an inner ring, and a six pointed star, turning.
 */
export function drawMagicCircle(ctx: Ctx2D, x: number, y: number, r: number, open: number, bright: number, timeMs: number, seed: number): void {
  if (open <= 0.01) return;
  const rr = r * open;
  glow(ctx, x, y, rr * 1.7, MAGIC_BLUE, bright * 0.8);
  const turn = timeMs / 700 + seed;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(bright, 0, 1);
  ctx.strokeStyle = MAGIC_WHITE;
  ctx.lineWidth = Math.max(0.8, rr * 0.08);
  ring(ctx, x, y, rr);
  ctx.strokeStyle = MAGIC_BLUE;
  ctx.lineWidth = Math.max(0.6, rr * 0.05);
  ring(ctx, x, y, rr * 0.78);
  ring(ctx, x, y, rr * 0.36);
  // The star: two triangles.
  for (const off of [0, Math.PI / 3]) {
    ctx.beginPath();
    for (let i = 0; i <= 3; i += 1) {
      const a = turn + off + (i / 3) * TWO_PI;
      const px = x + Math.cos(a) * rr * 0.76;
      const py = y + Math.sin(a) * rr * 0.76;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Runes round the rim, turning the other way.
  ctx.fillStyle = MAGIC_WHITE;
  for (let i = 0; i < 12; i += 1) {
    const a = -turn * 1.4 + (i / 12) * TWO_PI;
    const px = x + Math.cos(a) * rr * 0.89;
    const py = y + Math.sin(a) * rr * 0.89;
    if (i % 3 === 0) disc(ctx, px, py, Math.max(0.5, rr * 0.06));
    else {
      ctx.beginPath();
      ctx.moveTo(px - Math.sin(a) * rr * 0.05, py + Math.cos(a) * rr * 0.05);
      ctx.lineTo(px + Math.sin(a) * rr * 0.05, py - Math.cos(a) * rr * 0.05);
      ctx.stroke();
    }
  }
  ctx.fillStyle = MAGIC_DEEP;
  disc(ctx, x, y, rr * 0.12);
  ctx.restore();
}

/** A beam of Zoltraak from (ax, ay) to (bx, by), screen space, as bright as `light`. */
export function drawZoltraakBeam(ctx: Ctx2D, ax: number, ay: number, bx: number, by: number, z: number, light: number): void {
  glowLine(ctx, ax, ay, bx, by, 2.2 * z * (0.6 + 0.4 * light), MAGIC_BLUE, MAGIC_WHITE, light);
  if (light > 0.3) glow(ctx, bx, by, 9 * z * light, MAGIC_WHITE, light);
}

/** The staff in the mage's hand at (x, y), screen space: a wooden staff with a red gem at its head. */
export function drawStaff(ctx: Ctx2D, x: number, y: number, z: number, facing: 1 | -1, out: number, timeMs: number): void {
  if (out <= 0.01) return;
  const a = -Math.PI / 2 + facing * 0.35;
  const top = { x: x + Math.cos(a) * 14 * z, y: y + Math.sin(a) * 14 * z };
  const foot = { x: x - Math.cos(a) * 5 * z, y: y - Math.sin(a) * 5 * z };
  ctx.save();
  ctx.globalAlpha = out;
  ctx.strokeStyle = STAFF;
  ctx.lineWidth = Math.max(1, 1.2 * z);
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  ctx.strokeStyle = '#e9d9a8';
  ctx.lineWidth = Math.max(0.6, 0.5 * z);
  ring(ctx, top.x, top.y, 2.2 * z);
  ctx.fillStyle = GEM;
  disc(ctx, top.x, top.y, 1.2 * z);
  ctx.restore();
  glow(ctx, top.x, top.y, 6 * z * out, MAGIC_BLUE, 0.5 + 0.3 * Math.sin(timeMs / 200));
}
