/**
 * The comic book layer: the supers told like a comic, in black and white ink with one loud colour.
 *
 * - A super starts, and a panel slams in over the top of the screen: the worm drawn big in ink,
 *   speed lines behind it, its power gathering in the move's colour (the Kamehameha's blue ball
 *   between its hands, Gear 5's white sun, the Freezer's pink finger), a yellow caption box
 *   ("RAÚL CARGA SU PODER...") and the move's name in a jagged burst.
 * - A super that costs health gets a panel of its own: the worm clutching itself, PENITENCIA.
 * - The big blows splash across the screen: POW!, ¡ÑAM!, HAAA!!!, SPLAT! in a starburst of the
 *   move's colour with a black ink shadow and ink drops round it.
 * - A worm picked by name gets ¡YO TE ELIJO!; a worm walking on command counts its steps over its
 *   head (1! 2! 3!); a worm told to let the AI shoot shows it calculating: the reticle clicks from
 *   enemy to enemy, the numbers roll in a panel, the dotted line finds its mark, BLANCO FIJADO, and
 *   the worm shouts its line in a speech bubble.
 *
 * Presentation only, on its own clock advanced by the fixed tick like fx.ts, so it stops with the
 * pause. Nothing here is read by the sim or the match. Drawn with the plain Ctx2D primitives.
 *
 * MUTATION NOTE: ComicState's lists are mutated in place every tick and pruned as they expire.
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { TICK_MS } from '../config/units.ts';
import { shakeOffset, type Camera } from '../engine/camera.ts';
import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import type { SimWorld } from '../sim/world.ts';
import { getWeapon, isWeaponId } from '../weapons/registry.ts';
import type { TechniqueKind } from '../weapons/types.ts';
import type { GameEvent } from './controller.ts';
import { outlinedText } from './fx-kit.ts';

export const INK = '#111111';
export const PAPER = '#fbfaf4';
export const CAPTION = '#ffe14d';

export type Pose = 'charge' | 'dash' | 'awaken' | 'point' | 'plant' | 'pain' | 'pick' | 'think' | 'power' | 'slash';

export interface Panel {
  readonly pose: Pose;
  readonly title: string;
  readonly caption: string;
  readonly accent: string;
  readonly bornAt: number;
  readonly ms: number;
  /** -1 left of the screen, 1 right. */
  readonly side: -1 | 1;
  readonly seed: number;
}

export interface Splat {
  readonly text: string;
  readonly accent: string;
  /** Screen fraction 0..1. */
  readonly fx: number;
  readonly fy: number;
  readonly size: number;
  readonly tilt: number;
  readonly bornAt: number;
  readonly ms: number;
  readonly seed: number;
}

export interface StepCount {
  readonly wormId: string;
  readonly n: number;
  readonly total: number;
  readonly x: number;
  readonly y: number;
  readonly bornAt: number;
}

export interface Scan {
  readonly wormId: string;
  readonly name: string;
  readonly weaponName: string;
  readonly targets: readonly { readonly id: string; readonly x: number; readonly y: number }[];
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly angleDeg: number;
  readonly power: number;
  readonly confidence: number;
  readonly bornAt: number;
  readonly ms: number;
  readonly x: number;
  readonly y: number;
  /** Hops already clicked, so each click plays once. */
  clicks: number;
  locked: boolean;
}

export interface Bubble {
  readonly wormId: string;
  readonly text: string;
  readonly bornAt: number;
  readonly ms: number;
  readonly delay: number;
}

export interface ComicState {
  now: number;
  readonly panels: Panel[];
  readonly splats: Splat[];
  readonly steps: StepCount[];
  readonly scans: Scan[];
  readonly bubbles: Bubble[];
  /** Sound cues for the game loop to play (the clicks of the calculating reticle). */
  readonly cues: string[];
  seed: number;
  /** Blows of the running super move, so only some get a splat. */
  comboBlows: number;
  panelSide: -1 | 1;
}

export const PANEL_MS = 1500;
export const SPLAT_MS = 720;
export const STEP_MS = 800;
export const BUBBLE_MS = 2600;
const POP_IN_MS = 170;
const FADE_MS = 220;
/** At most this many panels up at once; a newer one pushes the oldest out. */
const MAX_PANELS = 2;
const MAX_SPLATS = 5;

export function createComic(): ComicState {
  return { now: 0, panels: [], splats: [], steps: [], scans: [], bubbles: [], cues: [], seed: 1, comboBlows: 0, panelSide: 1 };
}

