/**
 * The Tesoro del Cielo's look (Shaka of Virgo's Tenbu Horin). The cast: the worm sits in the lotus
 * and floats a little, a golden halo behind its head; the twin Sala trees grow up on either side of
 * it in blossom, shedding petals; and the treasure's golden wheel comes down out of the sky over the
 * target, turning, and closes on it. Once sealed, a small golden wheel hangs over the worm's head
 * with a bead for every strike to come. A strike: the wheel opens again over the sealed worm, turns
 * faster and faster in its light, and bites.
 *
 * Two halves: timing helpers on the treasure's stage (unit tested) and screen space drawers the
 * renderer places (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { hash01 } from '../core/rng.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import { STRIKE_LANDS_AT } from '../sim/techniques/treasure.ts';
import type { TreasureBody } from '../sim/types.ts';
import { disc, ease, glint, glow, quadTo, ring } from './light.ts';

export const TREASURE_GOLD = '#ffcf3a';
export const TREASURE_LIGHT = '#fff3c0';
const GOLD_DARK = '#9a6a00';
const TRUNK = '#5b3a1e';
const LEAVES = '#2f6b3a';
const BLOSSOM = '#fff0f6';
const LOTUS = '#ff9fc8';
const LOTUS_DARK = '#c2558c';

/** How high the caster floats in the lotus, world px. */
export const LOTUS_LIFT_PX = 4;

/** 0..1: how far the cast has gone: the lotus and the trees grow in, the wheel comes down. */
export function castProgress(body: TreasureBody): number {
  if (body.mode !== 'cast') return 0;
  if (body.stage === 'cast') return techniqueProgress(body);
  return 1;
}

/** 0..1: the lotus under the caster and the trees beside it: up through the cast, fading in the recovery. */
export function lotusBloom(body: TreasureBody): number {
  if (body.mode !== 'cast') return 0;
  if (body.stage === 'cast') return ease(techniqueProgress(body) / 0.35);
  return 1 - ease(techniqueProgress(body) / 0.8);
}

/** Where the wheel is over its target, and how big and bright: coming down in the cast, over it in a strike. Null when there is no wheel. */
export function wheelState(body: TreasureBody): { readonly drop: number; readonly scale: number; readonly glow: number; readonly spin: number } | null {
  const p = techniqueProgress(body);
  if (body.mode === 'cast') {
    if (body.stage === 'cast') {
      const t = clamp((p - 0.3) / 0.7, 0, 1);
      if (t <= 0) return null;
      return { drop: 1 - ease(t), scale: 0.4 + 0.6 * ease(t * 2), glow: t, spin: 1 + t * 2 };
    }
    // Closed on its target: it shrinks into the worm, or fades over nothing.
    const t = ease(p / 0.4);
    return t >= 1 ? null : { drop: 0, scale: body.landed ? 1 - t : 1, glow: 1 - t, spin: 3 };
  }
  if (body.stage === 'strike') {
    const bite = p / STRIKE_LANDS_AT;
    return { drop: 0, scale: 0.5 + 0.7 * ease(Math.min(1, bite)), glow: bite >= 1 ? Math.max(0.3, 1 - (bite - 1) * 1.4) : 0.4 + 0.6 * bite, spin: 1 + 5 * Math.min(1, bite) };
  }
  return null;
}

/**
 * The treasure's wheel centred at (x, y), screen space, radius r: a golden rim with a ring of beads,
 * eight spokes from a hub, a lotus at the hub, turned by `rotation`, in a glow.
 */
export function drawWheel(ctx: Ctx2D, x: number, y: number, r: number, rotation: number, light: number, alpha: number): void {
  if (alpha <= 0.01 || r <= 0.5) return;
  glow(ctx, x, y, r * 1.9, TREASURE_GOLD, alpha * (0.4 + 0.6 * light));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = Math.max(1, r * 0.2);
  ring(ctx, x, y, r);
  ctx.strokeStyle = TREASURE_GOLD;
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ring(ctx, x, y, r);
  for (let i = 0; i < 8; i += 1) {
    const a = rotation + (i / 8) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.22, y + Math.sin(a) * r * 0.22);
    ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
    ctx.stroke();
    ctx.fillStyle = TREASURE_LIGHT;
    disc(ctx, x + Math.cos(a + TWO_PI / 16) * r, y + Math.sin(a + TWO_PI / 16) * r, Math.max(0.6, r * 0.09));
  }
  ctx.fillStyle = TREASURE_GOLD;
  disc(ctx, x, y, r * 0.26);
  ctx.fillStyle = LOTUS;
  disc(ctx, x, y, r * 0.13);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha * light * 0.7;
  ctx.fillStyle = TREASURE_LIGHT;
  glint(ctx, x, y, r * 1.15, -rotation * 0.5, 8);
  ctx.restore();
}

