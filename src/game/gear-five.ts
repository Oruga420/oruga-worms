/**
 * Gear 5's look: the pieces the renderer lays over the worm and around it while it devours. The
 * worm turns white as the drums of liberation beat and bounces like rubber on every beat; the sun
 * god's rays spin behind it; a cloud of white steam wraps its neck and flares up past its head
 * like hair; and the straw hat pops on the moment it awakens. The rubber arm is a wobbling white
 * band with a fist on the end, and the mouth a giant white head whose jaws, full of teeth, close
 * on every bite under two red ringed eyes.
 *
 * Two halves: timing helpers that turn a devour's stage into how white, how open and how big
 * (world units, unit tested), and screen space drawers the renderer places (render.ts).
 */

import { TWO_PI, clamp } from '../core/math.ts';
import type { Ctx2D } from '../engine/canvas-types.ts';
import { msToTicks } from '../config/units.ts';
import { WORM_HEIGHT } from '../sim/constants.ts';
import { BURP_AT, devourProgress, drumTicks } from '../sim/devour.ts';
import type { DevourBody } from '../sim/types.ts';

export const GEAR_WHITE = '#fbfbff';
export const GEAR_OUTLINE = '#6c6480';
const CLOUD_EDGE = '#cdc3ee';
const MOUTH_DARK = '#4a0010';
const TONGUE = '#e0607a';
const EYE_RING = '#e0182d';
const STRAW = '#f2c14e';
const STRAW_SHADE = '#b9892a';
const HAT_BAND = '#d0312d';

/** The giant head that opens to eat: its centre ahead of and above the worm's feet, and its full radius, world px. */
export const MOUTH_CENTRE_AHEAD_PX = 7;
export const MOUTH_CENTRE_LIFT_PX = WORM_HEIGHT * 0.95;
export const MOUTH_RADIUS_PX = 12;

function ticksFor(ms: number): number {
  return Math.max(1, msToTicks(ms));
}

function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 0..1: how white the worm is. It whitens through the awakening, stays white to the end of the meal, and wears off in the recovery. */
export function gearWhiteness(devour: DevourBody): number {
  const p = devourProgress(devour);
  switch (devour.stage) {
    case 'awaken':
      return 0.9 * ease(p * 1.15);
    case 'recover':
      return 1 - ease((p - 0.55) / 0.45);
    default:
      return 1;
  }
}

/**
 * The rubber bounce of the last drum beat: 1 on the beat, then a damped swing through negative
 * and back to 0 about two thirds of a second later. 0 outside the awakening or before the first beat.
 */
export function drumBounce(devour: DevourBody): number {
  if (devour.stage !== 'awaken') return 0;
  let since = Infinity;
  for (const t of drumTicks(devour.spec)) if (t <= devour.stageTicks) since = devour.stageTicks - t;
  if (!Number.isFinite(since) || since > 40) return 0;
  return Math.exp(-since / 7) * Math.cos(since / 2.3);
}

/** 0..1: the halo of rays behind the worm, rising with the awakening and fading as the white wears off. */
export function haloStrength(devour: DevourBody): number {
  const p = devourProgress(devour);
  if (devour.stage === 'awaken') return ease(p) * 0.8 + Math.max(0, drumBounce(devour)) * 0.2;
  if (devour.stage === 'recover') return 1 - ease(p / 0.8);
  return 1;
}

/** The straw hat's size, 0 before the awakening: it pops on bigger than life and settles. */
export function hatScale(devour: DevourBody): number {
  if (devour.stage === 'awaken') return 0;
  if (devour.stage === 'stretch') {
    const t = devour.stageTicks;
    return 1 + 0.6 * Math.exp(-t / 5) * Math.cos(t / 1.8);
  }
  return 1;
}

/** The giant head: how grown it is (0..1) and how far the jaws are open (half angle, radians). */
export interface MouthState {
  readonly grow: number;
  readonly open: number;
}

/**
 * The jaws on a bite's rhythm: shut on the bite itself, wide open again a quarter of the way to
 * the next one, and closing for it over the last quarter.
 */
