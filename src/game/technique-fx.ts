/**
 * The effects of the anime row's techniques (the scenes themselves are drawn in render.ts): the
 * names called out over the screen as each one starts and lands, the sparks, rings and flashes of
 * their beats, what they shed as they play (petals, stardust, embers, magic motes), and the cubes
 * the Santoryu cuts the land into, which tumble down, bounce on what is left and are gone.
 *
 * Driven by the controller's technique events through applyFxEvents and stepped by advanceFx, on
 * the fx clock like everything else in fx.ts. Presentation only.
 */

import { TWO_PI, clamp } from '../core/math.ts';
import { shakeOffset, type Camera } from '../engine/camera.ts';
import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { WORM_HEIGHT } from '../sim/constants.ts';
import { galaxyAt } from '../sim/techniques/galaxy.ts';
import { hikenAt } from '../sim/techniques/hiken.ts';
import type { DiceCell } from '../sim/types.ts';
import type { SimWorld } from '../sim/world.ts';
import { isSolid } from '../terrain/queries.ts';
import { DEFAULT_THEME } from '../terrain/terrain.ts';
import type { GameEvent } from './controller.ts';
import type { FxDeps, FxState } from './fx.ts';
import { initPuff, initSpark, outlinedText, pop } from './fx-kit.ts';
import { SCARLET, SCARLET_SOFT, starAt } from './antares.ts';
import { COSMOS_BLUE, COSMOS_PINK, COSMOS_VIOLET } from './galaxian.ts';
import { FIRE_ORANGE, FIRE_RED, FIRE_YELLOW } from './hiken.ts';
import { GRAVITY_PURPLE } from './meteor.ts';
import { CUT_BLUE, CUT_WHITE } from './santoryu.ts';
import { TREASURE_GOLD, TREASURE_LIGHT } from './tenbu.ts';
import { MAGIC_BLUE, MAGIC_WHITE } from './zoltraak.ts';

/** A name called over the screen: big letters, a smaller line under them, for a while. */
export interface TechniqueCall {
  readonly text: string;
  readonly sub: string | null;
  readonly at: number;
  readonly ms: number;
  readonly fill: string;
  readonly outline: string;
  /** Height on screen as a share of the viewport's (a phone's sits lower, under its buttons). */
  readonly y: number;
  /** Letter size as a share of the viewport's width. */
  readonly size: number;
}

/** A cube of land the Santoryu cut loose, world px, falling until it rests and then fading. */
export interface Cube {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly size: number;
  rotation: number;
  spin: number;
  readonly surface: boolean;
  resting: boolean;
  /** Seconds left. */
  life: number;
}

/** How long a name stays on the screen, ms. */
export const TECHNIQUE_CALL_MS = 1500;
/** How long a cube lasts, seconds, and the last stretch of it in which it fades. */
export const CUBE_LIFE_S = 2.6;
const CUBE_FADE_S = 0.8;
const CUBE_GRAVITY = 560;

/** The senses the Tesoro del Cielo takes, in order, one a strike; the last strike takes what is left. */
export const SENSES: readonly string[] = Object.freeze(['TACTO', 'GUSTO', 'OLFATO', 'OÍDO', 'VISTA']);

/** The names called as each technique starts: what it is, and whose it is. */
const NAMES: Readonly<Record<string, { readonly text: string; readonly sub: string; readonly fill: string; readonly outline: string }>> = Object.freeze({
  needle: { text: '¡AGUJA ESCARLATA!', sub: 'MILO DE ESCORPIO', fill: '#ff4d64', outline: '#2a0008' },
  galaxy: { text: '¡EXPLOSIÓN DE GALAXIAS!', sub: 'SAGA DE GÉMINIS', fill: '#d7b8ff', outline: '#1a0638' },
  treasure: { text: 'TESORO DEL CIELO', sub: 'SHAKA DE VIRGO', fill: TREASURE_GOLD, outline: '#3a2600' },
  hiken: { text: 'HI...', sub: 'PORTGAS D. ACE', fill: FIRE_YELLOW, outline: '#3a0a00' },
  meteor: { text: 'METEORITO', sub: 'FUJITORA', fill: '#d9c8ff', outline: '#1c0a3a' },
  dice: { text: 'SANTORYU', sub: 'RORONOA ZORO', fill: '#e9fff1', outline: '#0b3a1c' },
  zoltraak: { text: 'ZOLTRAAK', sub: 'FRIEREN', fill: MAGIC_WHITE, outline: '#0a2a4a' },
});

