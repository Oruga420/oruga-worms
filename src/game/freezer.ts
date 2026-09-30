/**
 * The Freezer's look: the pieces the renderer lays over the worms while the light does its work.
 * The attacker takes the emperor's last form as it points: it pales to white, a purple dome crowns
 * its head and a dark purple aura burns round it, and a pink light gathers on its fingertip,
 * brighter and brighter, then flies off as a white hot core in a pink glow, trailing sparkles. The
 * victim glows pink from inside once the light is in, floats up trembling and swells, throbbing
 * faster and faster, with pink light breaking out of it through the cracks, until it bursts.
 *
 * Two halves: timing helpers that turn a hex's stage into how far along the form is, how bright the
 * glow and how swollen the body (unit tested), and screen space drawers the renderer places
 * (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { hash01 } from '../core/rng.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { hexProgress, pulseTicks } from '../sim/hex.ts';
import type { HexBody } from '../sim/types.ts';

export const HEX_PINK = '#ff4fd8';
export const HEX_PINK_SOFT = '#ffa6ee';
export const HEX_CORE = '#fff5fd';
/** The emperor's white, washed over the attacker's sprite. */
export const TYRANT_WHITE = '#f6f0ff';
const DOME = '#9a3fe0';
const DOME_SHADE = '#5b1c95';
const DOME_SHINE = '#e7c4ff';

/** How much wider and taller the victim gets by the end of the swell (a throb adds a little more). */
export const SWELL_X = 1.4;
export const SWELL_Y = 1.0;

function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 0..1: the emperor's form on the attacker: it comes on as the arm goes up, holds while the light works, and wears off in the recovery. */
export function tyrantForm(hex: HexBody): number {
  const p = hexProgress(hex);
  if (hex.stage === 'point') return ease(p / 0.45);
  if (hex.stage === 'recover') return 1 - ease((p - 0.45) / 0.55);
  return 1;
}

/** 0..1: the light gathered on the fingertip: it swells through the point, and is gone once it flies. */
export function tipCharge(hex: HexBody): number {
  if (hex.stage !== 'point') return 0;
  return ease((hexProgress(hex) - 0.2) / 0.8);
}

/** The jolt of the latest throb: 1 on it, gone a few ticks later; 0 before the first and outside the swell. */
export function throb(hex: HexBody): number {
  if (hex.stage !== 'swell') return 0;
  let since = Infinity;
  for (const t of pulseTicks(hex.spec)) if (t <= hex.stageTicks) since = hex.stageTicks - t;
  if (!Number.isFinite(since)) return 0;
  return Math.exp(-since / 4);
}

/**
 * 0..1: the pink glow inside the victim. It flares as the light goes in and settles while the worm
 * floats, then burns brighter and brighter as it swells, flaring again on every throb.
 */
export function innerGlow(hex: HexBody): number {
  if (hex.victimId === null || hex.burst) return 0;
  const p = hexProgress(hex);
  if (hex.stage === 'rise') return 0.4 + 0.6 * Math.max(0, 1 - p / 0.25);
  if (hex.stage === 'swell') return Math.min(1, 0.45 + 0.45 * p + 0.35 * throb(hex));
  return 0;
}

/** How swollen the victim is: width and height multipliers, 1 until it swells, then up and up, a jolt on every throb. */
export function swelling(hex: HexBody): { readonly x: number; readonly y: number } {
  if (hex.victimId === null || hex.burst || hex.stage !== 'swell') return { x: 1, y: 1 };
  const p = hexProgress(hex);
  const k = 0.35 * p + 0.65 * p * p;
  const jolt = throb(hex) * 0.1;
  return { x: 1 + SWELL_X * k + jolt, y: 1 + SWELL_Y * k + jolt * 0.8 };
}

/** 0..1: how hard the victim shakes: a little while it floats, more and more as it swells. */
export function tremble(hex: HexBody): number {
  if (hex.victimId === null || hex.burst) return 0;
  if (hex.stage === 'rise') return 0.3;
  if (hex.stage === 'swell') return 0.3 + 0.7 * hexProgress(hex);
  return 0;
}

function disc(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TWO_PI);
  ctx.fill();
}

/** Discs in a glow: enough that the steps between them do not read as rings. */
const GLOW_STEPS = 8;