function biteOpening(devour: DevourBody): number {
  const interval = ticksFor(devour.spec.chompIntervalMs);
  const since = Math.max(0, devour.stageTicks - 1) % interval;
  const shut = 0.06;
  const wide = 0.9;
  if (since < interval * 0.25) return shut + (wide - shut) * ease(since / (interval * 0.25));
  if (since < interval * 0.72) return wide;
  return wide - (wide - shut) * ease((since - interval * 0.72) / (interval * 0.28));
}

/** Null while there is no giant head: before the catch is reeled in, after a whiff, and once it has shrunk back. */
export function mouthState(devour: DevourBody): MouthState | null {
  if (devour.victimId === null) return null;
  const p = devourProgress(devour);
  switch (devour.stage) {
    case 'reel':
      return { grow: 0.35 + 0.65 * ease(p / 0.45), open: 0.95 * ease(p / 0.6) };
    case 'chew':
      return { grow: 1, open: biteOpening(devour) };
    case 'recover': {
      if (!devour.swallowed) return null;
      const grow = 1 - ease(p / 0.22);
      return grow <= 0.02 ? null : { grow, open: 0.05 };
    }
    default:
      return null;
  }
}

/** The swallowed worm going down: how far along the body (0 the neck, 1 the belly), until the burp. Null otherwise. */
export function lumpDown(devour: DevourBody): number | null {
  if (devour.stage !== 'recover' || !devour.swallowed || devour.burped) return null;
  const p = devourProgress(devour);
  return clamp((p - 0.12) / (BURP_AT - 0.12), 0, 1);
}

/** Builds an ellipse path (Ctx2D has none): drawn under a scale, restored before the fill so outlines stay even. */
function ellipsePath(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.restore();
}

function disc(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TWO_PI);
  ctx.fill();
}

/** The sun god's halo: rays spinning slowly behind the worm, white and gold, over a soft glow. */
export function drawSunHalo(ctx: Ctx2D, cx: number, cy: number, z: number, strength: number, timeMs: number): void {
  if (strength <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 3; i >= 1; i -= 1) {
    ctx.globalAlpha = strength * 0.09;
    ctx.fillStyle = '#ffffff';
    disc(ctx, cx, cy, (7 + i * 6) * z);
  }
  const rays = 16;
  const spin = timeMs / 2600;
  const inner = 5 * z;
  const outer = (34 + Math.sin(timeMs / 280) * 5) * z * (0.55 + 0.45 * strength);
  for (let i = 0; i < rays; i += 1) {
    const a = spin + (i / rays) * TWO_PI;
    const long = i % 2 === 0;
    const reach = outer * (long ? 1 : 0.7);
    const half = long ? 0.08 : 0.06;
    ctx.globalAlpha = strength * (long ? 0.34 : 0.22);
    ctx.fillStyle = long ? '#fff8d6' : '#ffd95e';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a - half) * inner, cy + Math.sin(a - half) * inner);
    ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
    ctx.lineTo(cx + Math.cos(a + half) * inner, cy + Math.sin(a + half) * inner);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Gear 5's cloud: puffs of white steam in a collar round the neck, and wisps flaring up past the
 * head like white hair, drifting back from the way the worm faces. neck and head are screen points.
 */