/** A small deterministic hash so a panel's speed lines and a splat's spikes keep their shape. */
function hash(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const TECHNIQUE_LOOK: Readonly<Record<TechniqueKind, { readonly pose: Pose; readonly title: string; readonly accent: string; readonly cry: string; readonly hit: string }>> = Object.freeze({
  needle: { pose: 'point', title: '¡AGUJA ESCARLATA!', accent: '#e5132f', cry: 'APUNTA A LAS ESTRELLAS...', hit: '¡ANTARES!' },
  galaxy: { pose: 'power', title: '¡EXPLOSIÓN DE GALAXIAS!', accent: '#7b3cff', cry: 'EL COSMOS SE ABRE...', hit: '¡KABOOM!' },
  treasure: { pose: 'think', title: '¡TESORO DEL CIELO!', accent: '#f2b705', cry: 'MEDITA EN LOTO...', hit: '¡SELLADO!' },
  hiken: { pose: 'dash', title: '¡HIKEN!', accent: '#ff6a00', cry: 'SU PUÑO ARDE...', hit: '¡FWOOOM!' },
  meteor: { pose: 'power', title: '¡METEORITO!', accent: '#a03cff', cry: 'LEVANTA LA ESPADA AL CIELO...', hit: '¡KRAKOOM!' },
  dice: { pose: 'slash', title: '¡SANTORYU!', accent: '#2fbf71', cry: 'TRES ESPADAS...', hit: '¡ZAS ZAS ZAS!' },
  zoltraak: { pose: 'point', title: '¡ZOLTRAAK!', accent: '#4fd2ff', cry: 'CÍRCULOS MÁGICOS...', hit: '¡ZZZAP!' },
  final: { pose: 'pain', title: '¡EXPLOSIÓN FINAL!', accent: '#ffcc00', cry: 'ADIÓS... TRUNKS', hit: '¡ADIÓS!' },
});

const BLOWS: readonly string[] = Object.freeze(['¡POW!', '¡BAM!', '¡WHAM!', '¡KRAK!', '¡ZAS!', '¡PAF!', '¡TOING!']);

export interface ComicLookup {
  nameOf(wormId: string): string;
}

function addPanel(c: ComicState, pose: Pose, title: string, caption: string, accent: string, ms = PANEL_MS): void {
  c.seed += 1;
  c.panelSide = c.panelSide === 1 ? -1 : 1;
  c.panels.push({ pose, title, caption, accent, bornAt: c.now, ms, side: c.panelSide, seed: c.seed });
  while (c.panels.length > MAX_PANELS) c.panels.shift();
}

function addSplat(c: ComicState, text: string, accent: string, size: number, at?: { readonly fx: number; readonly fy: number }): void {
  c.seed += 1;
  const s = c.seed;
  let fx = at?.fx ?? 0.3 + hash(s, 1) * 0.4;
  let fy = at?.fy ?? 0.42 + hash(s, 2) * 0.25;
  // Two splats on top of each other read as neither: step aside from the ones still up.
  for (let tries = 0; tries < 4 && c.splats.some((o) => c.now - o.bornAt < o.ms * 0.8 && Math.abs(o.fx - fx) < 0.22 && Math.abs(o.fy - fy) < 0.16); tries += 1) {
    fx = clamp(fx + (tries % 2 === 0 ? 0.26 : -0.52), 0.18, 0.82);
    fy = clamp(fy + 0.12, 0.3, 0.8);
  }
  c.splats.push({
    text,
    accent,
    fx,
    fy,
    size,
    tilt: (hash(s, 3) - 0.5) * 0.5,
    bornAt: c.now,
    ms: SPLAT_MS,
    seed: s,
  });
  while (c.splats.length > MAX_SPLATS) c.splats.shift();
}

/** A line the worm shouts, in a speech bubble over it; delayMs holds it back (until the AI is done). */
export function comicSay(c: ComicState, wormId: string, text: string, delayMs = 0): void {
  const trimmed = text.trim().slice(0, 80);
  if (trimmed === '') return;
  for (let i = c.bubbles.length - 1; i >= 0; i -= 1) if (c.bubbles[i]?.wormId === wormId) c.bubbles.splice(i, 1);
  c.bubbles.push({ wormId, text: trimmed, bornAt: c.now, ms: BUBBLE_MS + delayMs, delay: delayMs });
}

const upper = (s: string): string => s.toLocaleUpperCase('es');

export function applyComicEvents(c: ComicState, events: readonly GameEvent[], lookup: ComicLookup): void {
  for (const e of events) {
    switch (e.type) {
      case 'beamStart': {
        const name = upper(lookup.nameOf(e.attackerId));
        addPanel(c, 'charge', 'KA... ME... HA... ME...', `${name} CARGA SU PODER...`, '#19a7ff', 1700);
        break;
      }
      case 'beamFire':
        addSplat(c, '¡HAAAAA!', '#19a7ff', 1.5, { fx: 0.5, fy: 0.5 });
        break;
      case 'comboStart':
        c.comboBlows = 0;
        addPanel(c, 'dash', '¡RYUKO RANBU!', `${upper(lookup.nameOf(e.attackerId))} SE LANZA AL ATAQUE`, '#ff2a2a');
        break;
      case 'comboHit':
        c.comboBlows += 1;
        if (e.finisher) addSplat(c, e.ko ? '¡K.O.!' : '¡KRAKOOM!', '#ff2a2a', 1.6, { fx: 0.5, fy: 0.5 });
        else if (c.comboBlows % 4 === 1) addSplat(c, BLOWS[(c.comboBlows >> 2) % BLOWS.length] ?? '¡POW!', '#ff2a2a', 0.9);
        break;
      case 'devourStart':
        addPanel(c, 'awaken', '¡GEAR 5!', `DON! DON! DON! ${upper(lookup.nameOf(e.attackerId))} DESPIERTA`, '#ffd400', 1700);
        break;
      case 'devourBeat':
        if (e.beat === 'chomp' && e.n === 0) addSplat(c, '¡ÑAM!', '#ffd400', 1.1);
        else if (e.beat === 'gulp') addSplat(c, '¡GLUP!', '#ffd400', 1.3);
        break;
      case 'hexStart':
        addPanel(c, 'point', '¡FREEZER!', `${upper(lookup.nameOf(e.attackerId))} APUNTA CON EL DEDO...`, '#e040fb');
        break;
      case 'hexBeat':
        if (e.beat === 'burst') addSplat(c, '¡BOOOM!', '#e040fb', 1.6, { fx: 0.5, fy: 0.5 });
        break;
      case 'sproutStart':
        addPanel(c, 'plant', '¡SAIBAMAN!', `${upper(lookup.nameOf(e.planterId))} SIEMBRA LA SEMILLA...`, '#3ddc4a');
        break;
      case 'sproutEnd':
        if (e.wormId !== null) addSplat(c, '¡KEKEKE!', '#3ddc4a', 1.1);
        break;
      case 'techniqueStart': {
        // The Tesoro del Cielo's later strikes are not a new cast: only the cast gets its panel.
        if (e.strike !== undefined) break;
        const look = TECHNIQUE_LOOK[e.kind];
        addPanel(c, look.pose, look.title, `${upper(lookup.nameOf(e.attackerId))}: ${look.cry}`, look.accent, 1700);
        break;
      }
      case 'techniqueEnd':
        if (e.landed) addSplat(c, TECHNIQUE_LOOK[e.kind].hit, TECHNIQUE_LOOK[e.kind].accent, 1.4, { fx: 0.5, fy: 0.55 });
        break;
      case 'toll':
        addPanel(c, 'pain', e.fatal ? '¡SACRIFICIO!' : '¡PENITENCIA!', `${upper(lookup.nameOf(e.wormId))} PAGA ${e.lost} DE VIDA`, '#d10f2f', 1300);
        break;
      case 'gib':
        addSplat(c, '¡SPLAT!', '#d10f2f', 1.3);
        break;
      case 'damage':
        if (e.lost >= 40 && e.cause !== 'toll') addSplat(c, e.lost >= 70 ? '¡KABOOM!' : '¡BOOM!', '#ff4d1a', 1.05);
        break;
      case 'crateOpened':
        if (e.crate === 'power' && e.weapon !== null) addSplat(c, `¡+1 ${upper(getWeapon(e.weapon).name)}!`, '#ffb000', 0.9, { fx: 0.5, fy: 0.3 });
        break;
      case 'detonateOrder':
        addSplat(c, '¡BEEE-BOOM!', '#ff4d1a', 1.3, { fx: 0.5, fy: 0.45 });
        break;
      case 'wormPicked':
        addPanel(c, 'pick', '¡YO TE ELIJO!', `¡${upper(e.name)}, A LA BATALLA!`, '#ff7a00', 1400);
        break;
      case 'step':
        c.steps.push({ wormId: e.wormId, n: e.n, total: e.total, x: e.x, y: e.y, bornAt: c.now });
        break;
      case 'aiScan': {
        const ms = e.ticks * TICK_MS;
        const weaponName = isWeaponId(e.weapon) ? getWeapon(e.weapon).name : e.weapon;
        c.scans.push({
          wormId: e.wormId,
          name: e.name,
          weaponName,
          targets: e.targets,
          targetId: e.targetId,
          targetName: e.targetId === null ? null : lookup.nameOf(e.targetId),
          angleDeg: e.angleDeg,
          power: e.power,
          confidence: e.confidence,
          bornAt: c.now,
          ms,
          x: e.x,
          y: e.y,
          clicks: 0,
          locked: false,
        });
        addPanel(c, 'think', 'CALCULANDO...', `${upper(e.name)} ANALIZA LA BATALLA`, '#ff2a6d', ms);
        comicSay(c, e.wormId, e.message, ms * 0.8);
        break;
      }
      default:
        break;
    }
  }
}

/** Where the camera should look while the AI calculates: between the worm and the reticle. Null when nothing is calculating. */
export function scanFocus(c: ComicState, world: SimWorld): { readonly x: number; readonly y: number } | null {
  const scan = c.scans.find((s) => c.now - s.bornAt < s.ms);
  if (scan === undefined || scan.targets.length === 0) return null;
  const t = (c.now - scan.bornAt) / scan.ms;
  const hops = scanHops(scan);
  const target = t >= 0.75 ? (scan.targets.find((tg) => tg.id === scan.targetId) ?? scan.targets[0]) : scan.targets[Math.min(hops - 1, Math.floor(clamp(t / 0.72, 0, 0.999) * hops)) % scan.targets.length];
  const body = world.worms.find((b) => b.id === scan.wormId);
  if (target === undefined) return null;
  const fromX = body?.x ?? scan.x;
  const fromY = body?.y ?? scan.y;
  return { x: (fromX + target.x) / 2, y: (fromY + target.y) / 2 };
}

/** Hops of the reticle over the enemies before it settles. */
function scanHops(scan: Scan): number {
  return Math.max(3, Math.min(8, scan.targets.length * 2));
}

export function advanceComic(c: ComicState, dtMs: number): void {
  c.now += dtMs;
  for (const scan of c.scans) {
    const t = (c.now - scan.bornAt) / scan.ms;
    const hops = Math.floor(clamp(t / 0.72, 0, 1) * scanHops(scan));
    while (scan.clicks < hops) {
      scan.clicks += 1;
      c.cues.push('ui_select_click');
    }
    if (!scan.locked && t >= 0.75) {
      scan.locked = true;
      c.cues.push('ui_confirm');
      addSplat(c, '¡BLANCO FIJADO!', '#ff2a6d', 0.8, { fx: 0.5, fy: 0.62 });
    }
  }
  const keep = <T extends { readonly bornAt: number }>(list: T[], life: (item: T) => number): void => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i];
      if (item !== undefined && c.now - item.bornAt > life(item)) list.splice(i, 1);
    }
  };
  keep(c.panels, (p) => p.ms);
  keep(c.splats, (s) => s.ms);
  keep(c.steps, () => STEP_MS);
  keep(c.scans, (s) => s.ms + 900);
  keep(c.bubbles, (b) => b.ms);
}

