/**
 * Drawing kit shared by the supers' looks (freezer.ts, the techniques of the anime row): soft glows,
 * glints, discs and rings, in screen space, plus the easing they time things with. Nothing here
 * knows about the sim; every function draws what it is told where it is told.
 */

import { TWO_PI, clamp } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';

/** Smoothstep on 0..1, clamped. */
export function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function disc(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TWO_PI);
  ctx.fill();
}

export function ring(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TWO_PI);
  ctx.stroke();
}

/** Discs in a glow: enough that the steps between them do not read as rings. */
const GLOW_STEPS = 8;

/** A soft round glow: discs from wide and faint to small and bright, added on top of what is there. */
export function glow(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number): void {
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

/** A pointed glint, the sparkle on a light: `points` long rays round (x, y). */
export function glint(ctx: Ctx2D, x: number, y: number, r: number, rotation: number, points = 4): void {
  const w = r * 0.18;
  ctx.beginPath();
  for (let i = 0; i < points; i += 1) {
    const a = rotation + (i / points) * TWO_PI;
    const b = a + TWO_PI / (points * 2);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(b) * w, y + Math.sin(b) * w);
  }
  ctx.closePath();
  ctx.fill();
}

/** A thick glowing line from a to b: a wide faint band under a narrow bright one, rounded at the ends. */
export function glowLine(ctx: Ctx2D, ax: number, ay: number, bx: number, by: number, width: number, color: string, core: string, alpha: number): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [w, c, a] of [[width * 2.4, color, 0.25], [width * 1.4, color, 0.55], [width * 0.55, core, 0.95]] as const) {
    ctx.globalAlpha = alpha * a;
    ctx.strokeStyle = c;
    ctx.lineWidth = Math.max(0.5, w);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = c;
    disc(ctx, ax, ay, w / 2);
    disc(ctx, bx, by, w / 2);
  }
  ctx.restore();
}

/**
 * A quadratic curve from (x0, y0) through the control point to (x1, y1), as line segments: Ctx2D has
 * no curves (the test doubles record what the engine draws with). The path must already be at
 * (x0, y0).
 */
export function quadTo(ctx: Ctx2D, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, steps = 6): void {
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    ctx.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
  }
}

/** A filled ellipse round (x, y), built from a scaled arc (Ctx2D has no ellipse). */
export function oval(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  ctx.save();
  ctx.translate(x, y);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.scale(Math.max(0.01, rx), Math.max(0.01, ry));
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.restore();
  ctx.fill();
}