export function drawCloudScarf(ctx: Ctx2D, neckX: number, neckY: number, headY: number, z: number, strength: number, facing: 1 | -1, timeMs: number): void {
  if (strength <= 0.01) return;
  ctx.save();
  const puffs = 8;
  const wisps = 5;
  for (const pass of ['edge', 'fill'] as const) {
    ctx.fillStyle = pass === 'edge' ? CLOUD_EDGE : GEAR_WHITE;
    const pad = pass === 'edge' ? 0.55 * z : 0;
    ctx.globalAlpha = strength;
    for (let i = 0; i < puffs; i += 1) {
      const a = (i / puffs) * TWO_PI + timeMs / 1100;
      const r = (1.5 + Math.sin(timeMs / 170 + i * 1.9) * 0.35) * z * strength;
      disc(ctx, neckX + Math.cos(a) * 5 * z, neckY + Math.sin(a) * 1.6 * z, r + pad);
    }
    for (let i = 0; i < wisps; i += 1) {
      const t = (timeMs / 760 + i / wisps) % 1;
      const x = neckX + (i - (wisps - 1) / 2) * 1.3 * z - facing * t * 3 * z + Math.sin(timeMs / 210 + i * 2.3) * 0.9 * z;
      const y = headY + 1 * z - t * 8 * z;
      ctx.globalAlpha = strength * (1 - t);
      disc(ctx, x, y, (1.9 - t * 1.1) * z * strength + pad);
    }
  }
  ctx.restore();
}

/** Luffy's straw hat, its brim centred at (x, y): a wide straw brim, a round crown and the red band. */
export function drawStrawHat(ctx: Ctx2D, x: number, y: number, z: number, scale: number, tilt: number, alpha = 1): void {
  if (scale <= 0.01 || alpha <= 0.01) return;
  const s = z * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.lineWidth = Math.max(1, 0.45 * s);
  ctx.strokeStyle = STRAW_SHADE;
  // The brim first, then the crown standing on it, then the red band round the crown's foot.
  ellipsePath(ctx, 0, 0, 6.3 * s, 1.4 * s);
  ctx.fillStyle = STRAW;
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.scale(3.2 * s, 2.8 * s);
  ctx.beginPath();
  ctx.arc(0, 0, 1, Math.PI, TWO_PI);
  ctx.closePath();
  ctx.restore();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = HAT_BAND;
  ctx.fillRect(-3 * s, -1.1 * s, 6 * s, 0.9 * s);
  ctx.restore();
}

/**
 * The rubber arm: a white band from the shoulder to the hand that ripples as it stretches, built
 * from overlapping discs so it is round at both ends, and a fist on the end. Screen space.
 */
export function drawRubberArm(ctx: Ctx2D, sx: number, sy: number, hx: number, hy: number, z: number, timeMs: number): void {
  const dx = hx - sx;
  const dy = hy - sy;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.max(6, Math.ceil(len / (1.4 * z)));
  const amp = Math.min(2.6 * z, len * 0.06);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const wave = Math.sin(u * Math.PI * 3 - timeMs / 45) * Math.sin(u * Math.PI) * amp;
    points.push({ x: sx + dx * u + nx * wave, y: sy + dy * u + ny * wave });
  }
  const r = 1.6 * z;
  ctx.save();
  ctx.fillStyle = GEAR_OUTLINE;
  for (const p of points) disc(ctx, p.x, p.y, r + 0.6 * z);
  disc(ctx, hx, hy, 3.4 * z + 0.6 * z);
  ctx.fillStyle = GEAR_WHITE;
  for (const p of points) disc(ctx, p.x, p.y, r);
  disc(ctx, hx, hy, 3.4 * z);
  // Knuckles on the fist, toward the way it flies.
  const ux = dx / len;
  const uy = dy / len;
  ctx.fillStyle = CLOUD_EDGE;
  for (const k of [-1, 0, 1]) disc(ctx, hx + ux * 2.2 * z + nx * k * 1.4 * z, hy + uy * 2.2 * z + ny * k * 1.4 * z, 0.75 * z);
  ctx.restore();
}

/** The giant head in screen space: centre, radius, the jaws' half angle, and which way they open. */
export interface MouthLook {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly open: number;
  /** Radians: 0 faces right, PI faces left. */
  readonly dir: number;
}

function wedge(ctx: Ctx2D, m: MouthLook, r: number): void {
  ctx.beginPath();
  ctx.moveTo(m.cx, m.cy);
  ctx.arc(m.cx, m.cy, r, m.dir - m.open, m.dir + m.open);
  ctx.closePath();
}

