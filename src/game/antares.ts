/**
 * Antares' look (Milo of Scorpio's Scarlet Needle): what the renderer lays over the worms while the
 * needles do their work. The worm points, its nail grows crimson; the Scorpio constellation is
 * traced faintly over its victim, and every needle that goes in streaks crimson from the fingertip
 * to one star of it, which lights up red for good; the fourteenth lit, the heart's star, Antares,
 * swells and beats, and the last needle goes into it.
 *
 * Two halves, as in freezer.ts: timing helpers that read the needle's stage (unit tested), and
 * screen space drawers the renderer places (render.ts).
 */

import { clamp } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import { ticksFor } from '../sim/techniques/common.ts';
import { stingTicks } from '../sim/techniques/needle.ts';
import type { NeedleBody } from '../sim/types.ts';
import { disc, ease, glint, glow, glowLine } from './light.ts';

export const SCARLET = '#ff1f3d';
export const SCARLET_SOFT = '#ff7a8c';
const STAR_WHITE = '#fff1f3';
const STAR_FAINT = '#c9d6ff';

/**
 * The fourteen stars of Scorpio the needles light, in the order they go in, world px from the
 * victim's middle (a whole worm's; a Saibaman's is drawn smaller): the claws, the head, the neck,
 * then down the body and round the tail to the sting.
 */
export const SCORPIO_STARS: readonly { readonly x: number; readonly y: number }[] = Object.freeze([
  { x: -12, y: -22 },
  { x: -6, y: -25 },
  { x: 0, y: -24 },
  { x: -4, y: -17 },
  { x: -2, y: -11 },
  { x: 3, y: 3 },
  { x: 6, y: 9 },
  { x: 7, y: 15 },
  { x: 5, y: 20 },
  { x: 1, y: 24 },
  { x: -4, y: 25 },
  { x: -9, y: 22 },
  { x: -11, y: 17 },
  { x: -8, y: 12 },
]);
/** The heart of the scorpion, the fifteenth: Antares. */
export const ANTARES_STAR = Object.freeze({ x: 0, y: -4 });