/** The lotus the caster sits in, its middle at (x, y) on screen: two rows of pink petals. */
export function drawLotus(ctx: Ctx2D, x: number, y: number, z: number, bloom: number): void {
  if (bloom <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = bloom;
  for (const [row, color, spread, len] of [[0, LOTUS_DARK, 1, 1], [1, LOTUS, 0.7, 0.8]] as const) {
    for (let i = -2; i <= 2; i += 1) {
      const a = -Math.PI / 2 + i * 0.42 * spread;
      const l = (7 - Math.abs(i) * 1.1) * z * len * bloom;
      const x0 = x - Math.sin(a) * 1.6 * z;
      const y0 = y + row * z;
      const tipX = x + Math.cos(a) * l;
      const tipY = y + Math.sin(a) * l;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      quadTo(ctx, x0, y0, x + Math.cos(a) * l * 0.6 - Math.sin(a) * 2.6 * z, y + Math.sin(a) * l * 0.6, tipX, tipY, 4);
      quadTo(ctx, tipX, tipY, x + Math.cos(a) * l * 0.6 + Math.sin(a) * 2.6 * z, y + Math.sin(a) * l * 0.6, x + Math.sin(a) * 1.6 * z, y0, 4);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** One Sala tree standing on (x, y), screen space, grown as far as `grow`: a trunk and a crown in blossom. */
export function drawSalaTree(ctx: Ctx2D, x: number, y: number, z: number, grow: number, seed: number, timeMs: number): void {
  if (grow <= 0.01) return;
  const h = 34 * z * grow;
  ctx.save();
  ctx.globalAlpha = clamp(grow * 1.5, 0, 1);
  ctx.fillStyle = TRUNK;
  ctx.beginPath();
  ctx.moveTo(x - 1.6 * z, y);
  ctx.lineTo(x - 0.8 * z, y - h);
  ctx.lineTo(x + 0.8 * z, y - h);
  ctx.lineTo(x + 1.6 * z, y);
  ctx.closePath();
  ctx.fill();
  const crown = 11 * z * grow;
  ctx.fillStyle = LEAVES;
  for (let i = 0; i < 5; i += 1) disc(ctx, x + (hash01(seed, i) - 0.5) * crown * 1.4, y - h - (hash01(seed, i + 9) - 0.3) * crown, crown * (0.5 + hash01(seed, i + 18) * 0.3));
  for (let i = 0; i < 14; i += 1) {
    const sway = Math.sin(timeMs / 600 + i) * 0.6 * z;
    ctx.fillStyle = i % 4 === 0 ? LOTUS : BLOSSOM;
    disc(ctx, x + (hash01(seed, i + 30) - 0.5) * crown * 1.9 + sway, y - h - (hash01(seed, i + 50) - 0.4) * crown * 1.3, Math.max(0.6, 0.9 * z * grow));
  }
  ctx.restore();
}

/** The halo behind the caster's head at (x, y), screen space: a golden ring with rays. */
export function drawHalo(ctx: Ctx2D, x: number, y: number, z: number, strength: number, timeMs: number): void {
  if (strength <= 0.01) return;
  glow(ctx, x, y, 14 * z, TREASURE_GOLD, strength * 0.8);
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.strokeStyle = TREASURE_GOLD;
  ctx.lineWidth = Math.max(1, 0.8 * z);
  ring(ctx, x, y, 7 * z);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = TREASURE_LIGHT;
  ctx.globalAlpha = strength * 0.6;
  glint(ctx, x, y, 12 * z, timeMs / 2400, 12);
  ctx.restore();
}

/** The seal over a sealed worm's head at (x, y), screen space: a small golden wheel and a bead per strike still to come. */
export function drawSealMark(ctx: Ctx2D, x: number, y: number, z: number, hitsLeft: number, hits: number, timeMs: number): void {
  const r = 3.4 * z;
  drawWheel(ctx, x, y, r, timeMs / 900, 0.3 + 0.2 * Math.sin(timeMs / 300), 0.95);
  ctx.save();
  for (let i = 0; i < hits; i += 1) {
    const bx = x + (i - (hits - 1) / 2) * 3.2 * z;
    const by = y + r + 2.6 * z;
    ctx.fillStyle = i < hitsLeft ? TREASURE_GOLD : 'rgba(40, 30, 10, 0.6)';
    disc(ctx, bx, by, 1.1 * z);
  }
  ctx.restore();
}