/** The throat behind the meal: the dark inside of the open jaws and the tongue. */
export function drawMouthInside(ctx: Ctx2D, m: MouthLook): void {
  if (m.open <= 0.02) return;
  ctx.save();
  ctx.fillStyle = MOUTH_DARK;
  wedge(ctx, m, m.r * 0.97);
  ctx.fill();
  if (m.open > 0.2) {
    ctx.fillStyle = TONGUE;
    ellipsePath(ctx, m.cx + Math.cos(m.dir) * m.r * 0.5, m.cy + Math.sin(m.dir) * m.r * 0.5 + m.r * 0.12, m.r * 0.34, m.r * 0.13);
    ctx.fill();
  }
  ctx.restore();
}

/** The head itself: a white disc with the jaws cut out of it, outlined, over whatever is in the mouth. */
export function drawMouthHead(ctx: Ctx2D, m: MouthLook, z: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(m.cx, m.cy);
  ctx.arc(m.cx, m.cy, m.r, m.dir + m.open, m.dir - m.open + TWO_PI);
  ctx.closePath();
  ctx.fillStyle = GEAR_WHITE;
  ctx.fill();
  ctx.strokeStyle = GEAR_OUTLINE;
  ctx.lineWidth = Math.max(1, 0.8 * z);
  ctx.stroke();
  ctx.restore();
}

/** Teeth along both jaws, pointing into the mouth, and two bulging eyes with Gear 5's red rings, looking at the meal. */
export function drawMouthFace(ctx: Ctx2D, m: MouthLook, z: number, facing: 1 | -1): void {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = GEAR_OUTLINE;
  ctx.lineWidth = Math.max(0.6, 0.35 * z);
  const bite = Math.min(0.32, m.open * 0.8 + 0.08);
  for (const side of [-1, 1] as const) {
    const edge = m.dir + side * m.open;
    for (let k = 0; k < 3; k += 1) {
      const d0 = m.r * (0.42 + k * 0.19);
      const d1 = d0 + m.r * 0.15;
      const tip = edge - side * bite;
      const dm = (d0 + d1) / 2;
      ctx.beginPath();
      ctx.moveTo(m.cx + Math.cos(edge) * d0, m.cy + Math.sin(edge) * d0);
      ctx.lineTo(m.cx + Math.cos(tip) * dm, m.cy + Math.sin(tip) * dm);
      ctx.lineTo(m.cx + Math.cos(edge) * d1, m.cy + Math.sin(edge) * d1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  const eyes = [
    { x: m.cx - facing * m.r * 0.05, y: m.cy - m.r * 0.56, r: m.r * 0.24 },
    { x: m.cx + facing * m.r * 0.4, y: m.cy - m.r * 0.5, r: m.r * 0.21 },
  ];
  for (const eye of eyes) {
    ctx.fillStyle = '#ffffff';
    disc(ctx, eye.x, eye.y, eye.r);
    ctx.lineWidth = Math.max(0.8, 0.5 * z);
    ctx.strokeStyle = GEAR_OUTLINE;
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, eye.r, 0, TWO_PI);
    ctx.stroke();
    ctx.strokeStyle = EYE_RING;
    ctx.lineWidth = Math.max(0.8, eye.r * 0.22);
    ctx.beginPath();
    ctx.arc(eye.x + facing * eye.r * 0.12, eye.y + eye.r * 0.1, eye.r * 0.58, 0, TWO_PI);
    ctx.stroke();
    ctx.fillStyle = '#111111';
    disc(ctx, eye.x + facing * eye.r * 0.16, eye.y + eye.r * 0.14, eye.r * 0.3);
  }
  ctx.restore();
}

/** The swallowed worm going down: a white lump pushing the body out. */
export function drawLump(ctx: Ctx2D, x: number, y: number, r: number, z: number): void {
  ctx.save();
  ctx.fillStyle = GEAR_OUTLINE;
  disc(ctx, x, y, r + 0.6 * z);
  ctx.fillStyle = GEAR_WHITE;
  disc(ctx, x, y, r);
  ctx.restore();
}