/** Calls a name over the screen; it takes the place of the one before, so two never sit on top of each other. */
function call(fx: FxState, text: string, sub: string | null, fill: string, outline: string, y = 0.26, size = 1, ms = TECHNIQUE_CALL_MS): void {
  fx.calls.length = 0;
  fx.calls.push({ text, sub, at: fx.now, ms, fill, outline, y, size });
}

/** Sparks out of (x, y) every way, in turn through the colours given. */
function sparks(deps: FxDeps, x: number, y: number, count: number, speedMin: number, speedMax: number, colors: readonly string[], life: number): void {
  for (let i = 0; i < count; i += 1) {
    const a = deps.rng.nextFloat(0, TWO_PI);
    const speed = deps.rng.nextFloat(speedMin, speedMax);
    const color = colors[i % colors.length] ?? '#ffffff';
    deps.particles.spawn((p) => initSpark(p, x, y, Math.cos(a) * speed, Math.sin(a) * speed, deps.rng, color, life));
  }
}

function ring(fx: FxState, x: number, y: number, radius: number, color: string): void {
  fx.rings.push({ x, y, radius, bornAt: fx.now, color });
}

function flash(fx: FxState, deps: FxDeps, x: number, y: number, strength: number, color: string, ms: number): void {
  if (deps.onScreen(x, y)) fx.screenFlash = { at: fx.now, strength, color, ms };
}

/** The cubes the land in the square fell apart into, thrown loose from where they were. */
function throwCubes(fx: FxState, cells: readonly DiceCell[], deps: FxDeps, cx: number, cy: number): void {
  for (const cell of cells) {
    const x = cell.x + cell.size / 2;
    const y = cell.y + cell.size / 2;
    const away = Math.atan2(y - cy, x - cx);
    const push = deps.rng.nextFloat(20, 90);
    fx.cubes.push({
      x,
      y,
      vx: Math.cos(away) * push + deps.rng.nextFloat(-25, 25),
      vy: Math.sin(away) * push - deps.rng.nextFloat(40, 140),
      size: cell.size * deps.rng.nextFloat(0.82, 0.95),
      rotation: 0,
      spin: deps.rng.nextFloat(-5, 5),
      surface: cell.surface,
      resting: false,
      life: CUBE_LIFE_S + deps.rng.nextFloat(-0.4, 0.4),
    });
  }
}