/** A soft round glow: discs from wide and faint to small and bright, added on top of what is there. */
function glow(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (alpha <= 0.01 || r <= 0.1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color;
  for (let i = GLOW_STEPS; i >= 1; i -= 1) {
    ctx.globalAlpha = alpha * 0.08;
    disc(ctx, x, y, r * (i / GLOW_STEPS));
  }
  ctx.restore();
}

/** A four pointed glint, the sparkle on a light. */
function glint(ctx: Ctx2D, x: number, y: number, r: number, rotation: number): void {
  const w = r * 0.18;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const a = rotation + (i / 4) * TWO_PI;
    const b = a + TWO_PI / 8;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(b) * w, y + Math.sin(b) * w);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * The pink light, centred at (x, y), screen space: a wide pink glow, a pink ball and its white hot
 * core, and a slow turning glint. size scales all of it (1 is the light in flight).
 */
export function drawHexLight(ctx: Ctx2D, x: number, y: number, z: number, size: number, timeMs: number): void {
  if (size <= 0.02) return;
  const pulse = 1 + Math.sin(timeMs / 55) * 0.12;
  const r = 2.6 * z * size * pulse;
  glow(ctx, x, y, r * 4.2, HEX_PINK, 1);
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = HEX_PINK;
  disc(ctx, x, y, r * 1.25);
  ctx.fillStyle = HEX_PINK_SOFT;
  disc(ctx, x, y, r * 0.95);
  ctx.fillStyle = HEX_CORE;
  disc(ctx, x, y, r * 0.6);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9;
  glint(ctx, x, y, r * 3, timeMs / 380);
  ctx.globalAlpha = 0.5;
  glint(ctx, x, y, r * 2.1, -timeMs / 260 + Math.PI / 4);
  ctx.restore();
}

/** The trail behind the flying light: fading pink beads along where it has been, oldest last. Screen points. */
export function drawHexTrail(ctx: Ctx2D, points: readonly { readonly x: number; readonly y: number }[], z: number): void {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  points.forEach((p, i) => {
    const k = 1 - (i + 1) / (points.length + 1);
    ctx.globalAlpha = 0.55 * k;
    ctx.fillStyle = i % 2 === 0 ? HEX_PINK : HEX_PINK_SOFT;
    disc(ctx, p.x, p.y, (0.8 + 1.8 * k) * z);
  });
  ctx.restore();
}

/**
 * The emperor's dome, sitting on the head with its rim at (x, y), screen space: a purple half
 * shell with a dark rim and a shine on the side the worm faces. strength fades it in and out.
 */
export function drawTyrantDome(ctx: Ctx2D, x: number, y: number, z: number, facing: 1 | -1, strength: number): void {
  if (strength <= 0.01) return;
  const rx = 4.4 * z;
  const ry = 3.6 * z;
  ctx.save();
  ctx.globalAlpha = clamp(strength * 1.3, 0, 1);
  ctx.translate(x, y);
  ctx.fillStyle = DOME_SHADE;
  ctx.save();
  ctx.scale(rx + 0.5 * z, ry + 0.5 * z);
  ctx.beginPath();
  ctx.arc(0, 0, 1, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.restore();
  ctx.fill();
  ctx.fillStyle = DOME;
  ctx.save();
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.restore();
  ctx.fill();
  ctx.fillStyle = DOME_SHINE;
  ctx.save();
  ctx.translate(facing * rx * 0.35, -ry * 0.55);
  ctx.scale(rx * 0.28, ry * 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.restore();
  ctx.fill();
  ctx.restore();
}

/**
 * The glow of the light inside the victim, round its middle at (cx, cy) with the body's half width
 * and height (screen px): a pink bloom, and once it swells, pink light breaking out of the body in
 * rays that grow with the swelling and flicker. seed keeps the rays where they are frame to frame.
 */
export function drawInnerGlow(ctx: Ctx2D, cx: number, cy: number, halfW: number, halfH: number, strength: number, swell: number, seed: number, timeMs: number): void {
  if (strength <= 0.01) return;
  glow(ctx, cx, cy, Math.max(halfW, halfH) * 1.5, HEX_PINK, strength * 0.8);
  const rays = Math.round(clamp((swell - 1) / 0.12, 0, 11));
  if (rays === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < rays; i += 1) {
    const a = hash01(seed, i) * TWO_PI;
    const flicker = 0.6 + 0.4 * Math.abs(Math.sin(timeMs / 40 + i * 2.1));
    const from = 0.55;
    const reach = (1.05 + (swell - 1) * 1.6 * (0.6 + hash01(seed, i + 20) * 0.6)) * flicker;
    const half = 0.07 + hash01(seed, i + 40) * 0.06;
    const ex = Math.cos(a) * halfW;
    const ey = Math.sin(a) * halfH;
    ctx.globalAlpha = strength * 0.75;
    ctx.fillStyle = i % 3 === 0 ? HEX_CORE : HEX_PINK_SOFT;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - half) * halfW * from, cy + Math.sin(a - half) * halfH * from);
    ctx.lineTo(cx + ex * reach, cy + ey * reach);
    ctx.lineTo(cx + Math.cos(a + half) * halfW * from, cy + Math.sin(a + half) * halfH * from);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // A white heart to the glow once it is close to bursting.
  if (swell > 1.8) glow(ctx, cx, cy, Math.min(halfW, halfH) * 0.9, HEX_CORE, clamp((swell - 1.8) / 0.5, 0, 1) * strength);
}
