/**
 * The power orb's look: the crate that recharges a super (match/crates.ts rollPower). An orange
 * ball with four red stars in it, the kind a dragon hides, falling out of the sky like a comet with
 * a tail of light behind it, and once down, floating a hand's width off the ground, bobbing and
 * pulsing in a gold aura. The fx layer adds the sparkles it sheds (fx.ts) and the gold burst when a
 * worm takes it.
 *
 * Screen space drawers the renderer places (render.ts), plus the timing helpers they use (unit
 * tested). Everything is layered circles and stars, no gradients: the test contexts record paths.
 */

import { TWO_PI } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';

export const POWER_GOLD = '#ffd35a';
export const POWER_ORANGE = '#f5961e';
const BALL_LIGHT = '#ffc766';
const BALL_EDGE = '#a8470d';
const STAR_RED = '#d91a1f';
/** The glow's layers, outside in. Painted over the sky rather than added to it: added to a blue sky, gold comes out white. */
const HALO_OUTER = '#ffd35a';
const HALO_MID = '#ffe27a';
const HALO_INNER = '#fff6c8';
const AURA_STEPS = 7;

/** Radius of the ball, world px: about a worm wide, like a crate. */
export const ORB_RADIUS = 6;
/** How far above the ground a resting orb floats, world px, before its bob. */
const HOVER_PX = 3;

/** 0..1 breathing of the aura, about once a second and a half. */
export function orbPulse(timeMs: number): number {
  return 0.5 + 0.5 * Math.sin(timeMs / 240);
}

/** World px above its feet point that the ball's centre sits: resting it floats and bobs, falling it hangs under the tail. */
export function orbLift(landed: boolean, timeMs: number): number {
  return ORB_RADIUS + (landed ? HOVER_PX + Math.sin(timeMs / 380) * 1.5 : 0);
}

/** Five pointed star, one point up. */
function star(ctx: Ctx2D, x: number, y: number, outer: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : outer * 0.45;
    const a = -Math.PI / 2 + (i / 10) * TWO_PI;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** A drop pointing up: round at (x, y) with the given half width, tapering to a point len above. */
function teardrop(ctx: Ctx2D, x: number, y: number, half: number, len: number): void {
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.lineTo(x, y - len);
  ctx.lineTo(x + half, y);
  ctx.arc(x, y, half, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}

function disc(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, TWO_PI);
  ctx.fill();
}

/**
 * The orb with its feet at screen (x, y) and the world zoom z. Falling, a tail of light trails up
 * behind it; resting, it floats and bobs with a four point glint turning over it.
 */
export function drawPowerOrb(ctx: Ctx2D, x: number, y: number, z: number, timeMs: number, landed: boolean): void {
  const r = ORB_RADIUS * z;
  const cy = y - orbLift(landed, timeMs) * z;
  const pulse = orbPulse(timeMs);
  ctx.save();
  if (!landed) {
    // The comet's tail, up the way it came: a gold streak with a pale core.
    ctx.fillStyle = HALO_MID;
    ctx.globalAlpha = 0.45;
    teardrop(ctx, x, cy, r * 1.25, r * 6.5);
    ctx.fillStyle = HALO_INNER;
    ctx.globalAlpha = 0.7;
    teardrop(ctx, x, cy, r * 0.7, r * 5);
  }
  // The aura, breathing: many faint discs, so it fades out softly instead of in rings.
  const aura = r * (2 + pulse * 0.5);
  for (let i = 0; i < AURA_STEPS; i += 1) {
    ctx.fillStyle = i < AURA_STEPS / 2 ? HALO_OUTER : HALO_MID;
    ctx.globalAlpha = 0.085;
    disc(ctx, x, cy, aura * (1 - (i / AURA_STEPS) * 0.55));
  }
  ctx.fillStyle = HALO_INNER;
  ctx.globalAlpha = 0.45 + pulse * 0.2;
  disc(ctx, x, cy, r * 1.3);
  // The ball: a deep orange rim, a lighter body, a shine up and to the left.
  ctx.globalAlpha = 1;
  ctx.fillStyle = BALL_EDGE;
  disc(ctx, x, cy, r + Math.max(0.8, 0.5 * z));
  ctx.fillStyle = POWER_ORANGE;
  disc(ctx, x, cy, r);
  ctx.fillStyle = BALL_LIGHT;
  disc(ctx, x - r * 0.12, cy - r * 0.14, r * 0.78);
  // Four stars in a diamond.
  ctx.fillStyle = STAR_RED;
  const s = r * 0.25;
  star(ctx, x, cy - r * 0.42, s);
  star(ctx, x - r * 0.4, cy + r * 0.02, s);
  star(ctx, x + r * 0.4, cy + r * 0.02, s);
  star(ctx, x, cy + r * 0.44, s);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  disc(ctx, x - r * 0.42, cy - r * 0.46, r * 0.2);
  ctx.globalAlpha = 0.5;
  disc(ctx, x - r * 0.18, cy - r * 0.62, r * 0.09);
  if (landed) {
    // A glint turning over the ball, now and then.
    const glint = Math.max(0, Math.sin(timeMs / 170));
    if (glint > 0.35) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (glint - 0.35) / 0.65;
      ctx.fillStyle = '#fffbe6';
      const gx = x + r * 0.55;
      const gy = cy - r * 0.6;
      const long = r * (0.7 + glint * 0.5);
      const thin = r * 0.12;
      ctx.beginPath();
      ctx.moveTo(gx, gy - long);
      ctx.lineTo(gx + thin, gy - thin);
      ctx.lineTo(gx + long, gy);
      ctx.lineTo(gx + thin, gy + thin);
      ctx.lineTo(gx, gy + long);
      ctx.lineTo(gx - thin, gy + thin);
      ctx.lineTo(gx - long, gy);
      ctx.lineTo(gx - thin, gy - thin);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