/** One technique event: the names, and the sparks, rings and flashes of its beats. */
export function onTechnique(fx: FxState, e: Extract<GameEvent, { type: 'techniqueStart' | 'techniqueBeat' | 'techniqueEnd' }>, deps: FxDeps): void {
  if (e.type === 'techniqueStart') {
    const name = NAMES[e.kind];
    if (name === undefined) return;
    // A strike of the treasure on a sealed turn says which strike it is, and is gone before the bite.
    if (e.strike !== undefined) {
      if (!fx.calls.some((c) => c.text === name.text && fx.now - c.at < 200)) call(fx, name.text, `GOLPE ${e.strike}`, name.fill, name.outline, 0.22, 0.8, 1000);
      return;
    }
    call(fx, name.text, name.sub, name.fill, name.outline, 0.24, e.kind === 'galaxy' ? 0.85 : 1);
    return;
  }
  if (e.type === 'techniqueEnd') {
    if (!e.landed && (e.kind === 'needle' || e.kind === 'treasure')) call(fx, 'MISS', null, '#d8d8d8', '#202020', 0.4, 0.6, 1100);
    return;
  }
  const { x, y } = e;
  switch (e.beat) {
    // Antares
    case 'sting': {
      const star = starAt(e.n - 1, x, y);
      sparks(deps, star.x, star.y, 5, 30, 110, [SCARLET, SCARLET_SOFT, '#ffffff'], 0.3);
      if (e.n % 7 === 0 && deps.onScreen(x, y)) fx.redPulse = { at: fx.now, strength: 0.35 };
      return;
    }
    case 'antares': {
      ring(fx, x, y, 44, SCARLET);
      ring(fx, x, y, 24, '#ffffff');
      sparks(deps, x, y, 34, 90, 360, [SCARLET, SCARLET_SOFT, '#ffffff'], 0.55);
      flash(fx, deps, x, y, 0.75, '#ff4d64', 300);
      call(fx, '¡ANTARES!', null, '#ff2a45', '#1a0004', 0.3, 1.2, 1600);
      return;
    }
    case 'fizzle':
      ring(fx, x, y, 12, SCARLET_SOFT);
      sparks(deps, x, y, 8, 20, 80, [SCARLET, SCARLET_SOFT], 0.35);
      return;
    // The Galaxian Explosion, the Hiken
    case 'release':
      if (e.kind === 'galaxy') {
        sparks(deps, x, y, 26, 80, 300, [COSMOS_VIOLET, COSMOS_PINK, COSMOS_BLUE, '#ffffff'], 0.5);
        flash(fx, deps, x, y, 0.5, '#e6d4ff', 260);
      } else {
        sparks(deps, x, y, 22, 90, 320, [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW], 0.45);
        ring(fx, x, y, 26, FIRE_ORANGE);
        call(fx, '¡HIKEN!', 'PUÑO DE FUEGO', FIRE_YELLOW, '#3a0a00', 0.26, 1.35, 1300);
      }
      return;
    case 'burst':
      if (e.kind === 'galaxy') {
        ring(fx, x, y, 90, COSMOS_VIOLET);
        ring(fx, x, y, 60, COSMOS_PINK);
        ring(fx, x, y, 34, '#ffffff');
        sparks(deps, x, y, 70, 120, 520, [COSMOS_VIOLET, COSMOS_PINK, COSMOS_BLUE, '#ffffff'], 0.8);
        flash(fx, deps, x, y, 0.95, '#efe2ff', 450);
        if (e.n > 1) pop(fx, `×${e.n}`, x, y - 40, 22, '#f2e6ff', '#1a0638', 0.1, 1400);
      } else if (e.kind === 'hiken') {
        ring(fx, x, y, 64, FIRE_ORANGE);
        sparks(deps, x, y, 46, 120, 420, [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW, '#fff6d6'], 0.6);
        flash(fx, deps, x, y, 0.55, '#ffb35c', 280);
      } else if (e.kind === 'meteor') {
        ring(fx, x, y, 120, FIRE_ORANGE);
        ring(fx, x, y, 70, '#fff0c8');
        sparks(deps, x, y, 60, 140, 560, [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW, '#d9c8ff'], 0.8);
        for (let i = 0; i < 14; i += 1) deps.particles.spawn((p) => initPuff(p, x + deps.rng.nextFloat(-40, 40), y + deps.rng.nextFloat(-10, 10), deps.rng, 5, '#8a7a6a', 40));
        flash(fx, deps, x, y, 0.85, '#ffd9a0', 420);
        if (deps.onScreen(x, y)) fx.redPulse = { at: fx.now, strength: 0.6 };
      }
      return;
    // The Tesoro del Cielo
    case 'wheel':
      ring(fx, x, y, 34, TREASURE_GOLD);
      sparks(deps, x, y, 20, 40, 180, [TREASURE_GOLD, TREASURE_LIGHT, '#ffffff'], 0.6);
      return;
    case 'seal':
      ring(fx, x, y, 22, TREASURE_LIGHT);
      pop(fx, '¡SELLADO!', x, y - WORM_HEIGHT * 2.2, 16, TREASURE_GOLD, '#3a2600', 0, 1700);
      call(fx, `${e.n} TURNOS SIN JUGAR`, null, TREASURE_LIGHT, '#3a2600', 0.6, 0.55, 1500);
      flash(fx, deps, x, y, 0.4, '#fff3c0', 260);
      return;
    case 'miss':
      sparks(deps, x, y, 10, 20, 90, [TREASURE_GOLD, TREASURE_LIGHT], 0.4);
      return;
    case 'sense':
      ring(fx, x, y, 30, TREASURE_GOLD);
      sparks(deps, x, y, 24, 50, 200, [TREASURE_GOLD, TREASURE_LIGHT, '#ffffff'], 0.55);
      pop(fx, `−${SENSES[(e.n - 1) % SENSES.length] ?? 'SENTIDO'}`, x, y - WORM_HEIGHT * 2.2, 15, TREASURE_GOLD, '#3a2600', 0, 1700);
      flash(fx, deps, x, y, 0.45, '#fff3c0', 240);
      return;
    case 'nirvana':
      ring(fx, x, y, 70, TREASURE_GOLD);
      ring(fx, x, y, 40, '#ffffff');
      sparks(deps, x, y, 50, 80, 400, [TREASURE_GOLD, TREASURE_LIGHT, '#ff9fc8', '#ffffff'], 0.8);
      flash(fx, deps, x, y, 0.9, '#fff6d6', 420);
      call(fx, '¡SIN SENTIDOS!', null, TREASURE_GOLD, '#3a2600', 0.3, 1.2, 1700);
      return;
    // The Hiken's arm, Fujitora's call
    case 'flare':
      sparks(deps, x, y, 10, 40, 140, [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW], 0.4);
      return;
    case 'call':
      ring(fx, x, y, 40, GRAVITY_PURPLE);
      return;
    case 'fall':
      return;
    // The Santoryu
    case 'draw':
      sparks(deps, x, y - WORM_HEIGHT * 0.6, 8, 30, 120, [CUT_WHITE, CUT_BLUE], 0.3);
      return;
    case 'slash':
      sparks(deps, x, y, 6, 60, 220, [CUT_WHITE, CUT_BLUE], 0.25);
      return;
    case 'cut':
      ring(fx, x, y, 70, CUT_WHITE);
      flash(fx, deps, x, y, 0.7, '#f4fbff', 260);
      throwCubes(fx, e.cells ?? [], deps, x, y);
      for (let i = 0; i < 12; i += 1) deps.particles.spawn((p) => initPuff(p, x + deps.rng.nextFloat(-30, 30), y + deps.rng.nextFloat(-30, 30), deps.rng, 3, '#a07a52', 20));
      call(fx, '¡TODO EN CUBOS!', null, '#e9fff1', '#0b3a1c', 0.3, 0.95, 1500);
      return;
    // Zoltraak
    case 'circle':
      ring(fx, x, y, 18, MAGIC_BLUE);
      sparks(deps, x, y, 8, 20, 90, [MAGIC_WHITE, MAGIC_BLUE], 0.4);
      return;
    case 'beam':
      ring(fx, x, y, 20, MAGIC_WHITE);
      sparks(deps, x, y, 12, 60, 240, [MAGIC_WHITE, MAGIC_BLUE], 0.4);
      if (e.n === 1) flash(fx, deps, x, y, 0.35, '#e6f6ff', 200);
      return;
  }
}

