/**
 * The Saibaman's look: the pieces the renderer lays over the world while a seed does its work, and
 * the colour of what comes out of it. The planter reaches out with the seed and pushes it into the
 * ground; a mound of fresh earth where it went in; then the mound trembles and the ground cracks,
 * one crack at a time, green light shining up through the cracks, brighter and brighter, until the
 * ground gives and the Saibaman leaps out. A seed that cannot grow wilts where it lies.
 *
 * A Saibaman is a worm like any other in the sim, only smaller (sim/worm-size.ts); here it is also
 * green. Two halves, as in freezer.ts: timing helpers that turn a sprout's stage into how far along
 * the planting, the mound and the light are (unit tested), and screen space drawers the renderer
 * places (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { hash01 } from '../core/rng.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { crackTicks, sproutProgress } from '../sim/sprout.ts';
import type { SproutBody } from '../sim/types.ts';

/** The Saibaman's skin, washed over the worm sprite, and how strongly. */
export const SAIBA_GREEN = '#3fae3a';
export const SAIBA_SKIN_ALPHA = 0.62;
/** The light that shines up through the cracks. */
export const SPROUT_GLOW = '#9bff5a';
const SEED = '#2f5d1e';
const SEED_SHINE = '#6fa84a';
const MOUND = '#6b4a2b';
const MOUND_DARK = '#4a321c';
const CRACK = '#1c120a';

/** A worm smaller than a full one is a Saibaman: nothing else in the game shrinks. */
export function isSaibaman(worm: { readonly size?: number }): boolean {
  return (worm.size ?? 1) < 1;
}

function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 0..1: how far down the seed has gone, from the planter's hand into the ground; 1 once it is in. */
export function seedDepth(sprout: SproutBody): number {
  if (sprout.stage !== 'plant') return 1;
  return ease((sproutProgress(sprout) - 0.25) / 0.6);
}

/** 0..1: how much light comes up through the cracks: from the first crack, brighter to the break. */
export function crackGlow(sprout: SproutBody): number {
  if (sprout.stage !== 'grow' || sprout.cracks === 0) return 0;
  return clamp(0.25 + 0.75 * sproutProgress(sprout), 0, 1);
}

/** World px the mound jumps sideways this frame: it trembles as the ground shakes, harder with each crack. */
export function moundTremble(sprout: SproutBody, timeMs: number): number {
  if (sprout.stage !== 'grow') return 0;
  return Math.sin(timeMs / 26) * (0.4 + sprout.cracks * 0.35);
}

/** Ticks since the latest crack, Infinity before the first: the crack flashes as it opens. */
export function sinceCrack(sprout: SproutBody): number {
  if (sprout.stage !== 'grow') return Infinity;
  let since = Infinity;
  for (const t of crackTicks(sprout.spec)) if (t <= sprout.stageTicks) since = sprout.stageTicks - t;
  return since;
}

/** Where the planter's hand holds the seed out, world px, for a worm standing at (x, y). */
export function seedHand(sprout: SproutBody): { readonly x: number; readonly y: number } {
  return { x: sprout.holdX + sprout.facing * 7, y: sprout.holdY - 7 };
}

/**
 * The seed's scene at the spot, screen space: (x, y) the spot where it goes in, z the world zoom.
 * The seed on its way down from the hand, the mound, the cracks and the light through them, and a
 * seed that wilts.
 */
export function drawSproutScene(ctx: Ctx2D, sprout: SproutBody, spot: { readonly x: number; readonly y: number }, hand: { readonly x: number; readonly y: number }, z: number, timeMs: number): void {
  ctx.save();
  const depth = seedDepth(sprout);
  const growing = sprout.stage === 'grow' || (sprout.stage === 'plant' && depth >= 1);
  const popped = sprout.sproutId !== null;
  // The mound of fresh earth over the seed, trembling while the ground shakes; gone once it gave.
  if (!popped && sprout.fertile && (growing || depth > 0.6)) {
    const mx = spot.x + moundTremble(sprout, timeMs) * z;
    const rise = sprout.stage === 'grow' ? 1 + sproutProgress(sprout) * 0.6 : 1;
    ctx.fillStyle = MOUND_DARK;
    ctx.beginPath();
    ctx.arc(mx, spot.y + 0.5 * z, 3.6 * z * rise, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = MOUND;
    ctx.beginPath();
    ctx.arc(mx - 0.4 * z, spot.y + 0.5 * z, 2.9 * z * rise, Math.PI, 0);
    ctx.fill();
  }
  // The cracks: jagged lines out from the spot along the ground, one more at every crack, each
  // flashing green as it opens, with the light shining up through all of them.
  if (sprout.stage === 'grow' && sprout.cracks > 0) {
    const glow = crackGlow(sprout);
    const flash = Math.exp(-sinceCrack(sprout) / 6);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = SPROUT_GLOW;
    ctx.globalAlpha = 0.08 + glow * 0.16 + flash * 0.18;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y - 1 * z, (3 + glow * 3.5) * z, 0, TWO_PI);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < sprout.cracks; k += 1) {
      const side = k % 2 === 0 ? 1 : -1;
      const length = (6 + k * 3.5) * z;
      const opening = k === sprout.cracks - 1 ? clamp(1 - sinceCrack(sprout) / 10, 0, 1) : 0;
      const reach = length * (1 - opening * 0.6);
      ctx.strokeStyle = CRACK;
      ctx.lineWidth = Math.max(1, 1.1 * z);
      ctx.beginPath();
      ctx.moveTo(spot.x, spot.y);
      const steps = 4;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const jag = (hash01(sprout.id * 31 + k, i) - 0.5) * 2.4 * z;
        ctx.lineTo(spot.x + side * reach * t, spot.y + jag * 0.5 + (i % 2 === 0 ? 0.8 : -0.4) * z);
      }
      ctx.stroke();
      ctx.strokeStyle = SPROUT_GLOW;
      ctx.lineWidth = Math.max(0.6, 0.45 * z);
      ctx.globalAlpha = 0.35 + glow * 0.5 + flash * 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // The seed itself: held out, then pushed down into the ground; a withered one lies brown on it.
  if (sprout.stage === 'plant' && depth < 1) {
    const sx = hand.x + (spot.x - hand.x) * depth;
    const sy = hand.y + (spot.y + 1.5 * z - hand.y) * depth;
    ctx.fillStyle = SEED;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.9 * z, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = SEED_SHINE;
    ctx.beginPath();
    ctx.arc(sx - 0.6 * z, sy - 0.6 * z, 0.7 * z, 0, TWO_PI);
    ctx.fill();
  } else if (!sprout.fertile && sprout.stage === 'recover') {
    ctx.globalAlpha = clamp(1 - sproutProgress(sprout), 0, 1);
    ctx.fillStyle = '#7a6a3a';
    ctx.beginPath();
    ctx.arc(spot.x, spot.y - 1.2 * z, 1.7 * z, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}