/** The lines of the constellation, by star index; -1 is Antares. */
const SCORPIO_LINES: readonly (readonly [number, number])[] = Object.freeze([
  [0, 3], [1, 3], [2, 3], [3, 4], [4, -1], [-1, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
]);

/** How big the constellation is drawn round a worm of this size: a good deal bigger than the worm, so the stars read. */
export function constellationScale(size: number): number {
  return (0.6 + 0.4 * size) * 1.35;
}

/** The constellation hangs this far above the victim's middle, in its own units, so its tail stays out of the ground. */
export const CONSTELLATION_LIFT = 12;

/** World point of star k (0 based; -1 for Antares) over a victim whose middle is at (x, y). */
export function starAt(k: number, x: number, y: number, size = 1): { readonly x: number; readonly y: number } {
  const s = constellationScale(size);
  const star = k < 0 ? ANTARES_STAR : (SCORPIO_STARS[k % SCORPIO_STARS.length] ?? ANTARES_STAR);
  return { x: x + star.x * s, y: y + (star.y - CONSTELLATION_LIFT) * s };
}

/** 0..1: the crimson on the fingertip: it grows through the point and holds while the needles fly. */
export function nailCharge(body: NeedleBody): number {
  if (body.stage === 'point') return ease((techniqueProgress(body) - 0.15) / 0.85);
  if (body.stage === 'sting' || body.stage === 'antares') return 1;
  return 1 - ease(techniqueProgress(body) / 0.4);
}

/** 0..1: how plain the constellation is: traced in through the point, gone in the recovery. */
export function constellationAlpha(body: NeedleBody): number {
  if (body.victimId === null) return 0;
  if (body.stage === 'point') return ease((techniqueProgress(body) - 0.3) / 0.7);
  if (body.stage === 'recover') return body.pierced ? 1 - ease(techniqueProgress(body) / 0.7) : 0;
  return 1;
}

/** Ticks since the latest needle went in, Infinity before the first and outside the stinging. */
export function sinceSting(body: NeedleBody): number {
  if (body.stage !== 'sting') return Infinity;
  let since = Infinity;
  for (const t of stingTicks(body.spec)) if (t <= body.stageTicks) since = body.stageTicks - t;
  return since;
}

/** 0..1: Antares swelling and beating before the last needle, and its flash as the needle goes in. */
export function heartBeat(body: NeedleBody): number {
  if (body.stage === 'antares') return 0.5 + 0.5 * techniqueProgress(body);
  if (body.stage === 'recover' && body.pierced) return Math.max(0, 1 - body.stageTicks / ticksFor(body.spec.recoverMs / 3));
  return 0;
}

/**
 * The constellation over the victim, screen space: (x, y) its middle, s the screen px per world px
 * of the constellation. Every line faint, the lit stars red, the rest pale, Antares beating.
 */
export function drawConstellation(ctx: Ctx2D, body: NeedleBody, x: number, y: number, s: number, timeMs: number): void {
  const alpha = constellationAlpha(body);
  if (alpha <= 0.01) return;
  const at = (k: number): { x: number; y: number } => {
    const star = k < 0 ? ANTARES_STAR : (SCORPIO_STARS[k] ?? ANTARES_STAR);
    return { x: x + star.x * s, y: y + (star.y - CONSTELLATION_LIFT) * s };
  };
  const lit = body.stings;
  ctx.save();
  ctx.lineWidth = Math.max(0.6, 0.35 * s);
  for (const [a, b] of SCORPIO_LINES) {
    const on = (a < 0 || a < lit) && (b < 0 ? lit >= 14 : b < lit);
    ctx.globalAlpha = alpha * (on ? 0.85 : 0.35);
    ctx.strokeStyle = on ? SCARLET_SOFT : STAR_FAINT;
    const p = at(a);
    const q = at(b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.restore();
  for (let k = 0; k < SCORPIO_STARS.length; k += 1) {
    const p = at(k);
    const on = k < lit;
    const twinkle = 0.75 + 0.25 * Math.sin(timeMs / 140 + k * 1.7);
    if (on) {
      glow(ctx, p.x, p.y, 3.2 * s, SCARLET, alpha * 0.9);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = STAR_WHITE;
      disc(ctx, p.x, p.y, 0.7 * s);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = alpha * 0.55 * twinkle;
      ctx.fillStyle = STAR_FAINT;
      disc(ctx, p.x, p.y, 0.45 * s);
      ctx.restore();
    }
  }
  // Antares: the red heart, swelling and beating once all fourteen are lit.
  const heart = at(-1);
  const beat = heartBeat(body);
  const pulse = 1 + Math.abs(Math.sin(timeMs / (beat > 0 ? 90 : 300))) * 0.35;
  glow(ctx, heart.x, heart.y, (2.6 + beat * 5) * s * pulse, SCARLET, alpha * (0.5 + 0.5 * beat));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = beat > 0 ? STAR_WHITE : SCARLET_SOFT;
  disc(ctx, heart.x, heart.y, (0.8 + beat * 1.1) * s);
  if (beat > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = SCARLET;
    glint(ctx, heart.x, heart.y, (4 + beat * 6) * s, timeMs / 300, 4);
  }
  ctx.restore();
}

/** The crimson nail on the fingertip at (x, y), screen space, as bright as `charge`. */
export function drawNail(ctx: Ctx2D, x: number, y: number, z: number, charge: number, timeMs: number): void {
  if (charge <= 0.01) return;
  const pulse = 1 + Math.sin(timeMs / 60) * 0.15;
  glow(ctx, x, y, 7 * z * charge * pulse, SCARLET, charge);
  ctx.save();
  ctx.fillStyle = SCARLET;
  disc(ctx, x, y, 1.1 * z * (0.6 + 0.4 * charge));
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = charge;
  ctx.fillStyle = STAR_WHITE;
  glint(ctx, x, y, 3.5 * z * charge, timeMs / 200, 4);
  ctx.restore();
}

/** A needle's streak from the fingertip to its star, screen space, fading over a few ticks (age 0 is the tick it went in). */
export function drawNeedleStreak(ctx: Ctx2D, ax: number, ay: number, bx: number, by: number, z: number, age: number): void {
  const life = 6;
  if (age < 0 || age >= life) return;
  const t = age / life;
  // The tail catches up with the head, as a tracer's does.
  const tail = clamp(t * 1.3, 0, 1);
  glowLine(ctx, ax + (bx - ax) * tail, ay + (by - ay) * tail, bx, by, 1.2 * z, SCARLET, STAR_WHITE, 1 - t);
}