/** What the live techniques shed every tick: petals, stardust, embers, smoke and magic motes. */
export function emitTechniqueFx(world: SimWorld, deps: FxDeps): void {
  for (const body of world.techniques ?? []) {
    if (!body.alive) continue;
    switch (body.kind) {
      case 'galaxy': {
        if (body.stage === 'charge' && deps.rng.next() < 0.7) {
          // Stars drawn in toward the hands.
          const a = deps.rng.nextFloat(0, TWO_PI);
          const d = deps.rng.nextFloat(30, 60);
          const sx = body.x0 + Math.cos(a) * d;
          const sy = body.y0 + Math.sin(a) * d;
          deps.particles.spawn((p) => initSpark(p, sx, sy, (body.x0 - sx) * 3, (body.y0 - sy) * 3, deps.rng, deps.rng.next() < 0.5 ? COSMOS_VIOLET : '#ffffff', 0.3));
        }
        const at = galaxyAt(body);
        if (at !== null) for (let i = 0; i < 2; i += 1) deps.particles.spawn((p) => initSpark(p, at.x, at.y, -body.dx * 60 + deps.rng.nextFloat(-40, 40), -body.dy * 60 + deps.rng.nextFloat(-40, 40), deps.rng, [COSMOS_VIOLET, COSMOS_PINK, COSMOS_BLUE, '#ffffff'][i + (deps.rng.next() < 0.5 ? 0 : 2)] ?? '#ffffff', 0.5));
        break;
      }
      case 'treasure':
        if (body.mode === 'cast' && body.stage === 'cast' && deps.rng.next() < 0.35) {
          const px = body.holdX + deps.rng.nextFloat(-30, 30);
          deps.particles.spawn((p) => {
            initSpark(p, px, body.holdY - deps.rng.nextFloat(30, 50), deps.rng.nextFloat(-15, 15), deps.rng.nextFloat(10, 30), deps.rng, deps.rng.next() < 0.6 ? '#fff0f6' : '#ff9fc8', 1.4);
            p.gravityScale = 0.05;
            p.drag = 0.4;
          });
        }
        if (body.stage === 'strike' && deps.rng.next() < 0.5) {
          const a = deps.rng.nextFloat(0, TWO_PI);
          deps.particles.spawn((p) => initSpark(p, body.targetX + Math.cos(a) * 14, body.targetY - WORM_HEIGHT * 0.6 + Math.sin(a) * 14, -Math.cos(a) * 30, -Math.sin(a) * 30 - 20, deps.rng, TREASURE_GOLD, 0.5));
        }
        break;
      case 'hiken': {
        if (body.stage === 'windup' && deps.rng.next() < 0.6) {
          const hx = body.holdX + body.facing * 6;
          deps.particles.spawn((p) => initSpark(p, hx, body.holdY - WORM_HEIGHT * 0.6, deps.rng.nextFloat(-20, 20), deps.rng.nextFloat(-80, -30), deps.rng, deps.rng.next() < 0.5 ? FIRE_ORANGE : FIRE_YELLOW, 0.35));
        }
        const at = hikenAt(body);
        if (at !== null) for (let i = 0; i < 3; i += 1) deps.particles.spawn((p) => initSpark(p, at.x, at.y, -body.dx * 120 + deps.rng.nextFloat(-50, 50), -body.dy * 120 + deps.rng.nextFloat(-60, 20), deps.rng, [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW][i] ?? FIRE_ORANGE, 0.4));
        break;
      }
      case 'meteor':
        if (body.stage === 'fall') {
          for (let i = 0; i < 3; i += 1) deps.particles.spawn((p) => initSpark(p, body.x, body.y, -body.dx * 90 + deps.rng.nextFloat(-50, 50), -body.dy * 90 + deps.rng.nextFloat(-50, 50), deps.rng, [FIRE_RED, FIRE_ORANGE, FIRE_YELLOW][i] ?? FIRE_ORANGE, 0.5));
          if (deps.rng.next() < 0.5) deps.particles.spawn((p) => initPuff(p, body.x - body.dx * 10, body.y - body.dy * 10, deps.rng, 3.5, '#5a524c', 10));
        }
        break;
      case 'zoltraak':
        if (body.stage === 'form') {
          for (const circle of body.circles.slice(0, body.opened)) {
            if (deps.rng.next() < 0.25) deps.particles.spawn((p) => initSpark(p, circle.x + deps.rng.nextFloat(-8, 8), circle.y + deps.rng.nextFloat(-8, 8), 0, deps.rng.nextFloat(-30, -10), deps.rng, deps.rng.next() < 0.5 ? MAGIC_BLUE : MAGIC_WHITE, 0.45));
          }
        }
        break;
      default:
        break;
    }
  }
}

