/**
 * The Santoryu's look (Roronoa Zoro's three sword style): three swords out, one in each hand and one
 * in the mouth; then the cuts, white streaks across the square ahead, each left hanging in the air
 * as a thin line, criss-crossing it into a grid; then, all at once, the cut lands: a white flash
 * along every line, and the land in the square falls apart into cubes that tumble down and are gone
 * (fx.ts throws them, from the cells the sim worked out).
 *
 * Two halves: timing and geometry helpers on the cut (unit tested), and screen space drawers the
 * renderer places (render.ts).
 */

import { clamp } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import { ticksFor } from '../sim/techniques/common.ts';
import type { DiceBody } from '../sim/types.ts';
import { disc, ease, glowLine } from './light.ts';

const STEEL = '#e9f1f8';
const STEEL_EDGE = '#9fb3c6';
const GRIP = '#1d1d24';
const GUARD = '#d4a017';
export const CUT_WHITE = '#f4fbff';
export const CUT_BLUE = '#7fd4ff';

/** 0..1: the swords out: drawn over the draw, held through the cuts, sheathed in the recovery. */
export function swordsOut(body: DiceBody): number {
  if (body.stage === 'draw') return ease(techniqueProgress(body) / 0.5);
  if (body.stage === 'slash') return 1;
  return 1 - ease(techniqueProgress(body) / 0.6);
}

/**
 * Cut k of a square, from 1, as a segment in world px: the cuts go across it in turn, level then
 * upright, spaced so that together they grid it, each a little tilted.
 */
export function cutLine(body: Pick<DiceBody, 'squareX' | 'squareY' | 'side' | 'id'>, k: number, cuts: number): { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } {
  const across = Math.ceil(cuts / 2);
  const slot = Math.floor((k - 1) / 2) + 1;
  const at = (slot / (across + 1)) * body.side;
  const tilt = (((body.id * 7 + k * 13) % 9) - 4) * 0.012 * body.side;
  if (k % 2 === 1) return { x0: body.squareX, y0: body.squareY + at - tilt, x1: body.squareX + body.side, y1: body.squareY + at + tilt };
  return { x0: body.squareX + at + tilt, y0: body.squareY, x1: body.squareX + at - tilt, y1: body.squareY + body.side };
}

/** Ticks since cut k went in during the slashing, Infinity when it has not yet. */
export function sinceCut(body: DiceBody, k: number): number {
  if (body.stage !== 'slash' || k > body.slashes) return Infinity;
  const every = ticksFor(body.spec.slashIntervalMs);
  return body.stageTicks - (1 + (k - 1) * every);
}

/** 0..1 through the flash of the cut landing, the start of the recovery; null outside it. */
export function cutFlash(body: DiceBody): number | null {
  if (body.stage !== 'recover' || !body.cut) return null;
  const t = techniqueProgress(body) / 0.35;
  return t >= 1 ? null : t;
}

/** One sword from the hilt at (x, y) on screen along `angle`, len long: grip, guard, a blade with an edge. */
function sword(ctx: Ctx2D, x: number, y: number, angle: number, len: number, z: number): void {
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  ctx.strokeStyle = GRIP;
  ctx.lineWidth = Math.max(1, 1.3 * z);
  ctx.beginPath();
  ctx.moveTo(x - cx * 3 * z, y - cy * 3 * z);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = GUARD;
  disc(ctx, x, y, 0.9 * z);
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = Math.max(1, 1.1 * z);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + cx * len, y + cy * len);
  ctx.stroke();
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = Math.max(0.6, 0.5 * z);
  ctx.beginPath();
  ctx.moveTo(x + cx * z, y + cy * z);
  ctx.lineTo(x + cx * len, y + cy * len);
  ctx.stroke();
}

/**
 * The three swords on a worm whose middle is at (x, y) on screen, facing `facing`: one held up and
 * forward, one held low and back, and one in the mouth, level. out 0..1 draws them.
 */
export function drawThreeSwords(ctx: Ctx2D, x: number, y: number, z: number, facing: 1 | -1, out: number, timeMs: number): void {
  if (out <= 0.01) return;
  const len = 13 * z * out;
  const f = facing;
  const sway = Math.sin(timeMs / 240) * 0.05;
  ctx.save();
  ctx.globalAlpha = clamp(out * 1.4, 0, 1);
  // The mouth sword, level across the face.
  sword(ctx, x + f * 1 * z, y - 4.2 * z, f === 1 ? 0 : Math.PI, len * 0.9, z);
  // The hands: one up and forward, one low and back.
  sword(ctx, x + f * 5 * z, y + 0.5 * z, f === 1 ? -0.9 + sway : Math.PI + 0.9 - sway, len, z);
  sword(ctx, x - f * 4 * z, y + 2 * z, f === 1 ? Math.PI - 0.5 - sway : 0.5 + sway, len, z);
  ctx.restore();
}

/** The cuts hanging in the air over the square, and the flash along all of them as the cut lands. Screen space segments. */
export function drawCuts(ctx: Ctx2D, segments: readonly { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly age: number }[], z: number, flash: number | null): void {
  for (const seg of segments) {
    if (flash !== null) {
      glowLine(ctx, seg.x0, seg.y0, seg.x1, seg.y1, 1.6 * z, CUT_BLUE, CUT_WHITE, 1 - flash);
      continue;
    }
    // Fresh: a white streak racing across; then a thin line hanging in the air.
    const fresh = seg.age < 6;
    const head = clamp((seg.age + 1) / 4, 0, 1);
    const x1 = seg.x0 + (seg.x1 - seg.x0) * head;
    const y1 = seg.y0 + (seg.y1 - seg.y0) * head;
    glowLine(ctx, seg.x0, seg.y0, x1, y1, (fresh ? 1.5 : 0.45) * z, CUT_BLUE, CUT_WHITE, fresh ? 1 : 0.7);
  }
}

/** The square a cut takes, as the aim shows it before the cut: dashed sides and bright corners. Screen rect. */
export function drawCutSquare(ctx: Ctx2D, x: number, y: number, side: number, z: number, timeMs: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 235, 255, 0.55)';
  ctx.lineWidth = 1;
  const dash = 6;
  const walk = (timeMs / 60) % (dash * 2);
  for (const [ax, ay, bx, by] of [[x, y, x + side, y], [x + side, y, x + side, y + side], [x + side, y + side, x, y + side], [x, y + side, x, y]] as const) {
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = -walk; d < len; d += dash * 2) {
      const s0 = Math.max(0, d) / len;
      const s1 = Math.min(len, d + dash) / len;
      if (s1 <= s0) continue;
      ctx.beginPath();
      ctx.moveTo(ax + (bx - ax) * s0, ay + (by - ay) * s0);
      ctx.lineTo(ax + (bx - ax) * s1, ay + (by - ay) * s1);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = CUT_WHITE;
  ctx.lineWidth = Math.max(1.5, 0.8 * z);
  const arm = side * 0.18;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + side, y, -1, 1], [x, y + side, 1, -1], [x + side, y + side, -1, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * arm);
    ctx.stroke();
  }
  ctx.restore();
}