export function drainComicCues(c: ComicState): string[] {
  return c.cues.splice(0, c.cues.length);
}

export function resetComic(c: ComicState): void {
  c.panels.length = 0;
  c.splats.length = 0;
  c.steps.length = 0;
  c.scans.length = 0;
  c.bubbles.length = 0;
  c.cues.length = 0;
  c.comboBlows = 0;
}

/** How far a thing has come in: 0 to a 1.15 overshoot and back to 1 over the pop. */
export function popScale(ageMs: number): number {
  if (ageMs <= 0) return 0;
  if (ageMs >= POP_IN_MS) return 1;
  const t = ageMs / POP_IN_MS;
  return t < 0.7 ? (t / 0.7) * 1.15 : 1.15 - ((t - 0.7) / 0.3) * 0.15;
}

function fadeOut(ageMs: number, lifeMs: number): number {
  return clamp((lifeMs - ageMs) / FADE_MS, 0, 1);
}

/** Bold comic lettering; size in px. */
function letters(ctx: Ctx2D, size: number): void {
  ctx.font = `italic 900 ${Math.round(size)}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

/** A jagged starburst path round (x, y): the comic's sound effect balloon. */
function burstPath(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, points: number, seed: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const a = (i / (points * 2)) * TWO_PI;
    const out = i % 2 === 0;
    const k = out ? 1 + hash(seed, i) * 0.35 : 0.62 + hash(seed, i) * 0.12;
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A rough ellipse as a polygon (Ctx2D has no ellipse). */
function ellipsePath(ctx: Ctx2D, x: number, y: number, rx: number, ry: number, rotation = 0): void {
  ctx.beginPath();
  const n = 28;
  const cr = Math.cos(rotation);
  const sr = Math.sin(rotation);
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * TWO_PI;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    const px = x + ex * cr - ey * sr;
    const py = y + ex * sr + ey * cr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Halftone: rows of ink dots growing toward the bottom of the rect, the comic's shading. */
function halftone(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string, step: number): void {
  ctx.fillStyle = color;
  for (let row = 0; row * step < h; row += 1) {
    const r = (step * 0.42 * row * step) / h;
    if (r < 0.4) continue;
    const off = row % 2 === 0 ? 0 : step / 2;
    for (let col = 0; col * step + off < w; col += 1) {
      ctx.beginPath();
      ctx.arc(x + col * step + off, y + row * step, r, 0, TWO_PI);
      ctx.fill();
    }
  }
}

/** Speed lines: black wedges rushing in at (cx, cy) from outside the rect. */
function speedLines(ctx: Ctx2D, cx: number, cy: number, reach: number, count: number, seed: number, t: number): void {
  ctx.fillStyle = INK;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TWO_PI + hash(seed, i) * 0.2 + t * 0.4;
    const inner = reach * (0.42 + hash(seed, i + 40) * 0.25);
    const width = 0.012 + hash(seed, i + 80) * 0.02;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a - width) * reach * 1.6, cy + Math.sin(a - width) * reach * 1.6);
    ctx.lineTo(cx + Math.cos(a + width) * reach * 1.6, cy + Math.sin(a + width) * reach * 1.6);
    ctx.closePath();
    ctx.fill();
  }
}

/** A thick ink stroke between two points with round ends. */
function inkLine(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, width: number, color = INK): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x0, y0, width / 2, 0, TWO_PI);
  ctx.arc(x1, y1, width / 2, 0, TWO_PI);
  ctx.fill();
}

/** The worm in ink, big, at (x, y) its feet, s its height, in a pose; t is the panel's age in s. */
function inkWorm(ctx: Ctx2D, x: number, y: number, s: number, pose: Pose, accent: string, t: number, facing: 1 | -1): void {
  const lean = pose === 'dash' ? 0.35 : pose === 'pain' ? -0.15 : pose === 'plant' ? 0.25 : 0;
  const crouch = pose === 'plant' ? 0.78 : pose === 'charge' ? 0.92 : 1;
  const r = s * 0.17;
  // The body: a column of discs from the tail to the head, bending with the lean.
  const segments = 7;
  const spine: { x: number; y: number }[] = [];
  for (let i = 0; i < segments; i += 1) {
    const k = i / (segments - 1);
    const bend = Math.sin(k * Math.PI * 0.9) * s * 0.12 * facing * -1 + lean * k * k * s * 0.5 * facing;
    spine.push({ x: x + bend + (i === 0 ? -facing * r * 0.9 : 0), y: y - r - k * (s * crouch - r * 2) });
  }
  // Outline pass then fill pass, so the discs read as one body.
  for (const [color, grow] of [[INK, r * 0.22], [PAPER, 0]] as const) {
    ctx.fillStyle = color;
    for (let i = 0; i < spine.length; i += 1) {
      const p = spine[i]!;
      const rr = r * (i === spine.length - 1 ? 1.25 : 1 - i * 0.025) + grow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, TWO_PI);
      ctx.fill();
    }
  }
  // Belly shading: halftone grey down one side.
  ctx.fillStyle = 'rgba(17,17,17,0.18)';
  for (let i = 0; i < spine.length - 1; i += 1) {
    const p = spine[i]!;
    ctx.beginPath();
    ctx.arc(p.x - facing * r * 0.45, p.y, r * 0.55, 0, TWO_PI);
    ctx.fill();
  }
  const head = spine[spine.length - 1]!;
  const hr = r * 1.25;
  // Headband in the move's colour, tails flying.
  ctx.fillStyle = accent;
  ctx.fillRect(head.x - hr, head.y - hr * 0.55, hr * 2, hr * 0.32);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.strokeRect(head.x - hr, head.y - hr * 0.55, hr * 2, hr * 0.32);
  const flutter = Math.sin(t * 18) * hr * 0.25;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(head.x - facing * hr, head.y - hr * 0.5);
  ctx.lineTo(head.x - facing * hr * 2.1, head.y - hr * 0.7 + flutter);
  ctx.lineTo(head.x - facing * hr * 1.9, head.y - hr * 0.2 + flutter);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Eyes: big, white, the pupils fierce (or squeezed shut in pain).
  for (const side of [-1, 1] as const) {
    const ex = head.x + facing * hr * 0.25 + side * hr * 0.38;
    const ey = head.y + hr * 0.05;
    if (pose === 'pain') {
      inkLine(ctx, ex - hr * 0.2, ey - hr * 0.1, ex + hr * 0.2, ey + hr * 0.1, Math.max(2, r * 0.12));
      inkLine(ctx, ex - hr * 0.2, ey + hr * 0.1, ex + hr * 0.2, ey - hr * 0.1, Math.max(2, r * 0.12));
      continue;
    }
    ctx.fillStyle = INK;
    ellipsePath(ctx, ex, ey, hr * 0.3, hr * 0.38);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ellipsePath(ctx, ex, ey, hr * 0.24, hr * 0.32);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(ex + facing * hr * 0.09, ey + hr * 0.04, hr * 0.12, 0, TWO_PI);
    ctx.fill();
    // Angry brows.
    inkLine(ctx, ex - hr * 0.26, ey - hr * 0.42 - side * facing * hr * 0.08, ex + hr * 0.26, ey - hr * 0.42 + side * facing * hr * 0.08, Math.max(2, r * 0.14));
  }
  // Mouth: a shout.
  ctx.fillStyle = INK;
  ellipsePath(ctx, head.x + facing * hr * 0.3, head.y + hr * 0.62, hr * 0.28, pose === 'think' ? hr * 0.06 : hr * 0.2);
  ctx.fill();
  // Arms and what they hold, by pose.
  const chest = spine[Math.floor(segments * 0.6)]!;
  const arm = Math.max(3, r * 0.32);
  const hand = (hx: number, hy: number): void => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(hx, hy, arm * 0.95, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(hx, hy, arm * 0.6, 0, TWO_PI);
    ctx.fill();
  };
  const glow = (gx: number, gy: number, radius: number): void => {
    const pulse = 1 + Math.sin(t * 22) * 0.08;
    ctx.fillStyle = INK;
    burstPath(ctx, gx, gy, radius * 1.35 * pulse, radius * 1.35 * pulse, 12, 7);
    ctx.fill();
    ctx.fillStyle = accent;
    burstPath(ctx, gx, gy, radius * 1.2 * pulse, radius * 1.2 * pulse, 12, 7);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gx, gy, radius * 0.55 * pulse, 0, TWO_PI);
    ctx.fill();
  };
  switch (pose) {
    case 'charge': {
      // Hands cupped at the hip, the ball growing between them.
      const hx = chest.x - facing * r * 1.4;
      const hy = chest.y + r * 0.9;
      const grow = clamp(t / 1.2, 0.2, 1);
      glow(hx, hy, r * 1.1 * grow);
      inkLine(ctx, chest.x, chest.y, hx, hy - arm, arm);
      inkLine(ctx, chest.x, chest.y + r * 0.3, hx, hy + arm, arm);
      hand(hx, hy - arm * 1.1);
      hand(hx, hy + arm * 1.1);
      break;
    }
    case 'dash':
    case 'slash': {
      const hx = chest.x + facing * r * 2.6;
      inkLine(ctx, chest.x, chest.y, hx, chest.y - r * 0.4, arm);
      hand(hx, chest.y - r * 0.4);
      if (pose === 'slash') {
        for (let i = 0; i < 3; i += 1) inkLine(ctx, hx, chest.y - r * 0.4, hx + facing * r * (2 + i * 0.4), chest.y - r * (2.4 - i * 1.6), Math.max(2, r * 0.18), i === 1 ? accent : INK);
      } else {
        glow(hx + facing * r * 0.5, chest.y - r * 0.4, r * 0.6);
      }
      // Motion streaks behind.
      for (let i = 0; i < 4; i += 1) inkLine(ctx, x - facing * s * (0.35 + i * 0.05), y - s * (0.25 + i * 0.15), x - facing * s * (0.75 + i * 0.08), y - s * (0.25 + i * 0.15), Math.max(1.5, r * 0.1));
      break;
    }
    case 'awaken':
    case 'power': {
      for (const side of [-1, 1] as const) {
        const hx = chest.x + side * r * 1.8;
        const hy = head.y - hr * 1.6;
        inkLine(ctx, chest.x, chest.y, hx, hy, arm);
        hand(hx, hy);
      }
      glow(head.x, head.y - hr * 2.6, r * (pose === 'awaken' ? 1.3 : 0.9));
      break;
    }
    case 'point': {
      const hx = chest.x + facing * r * 2.8;
      const hy = chest.y - r * 1.2;
      inkLine(ctx, chest.x, chest.y, hx, hy, arm);
      hand(hx, hy);
      inkLine(ctx, hx, hy, hx + facing * arm * 2.2, hy - arm * 0.6, arm * 0.6);
      glow(hx + facing * arm * 3.2, hy - arm * 0.9, r * 0.45);
      break;
    }
    case 'plant': {
      const hx = chest.x + facing * r * 1.6;
      inkLine(ctx, chest.x, chest.y, hx, y - arm, arm);
      hand(hx, y - arm);
      glow(hx + facing * r * 0.3, y, r * 0.5);
      break;
    }
    case 'pain': {
      for (const side of [-1, 1] as const) {
        inkLine(ctx, chest.x, chest.y, chest.x + side * r * 0.9, chest.y + r * 0.7, arm);
        hand(chest.x + side * r * 0.9, chest.y + r * 0.7);
      }
      // Drops of red where its life leaves it.
      ctx.fillStyle = accent;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TWO_PI + t * 2;
        ctx.beginPath();
        ctx.arc(chest.x + Math.cos(a) * r * 2.4, chest.y + Math.sin(a) * r * 2 - ((t * 60) % (r * 2)), r * 0.22, 0, TWO_PI);
        ctx.fill();
      }
      break;
    }
    case 'pick': {
      const hx = chest.x + facing * r * 2.2;
      const hy = head.y - hr * 0.6;
      inkLine(ctx, chest.x, chest.y, hx, hy, arm);
      hand(hx, hy);
      inkLine(ctx, hx, hy, hx, hy - arm * 2, arm * 0.7);
      break;
    }
    case 'think': {
      const hx = head.x + facing * hr * 0.5;
      const hy = head.y + hr * 1.2;
      inkLine(ctx, chest.x, chest.y, hx, hy, arm);
      hand(hx, hy);
      break;
    }
  }
}

/** Text over several lines, wrapped at about maxChars a line. */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines.slice(0, 4);
}

function rollingNumber(final: number, t: number, seed: number, lockAt: number): number {
  if (t >= lockAt) return final;
  return Math.round(hash(seed, Math.floor(t * 30)) * 99);
}

function drawPanel(ctx: Ctx2D, c: ComicState, panel: Panel, viewport: Size, touch: boolean): void {
  const age = c.now - panel.bornAt;
  const scale = popScale(age);
  const alpha = fadeOut(age, panel.ms);
  if (scale <= 0 || alpha <= 0) return;
  const t = age / 1000;
  const w = Math.min(viewport.w * (touch ? 0.62 : 0.4), 440);
  const h = w * 0.62;
  const margin = Math.max(12, viewport.w * 0.02);
  const cx = panel.side < 0 ? margin + w / 2 : viewport.w - margin - w / 2;
  const cy = Math.max(70, viewport.h * 0.09) + h / 2 + (touch ? 40 : 0);
  const slide = (1 - Math.min(1, age / POP_IN_MS)) * panel.side * w * 0.6;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx + slide, cy);
  ctx.rotate(panel.side * -0.035);
  ctx.scale(scale, scale);
  const x = -w / 2;
  const y = -h / 2;
  // The drop shadow and the border.
  ctx.fillStyle = INK;
  ctx.fillRect(x + 7, y + 7, w, h);
  ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, w, h);
  // Inside the frame: halftone, the speed lines, the colour burst, the worm.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  clipTo(ctx);
  halftone(ctx, x, y + h * 0.35, w, h * 0.65, 'rgba(17,17,17,0.35)', Math.max(6, w / 46));
  const focusX = x + w * (panel.side < 0 ? 0.62 : 0.38);
  const focusY = y + h * 0.58;
  speedLines(ctx, focusX, focusY, w * 0.62, 34, panel.seed, panel.pose === 'dash' ? t : 0);
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = panel.accent;
  burstPath(ctx, focusX, focusY, w * 0.26 * (1 + Math.sin(t * 9) * 0.04), h * 0.42, 14, panel.seed);
  ctx.fill();
  ctx.globalAlpha = alpha;
  inkWorm(ctx, focusX, y + h * 0.98, h * 0.78, panel.pose, panel.accent, t, panel.side < 0 ? 1 : -1);
  if (panel.pose === 'think') drawThinking(ctx, c, x, y, w, h, panel);
  ctx.restore();
  // The caption box, top left, and the move's name in its burst, bottom right.
  const capSize = Math.max(10, w * 0.034);
  ctx.font = `900 ${Math.round(capSize)}px "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const capLines = wrapLines(panel.caption, 26);
  const capW = Math.min(w * 0.62, Math.max(...capLines.map((l) => l.length)) * capSize * 0.62 + capSize * 1.2);
  const capH = capLines.length * capSize * 1.25 + capSize * 0.6;
  ctx.fillStyle = INK;
  ctx.fillRect(x - 2, y - 2, capW + 4, capH + 4);
  ctx.fillStyle = CAPTION;
  ctx.fillRect(x, y, capW, capH);
  ctx.fillStyle = INK;
  capLines.forEach((l, i) => ctx.fillText(l, x + capSize * 0.5, y + capSize * 0.9 + i * capSize * 1.25, capW - capSize));
  const titleSize = Math.max(12, Math.min(w * 0.085, (w * 1.15) / Math.max(1, panel.title.length)));
  letters(ctx, titleSize);
  // The burst's spikes reach a third past its radius: it stays inside the frame.
  const tw = Math.min(w * 0.34, panel.title.length * titleSize * 0.3 + titleSize * 0.6);
  const tx = clamp(x + w * (panel.side < 0 ? 0.3 : 0.7), x + tw * 1.3, x + w - tw * 1.3);
  const ty = y + h * 0.82;
  ctx.fillStyle = INK;
  burstPath(ctx, tx + 4, ty + 4, tw, titleSize * 1.15, 11, panel.seed + 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  burstPath(ctx, tx, ty, tw, titleSize * 1.15, 11, panel.seed + 3);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(-0.06);
  outlinedText(ctx, panel.title, 0, 0, panel.accent, INK, Math.max(2, titleSize * 0.07));
  ctx.restore();
  ctx.restore();
}

/** Ctx2D has no clip: it is there on the real canvas, used when it is. */
function clipTo(ctx: Ctx2D): void {
  const clip = (ctx as Ctx2D & { clip?: () => void }).clip;
  if (typeof clip === 'function') clip.call(ctx);
}

/** The AI's numbers rolling inside the CALCULANDO panel, then settling on the shot. */
function drawThinking(ctx: Ctx2D, c: ComicState, x: number, y: number, w: number, h: number, panel: Panel): void {
  const scan = c.scans.find((s) => s.bornAt === panel.bornAt);
  if (scan === undefined) return;
  const t = (c.now - scan.bornAt) / scan.ms;
  const size = Math.max(10, w * 0.045);
  ctx.font = `900 ${Math.round(size)}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const lx = x + (panel.side < 0 ? w * 0.04 : w * 0.56);
  const rows = [
    `ÁNGULO   ${String(rollingNumber(Math.round(scan.angleDeg), t, scan.bornAt, 0.55)).padStart(3)}°`,
    `POTENCIA ${String(rollingNumber(Math.round(scan.power * 100), t, scan.bornAt + 1, 0.65)).padStart(3)}%`,
    `OBJETIVO ${t >= 0.75 ? upper(scan.targetName ?? '???') : '#'.repeat(1 + (Math.floor(t * 20) % 6))}`,
  ];
  rows.forEach((row, i) => {
    const ry = y + h * 0.28 + i * size * 1.5;
    ctx.fillStyle = INK;
    ctx.fillRect(lx - 4, ry - size * 0.7, w * 0.4, size * 1.4);
    ctx.fillStyle = i === 2 && t >= 0.75 ? '#ff2a6d' : '#7dff7a';
    ctx.fillText(row, lx, ry, w * 0.4 - 8);
  });
}

function drawSplat(ctx: Ctx2D, c: ComicState, splat: Splat, viewport: Size): void {
  const age = c.now - splat.bornAt;
  const scale = popScale(age) * (1 + (age / splat.ms) * 0.12);
  const alpha = fadeOut(age, splat.ms);
  if (scale <= 0 || alpha <= 0) return;
  const base = Math.min(viewport.w, viewport.h) * 0.085 * splat.size;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(splat.fx * viewport.w, splat.fy * viewport.h);
  ctx.rotate(splat.tilt);
  ctx.scale(scale, scale);
  const rx = Math.max(base * 1.4, splat.text.length * base * 0.36);
  const ry = base * 1.25;
  // Ink drops flung round it.
  ctx.fillStyle = INK;
  for (let i = 0; i < 7; i += 1) {
    const a = hash(splat.seed, i + 10) * TWO_PI;
    const d = 1.25 + hash(splat.seed, i + 20) * 0.5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rx * d, Math.sin(a) * ry * d, base * (0.06 + hash(splat.seed, i + 30) * 0.1), 0, TWO_PI);
    ctx.fill();
  }
  burstPath(ctx, base * 0.12, base * 0.14, rx * 1.08, ry * 1.08, 13, splat.seed);
  ctx.fill();
  ctx.fillStyle = splat.accent;
  burstPath(ctx, 0, 0, rx, ry, 13, splat.seed);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  burstPath(ctx, 0, 0, rx * 0.72, ry * 0.62, 13, splat.seed + 1);
  ctx.globalAlpha = alpha * 0.35;
  ctx.fill();
  ctx.globalAlpha = alpha;
  letters(ctx, base);
  outlinedText(ctx, splat.text, 0, 0, '#ffffff', INK, Math.max(2.5, base * 0.08));
  ctx.restore();
}

/** Screen space: the panels and the splats, over everything in the world. */
export function drawComicScreen(ctx: Ctx2D, c: ComicState, viewport: Size, options: { readonly touch?: boolean } = {}): void {
  for (const panel of c.panels) drawPanel(ctx, c, panel, viewport, options.touch === true);
  for (const splat of c.splats) drawSplat(ctx, c, splat, viewport);
}

function toScreen(camera: Camera, viewport: Size): (x: number, y: number) => { x: number; y: number } {
  const shake = shakeOffset(camera.shake);
  const z = camera.zoom;
  return (x, y) => ({ x: viewport.w / 2 + (x - camera.x - shake.x) * z, y: viewport.h / 2 + (y - camera.y - shake.y) * z });
}

function reticle(ctx: Ctx2D, x: number, y: number, r: number, spin: number, color: string, locked: boolean): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.stroke();
  for (let i = 0; i < 4; i += 1) {
    const a = spin + (i * Math.PI) / 2;
    inkLine(ctx, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45, 5);
    inkLine(ctx, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4, 2.5, color);
  }
  if (locked) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.18, 0, TWO_PI);
    ctx.fill();
  }
}

/** World anchored: the step counts, the AI's reticle and its dotted line, the speech bubbles. */
export function drawComicWorld(ctx: Ctx2D, c: ComicState, camera: Camera, viewport: Size, world: SimWorld): void {
  const at = toScreen(camera, viewport);
  const z = camera.zoom;
  for (const step of c.steps) {
    const age = c.now - step.bornAt;
    const p = at(step.x, step.y);
    const rise = (age / STEP_MS) * 26;
    ctx.save();
    ctx.globalAlpha = fadeOut(age, STEP_MS);
    ctx.translate(p.x, p.y - 18 - rise);
    const s = popScale(age);
    ctx.scale(s, s);
    letters(ctx, 30);
    ctx.fillStyle = INK;
    burstPath(ctx, 2, 3, 30, 22, 9, step.n * 31);
    ctx.fill();
    ctx.fillStyle = step.n === step.total ? '#ff2a6d' : CAPTION;
    burstPath(ctx, 0, 0, 28, 20, 9, step.n * 31);
    ctx.fill();
    outlinedText(ctx, `${step.n}!`, 0, 1, '#ffffff', INK, 2.5);
    letters(ctx, 11);
    outlinedText(ctx, `PASO ${step.n}/${step.total}`, 0, 30, '#ffffff', INK, 2);
    ctx.restore();
  }
  for (const scan of c.scans) {
    const age = c.now - scan.bornAt;
    const t = age / scan.ms;
    const fade = t > 1 ? clamp(1 - (age - scan.ms) / 900, 0, 1) : 1;
    if (fade <= 0 || scan.targets.length === 0) continue;
    const hops = scanHops(scan);
    const hop = Math.min(hops - 1, Math.floor(clamp(t / 0.72, 0, 0.999) * hops));
    const locked = t >= 0.75;
    const target = locked ? (scan.targets.find((tg) => tg.id === scan.targetId) ?? scan.targets[0]) : scan.targets[hop % scan.targets.length];
    if (target === undefined) continue;
    const body = world.worms.find((b) => b.id === scan.wormId);
    const from = at(body?.x ?? scan.x, (body?.y ?? scan.y) - 14);
    const to = at(target.x, target.y);
    ctx.save();
    ctx.globalAlpha = fade;
    // The dotted line reaching out to the reticle.
    const reach = locked ? 1 : clamp(((t / 0.72) * hops) % 1, 0, 1);
    const dots = 18;
    for (let i = 1; i <= dots * reach; i += 1) {
      const k = i / dots;
      const lift = Math.sin(k * Math.PI) * Math.min(120, Math.abs(to.x - from.x) * 0.25) * (scan.angleDeg > 20 ? 1 : 0.2);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - lift, 4, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = locked ? '#ff2a6d' : '#ffffff';
      ctx.beginPath();
      ctx.arc(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - lift, 2.4, 0, TWO_PI);
      ctx.fill();
    }
    const r = Math.max(14, 12 * z) * (locked ? 1 + Math.max(0, 0.4 - (t - 0.75) * 3) : 1);
    reticle(ctx, to.x, to.y, r, age / 300, locked ? '#ff2a6d' : '#ffe14d', locked);
    letters(ctx, 16);
    if (!locked) {
      // Each hop says CLIC by the reticle.
      ctx.save();
      ctx.translate(to.x + r * 1.3, to.y - r * 1.2);
      ctx.rotate(-0.2);
      outlinedText(ctx, '¡CLIC!', 0, 0, '#ffffff', INK, 2);
      ctx.restore();
    } else {
      outlinedText(ctx, upper(scan.targetName ?? 'BLANCO'), to.x, to.y - r * 1.9, '#ff2a6d', INK, 2.5);
    }
    ctx.restore();
  }
  for (const bubble of c.bubbles) {
    const age = c.now - bubble.bornAt - bubble.delay;
    if (age < 0) continue;
    const body = world.worms.find((b) => b.id === bubble.wormId);
    if (body === undefined || !body.alive) continue;
    const p = at(body.x, body.y - 26);
    const lines = wrapLines(upper(bubble.text), 20);
    const size = 15;
    const w = Math.max(...lines.map((l) => l.length)) * size * 0.62 + 24;
    const h = lines.length * size * 1.2 + 16;
    const bx = clamp(p.x - w / 2, 8, viewport.w - w - 8);
    const by = Math.max(8, p.y - h - 34);
    const s = popScale(age);
    ctx.save();
    ctx.globalAlpha = fadeOut(age, bubble.ms - bubble.delay);
    ctx.translate(bx + w / 2, by + h / 2);
    ctx.scale(s, s);
    ctx.translate(-(bx + w / 2), -(by + h / 2));
    // The tail to the worm's mouth, then the balloon.
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(p.x - 12, by + h - 4);
    ctx.lineTo(p.x + 2, p.y - 6);
    ctx.lineTo(p.x + 14, by + h - 4);
    ctx.closePath();
    ctx.fill();
    ellipsePath(ctx, bx + w / 2, by + h / 2, w / 2 + 6, h / 2 + 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ellipsePath(ctx, bx + w / 2, by + h / 2, w / 2 + 2, h / 2 + 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x - 8, by + h - 6);
    ctx.lineTo(p.x + 2, p.y - 11);
    ctx.lineTo(p.x + 9, by + h - 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    lines.forEach((l, i) => ctx.fillText(l, bx + w / 2, by + 8 + size * 0.6 + i * size * 1.2));
    ctx.restore();
  }
}