/** One step of the cubes: they fall, tumble, bounce off what land is left and lie still, then fade. */
export function stepCubes(fx: FxState, dtMs: number, world: SimWorld | null): void {
  const dt = dtMs / 1000;
  for (let i = fx.cubes.length - 1; i >= 0; i -= 1) {
    const cube = fx.cubes[i];
    if (cube === undefined) continue;
    cube.life -= dt;
    if (cube.life <= 0 || (world !== null && cube.y > world.terrain.water.y + 6)) {
      fx.cubes.splice(i, 1);
      continue;
    }
    if (cube.resting) continue;
    cube.vy += CUBE_GRAVITY * dt;
    const nx = cube.x + cube.vx * dt;
    const ny = cube.y + cube.vy * dt;
    const below = world !== null && isSolid(world.terrain.mask, nx, ny + cube.size / 2);
    if (below && cube.vy > 0) {
      cube.vy = -cube.vy * 0.3;
      cube.vx *= 0.6;
      cube.spin *= 0.5;
      if (Math.abs(cube.vy) < 40) {
        cube.resting = true;
        cube.vx = 0;
        cube.vy = 0;
        cube.spin = 0;
      }
    } else {
      cube.x = nx;
      cube.y = ny;
    }
    cube.rotation += cube.spin * dt;
  }
}

/** The cubes, world space through the camera: a block of land, grass on top when it was the surface. */
export function drawCubes(ctx: Ctx2D, fx: FxState, camera: Camera, viewport: Size): void {
  if (fx.cubes.length === 0) return;
  const shake = shakeOffset(camera.shake);
  const z = camera.zoom;
  const ox = viewport.w / 2 - (camera.x + shake.x) * z;
  const oy = viewport.h / 2 - (camera.y + shake.y) * z;
  const theme = DEFAULT_THEME;
  for (const cube of fx.cubes) {
    const s = cube.size * z;
    ctx.save();
    ctx.globalAlpha = clamp(cube.life / CUBE_FADE_S, 0, 1);
    ctx.translate(cube.x * z + ox, cube.y * z + oy);
    if (cube.rotation !== 0) ctx.rotate(cube.rotation);
    ctx.fillStyle = theme.outline;
    ctx.fillRect(-s / 2 - 0.6, -s / 2 - 0.6, s + 1.2, s + 1.2);
    ctx.fillStyle = cube.surface ? theme.topsoil : theme.land;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    if (cube.surface) {
      ctx.fillStyle = theme.grass;
      ctx.fillRect(-s / 2, -s / 2, s, s * 0.32);
    }
    // A clean cut face: a lighter edge on two sides.
    ctx.fillStyle = 'rgba(255, 236, 200, 0.25)';
    ctx.fillRect(-s / 2, -s / 2, s, Math.max(1, s * 0.08));
    ctx.fillRect(-s / 2, -s / 2, Math.max(1, s * 0.08), s);
    ctx.restore();
  }
}

/**
 * The names called over the screen, newest on top: slammed in big, the line under them small, and
 * faded out at the end. On a phone smaller and lower, under the row of buttons along the top.
 */
export function drawTechniqueCalls(ctx: Ctx2D, fx: FxState, viewport: Size, touch: boolean): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of fx.calls) {
    const t = (fx.now - c.at) / c.ms;
    if (t < 0 || t >= 1) continue;
    const grow = 1 + Math.max(0, 0.15 - t) * 3;
    const size = Math.round((touch ? clamp(viewport.w / 16, 22, 64) : clamp(viewport.w / 14, 26, 84)) * c.size * grow);
    ctx.globalAlpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    const y = viewport.h * (touch ? c.y + 0.12 : c.y);
    ctx.font = `italic 900 ${size}px system-ui, sans-serif`;
    outlinedText(ctx, c.text, viewport.w / 2, y, c.fill, c.outline, Math.max(2, size / 16));
    if (c.sub !== null) {
      ctx.font = `bold ${Math.round(clamp(viewport.w / 60, 11, 18))}px system-ui, sans-serif`;
      outlinedText(ctx, c.sub, viewport.w / 2, y + size * 0.62, '#ffffff', c.outline, 2);
    }
  }
  ctx.globalAlpha = 1;
}
