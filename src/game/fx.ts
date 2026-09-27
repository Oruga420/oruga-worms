/**
 * Presentation effects and animation cues (no sim state): the controller's GameEvents land here
 * and become the beats the eye reads. A hurt worm grimaces and flashes, a gun kicks and flashes
 * at the muzzle and spits a casing, bullets leave tracers, blows leave swing arcs, blasts get a
 * flash and a shock ring, damage floats up as numbers, drowned worms sink with bubbles, rockets
 * trail smoke, and a super move gets its name card, its hit counter and its K.O. The gore layer
 * (gore.ts) gets the blood of every hit from here too.
 *
 * Everything runs on its own clock advanced by the fixed tick (advanceFx), so the effects are as
 * deterministic as the sim and stop when the game pauses.
 *
 * MUTATION NOTE: FxState is a presentation device like the particle pool: its lists are mutated
 * in place every tick and pruned as effects expire. Nothing here is read by the sim or the match.
 */

import { TWO_PI, clamp, degToRad } from '../core/math.ts';
import type { Rng } from '../core/rng.ts';
import { shakeOffset, type Camera } from '../engine/camera.ts';
import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { alphaCurve, type Particle, type ParticleSystem } from '../engine/particles.ts';
import { drawSprite } from '../engine/sprite.ts';
import { WORM_HEIGHT } from '../sim/constants.ts';
import type { SimWorld } from '../sim/world.ts';
import { WEAPONS, getWeapon, isWeaponId } from '../weapons/registry.ts';
import type { WeaponId } from '../weapons/types.ts';
import type { GameEvent } from './controller.ts';
import { bloodBurst, dripFrom, ejectCasing, gibBurst, splatterLens, type GoreSystem } from './gore.ts';
import type { CharacterSprites } from './render.ts';

export const TRACER_MS = 90;
export const MUZZLE_MS = 70;
export const RING_MS = 320;
export const SWING_MS = 230;
export const NUMBER_MS = 1500;
/** Hits on the same worm this close together add up in one number, as Worms counts health down. */
export const NUMBER_MERGE_MS = 650;
export const SINK_MS = 1800;
export const SUPER_CARD_MS = 1100;
export const KO_MS = 2000;
export const COMBO_HUD_LINGER_MS = 1400;

export interface WormFxTimers {
  hurtAt: number;
  hurtAmount: number;
  firedAt: number;
  firedWeapon: WeaponId | null;
  swingAt: number;
  landedAt: number;
  landSpeed: number;
  switchedAt: number;
  weapon: WeaponId | null;
  /** Radians turned since the worm was thrown, integrated tick by tick; 0 once it is down. */
  tumble: number;
}

/** What the renderer needs to pose one worm: ms since each beat, Infinity when it never happened. */
export interface WormAnim {
  readonly hurtMs: number;
  readonly hurtAmount: number;
  readonly firedMs: number;
  readonly firedWeapon: WeaponId | null;
  readonly swingMs: number;
  readonly landedMs: number;
  readonly landSpeed: number;
  readonly switchedMs: number;
  /** How far a thrown worm has turned, radians. */
  readonly tumble: number;
}

export interface DamageNumber {
  readonly wormId: string;
  amount: number;
  x: number;
  y: number;
  bornAt: number;
  lastAt: number;
}

export interface Tracer {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly bornAt: number;
  readonly hit: 'worm' | 'land' | 'none';
}

export interface Flash {
  readonly x: number;
  readonly y: number;
  /** Radians, screen convention (0 is right, positive is down). */
  readonly angle: number;
  readonly size: number;
  readonly bornAt: number;
  readonly kind: 'muzzle' | 'impact' | 'blast';
}

export interface Ring {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly bornAt: number;
  readonly color: string;
}

export interface Swing {
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  readonly bornAt: number;
  readonly fiery: boolean;
}

export interface Sinker {
  readonly wormId: string;
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  readonly colorIndex: number;
  readonly bornAt: number;
}

export interface ComboShow {
  readonly comboId: number;
  /** The super being played, for its name card. */
  readonly weapon: string;
  readonly attackerId: string;
  readonly victimId: string | null;
  readonly startedAt: number;
  hits: number;
  lastHitAt: number;
  finisherAt: number | null;
  ko: boolean;
  endedAt: number | null;
}

export interface FxState {
  now: number;
  readonly worms: Map<string, WormFxTimers>;
  readonly numbers: DamageNumber[];
  readonly tracers: Tracer[];
  readonly flashes: Flash[];
  readonly rings: Ring[];
  readonly swings: Swing[];
  readonly sinkers: Sinker[];
  combo: ComboShow | null;
  /** A full screen flash: white for the super, colour and strength per event. */
  screenFlash: { readonly at: number; readonly strength: number; readonly color: string; readonly ms: number } | null;
  /** Red at the screen's edges after a heavy hit. */
  redPulse: { readonly at: number; readonly strength: number } | null;
}

export function createFx(): FxState {
  return { now: 0, worms: new Map(), numbers: [], tracers: [], flashes: [], rings: [], swings: [], sinkers: [], combo: null, screenFlash: null, redPulse: null };
}

function timersOf(fx: FxState, wormId: string): WormFxTimers {
  let timers = fx.worms.get(wormId);
  if (timers === undefined) {
    timers = { hurtAt: -Infinity, hurtAmount: 0, firedAt: -Infinity, firedWeapon: null, swingAt: -Infinity, landedAt: -Infinity, landSpeed: 0, switchedAt: -Infinity, weapon: null, tumble: 0 };
    fx.worms.set(wormId, timers);
  }
  return timers;
}

export function wormAnim(fx: FxState, wormId: string): WormAnim | undefined {
  const t = fx.worms.get(wormId);
  if (t === undefined) return undefined;
  return {
    hurtMs: fx.now - t.hurtAt,
    hurtAmount: t.hurtAmount,
    firedMs: fx.now - t.firedAt,
    firedWeapon: t.firedWeapon,
    swingMs: fx.now - t.swingAt,
    landedMs: fx.now - t.landedAt,
    landSpeed: t.landSpeed,
    switchedMs: fx.now - t.switchedAt,
    tumble: t.tumble,
  };
}

/** Turn rate of a thrown worm, rad/s: faster the harder it was hit, none below a lob. */
export function tumbleRate(vx: number, vy: number): number {
  const speed = Math.hypot(vx, vy);
  return speed > 60 ? Math.min(18, speed / 30) * (vx >= 0 ? 1 : -1) : 0;
}

/** The active worm's held weapon; a change pops the new one in the hand. */
export function noteWeapon(fx: FxState, wormId: string, weapon: WeaponId): void {
  const t = timersOf(fx, wormId);
  if (t.weapon !== null && t.weapon !== weapon) t.switchedAt = fx.now;
  t.weapon = weapon;
}

export interface FxDeps {
  readonly gore: GoreSystem;
  readonly particles: ParticleSystem;
  readonly rng: Rng;
  /** True when a world point is on screen, so blood only hits the lens when the camera saw it. */
  readonly onScreen: (x: number, y: number) => boolean;
}

function muzzleOf(x: number, y: number, facing: 1 | -1, angleDeg: number, reach: number): { x: number; y: number; angle: number } {
  const a = degToRad(angleDeg);
  const dx = Math.cos(a) * facing;
  const dy = -Math.sin(a);
  const sx = x + facing * 6;
  const sy = y - WORM_HEIGHT * 0.6;
  return { x: sx + dx * reach, y: sy + dy * reach, angle: Math.atan2(dy, dx) };
}

function initPuff(p: Particle, x: number, y: number, rng: Rng, size: number, color: string, rise: number): void {
  p.kind = 'smoke';
  p.x = x;
  p.y = y;
  p.vx = rng.nextFloat(-10, 10);
  p.vy = rng.nextFloat(-rise, -rise * 0.2);
  p.maxLife = rng.nextFloat(0.45, 0.9);
  p.life = p.maxLife;
  p.size = size * rng.nextFloat(0.7, 1.2);
  p.growth = p.size * 1.3;
  p.rotation = 0;
  p.spin = 0;
  p.alpha = alphaCurve('smoke', 1);
  p.gravityScale = -0.12;
  p.drag = 1.6;
  p.color = color;
}

function initSpark(p: Particle, x: number, y: number, vx: number, vy: number, rng: Rng, color: string, life: number): void {
  p.kind = 'spark';
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.maxLife = life * rng.nextFloat(0.6, 1.2);
  p.life = p.maxLife;
  p.size = rng.nextFloat(0.5, 1.1);
  p.growth = 0;
  p.rotation = 0;
  p.spin = 0;
  p.alpha = 1;
  p.gravityScale = 0.3;
  p.drag = 2;
  p.color = color;
}

const GUN_FLASH: Readonly<Partial<Record<WeaponId, number>>> = Object.freeze({ shotgun: 9, handgun: 6, uzi: 5, minigun: 6, sonic_blast: 10 });
const THROWN = new Set<WeaponId>(['grenade', 'cluster_bomb', 'banana_bomb', 'holy_hand_grenade', 'longbow']);

function onFired(fx: FxState, e: Extract<GameEvent, { type: 'fired' }>, deps: FxDeps): void {
  const t = timersOf(fx, e.wormId);
  t.firedAt = fx.now;
  t.firedWeapon = e.weapon;
  const def = WEAPONS[e.weapon];
  if (def.kind === 'MELEE') return;
  const gunFlash = GUN_FLASH[e.weapon];
  const muzzle = muzzleOf(e.x, e.y, e.facing, e.angleDeg, gunFlash !== undefined ? 11 : 9);
  if (gunFlash !== undefined) {
    fx.flashes.push({ x: muzzle.x, y: muzzle.y, angle: muzzle.angle, size: gunFlash, bornAt: fx.now, kind: 'muzzle' });
    if (e.weapon !== 'sonic_blast') ejectCasing(deps.gore, e.x + e.facing * 4, e.y - WORM_HEIGHT * 0.65, e.facing, deps.rng);
    for (let i = 0; i < 2; i += 1) deps.particles.spawn((p) => initPuff(p, muzzle.x, muzzle.y, deps.rng, 1.6, '#9a9a9a', 12));
    return;
  }
  if (THROWN.has(e.weapon) || def.kind === 'PLACED' || def.kind === 'ANIMAL') return;
  // Launchers: a back blast of smoke and a short flash at the tube's mouth.
  fx.flashes.push({ x: muzzle.x, y: muzzle.y, angle: muzzle.angle, size: 8, bornAt: fx.now, kind: 'muzzle' });
  for (let i = 0; i < 5; i += 1) deps.particles.spawn((p) => initPuff(p, muzzle.x, muzzle.y, deps.rng, 2.4, '#b8b8b8', 20));
}

function onDamage(fx: FxState, e: Extract<GameEvent, { type: 'damage' }>, deps: FxDeps): void {
  const t = timersOf(fx, e.wormId);
  t.hurtAt = fx.now;
  t.hurtAmount = e.amount;
  // The number counts the hp really lost: a blow on a worm already at 0 bleeds but adds nothing.
  if (e.lost > 0) {
    const merge = fx.numbers.find((n) => n.wormId === e.wormId && fx.now - n.lastAt < NUMBER_MERGE_MS);
    if (merge !== undefined) {
      merge.amount += e.lost;
      merge.lastAt = fx.now;
    } else {
      fx.numbers.push({ wormId: e.wormId, amount: e.lost, x: e.x, y: e.y, bornAt: fx.now, lastAt: fx.now });
    }
  }
  bloodBurst(deps.gore, { x: e.x, y: e.y, dx: e.dx, dy: e.dy, amount: e.amount, cause: e.cause }, deps.rng);
  if (e.amount >= 25 && deps.onScreen(e.x, e.y)) {
    fx.redPulse = { at: fx.now, strength: clamp(e.amount / 60, 0.3, 0.9) };
    if (e.cause === 'melee' || e.cause === 'blast') splatterLens(deps.gore, e.amount >= 45 ? 2 : 1, e.amount / 60, deps.rng);
  }
}

function onExplosion(fx: FxState, e: Extract<GameEvent, { type: 'explosion' }>): void {
  const radius = e.radius ?? 20;
  // Bullet puffs and split shells have tiny or zero radii: no shock ring for those.
  if (radius < 10) return;
  fx.flashes.push({ x: e.x, y: e.y, angle: 0, size: radius * 0.8, bornAt: fx.now, kind: 'blast' });
  fx.rings.push({ x: e.x, y: e.y, radius: radius * 1.35, bornAt: fx.now, color: e.particle === 'holy' ? '#fff3b0' : '#ffe2a8' });
}

function onCombo(fx: FxState, e: Extract<GameEvent, { type: 'comboStart' | 'comboHit' | 'comboEnd' }>, deps: FxDeps): void {
  if (e.type === 'comboStart') {
    fx.combo = { comboId: e.comboId, weapon: e.weapon, attackerId: e.attackerId, victimId: e.victimId, startedAt: fx.now, hits: 0, lastHitAt: -Infinity, finisherAt: null, ko: false, endedAt: null };
    fx.screenFlash = { at: fx.now, strength: 0.95, color: '#ffffff', ms: 260 };
    return;
  }
  const show = fx.combo;
  if (show === null || show.comboId !== e.comboId) return;
  if (e.type === 'comboEnd') {
    show.endedAt = fx.now;
    return;
  }
  show.hits = e.hit;
  show.lastHitAt = fx.now;
  fx.flashes.push({ x: e.x, y: e.y, angle: Math.atan2(e.dy, e.dx), size: e.finisher ? 16 : 7 + (e.hit % 3) * 2, bornAt: fx.now, kind: 'impact' });
  if (e.finisher) {
    show.finisherAt = fx.now;
    show.ko = e.ko;
    fx.screenFlash = { at: fx.now, strength: 1, color: e.ko ? '#ffd0d0' : '#ffffff', ms: 420 };
    fx.redPulse = { at: fx.now, strength: 1 };
    fx.rings.push({ x: e.x, y: e.y, radius: 46, bornAt: fx.now, color: '#ffffff' });
    splatterLens(deps.gore, e.ko ? 4 : 2, 1, deps.rng);
    return;
  }
  // Every few blows the blood reaches the lens.
  if (e.hit % 5 === 0) splatterLens(deps.gore, 1, 0.5, deps.rng);
}

/** Routes one tick's GameEvents into the effects and the gore. */
export function applyFxEvents(fx: FxState, events: readonly GameEvent[], deps: FxDeps): void {
  for (const e of events) {
    switch (e.type) {
      case 'damage':
        onDamage(fx, e, deps);
        break;
      case 'gib':
        gibBurst(deps.gore, { x: e.x, y: e.y, vx: e.vx, vy: e.vy, colorIndex: e.colorIndex, power: fx.combo !== null && fx.combo.victimId === e.wormId ? 1.35 : 1 }, deps.rng);
        fx.rings.push({ x: e.x, y: e.y, radius: 26, bornAt: fx.now, color: '#ff4a4a' });
        if (deps.onScreen(e.x, e.y)) {
          splatterLens(deps.gore, 2, 1, deps.rng);
          fx.redPulse = { at: fx.now, strength: 0.9 };
        }
        break;
      case 'tracer':
        fx.tracers.push({ x0: e.x, y0: e.y, x1: e.x1, y1: e.y1, bornAt: fx.now, hit: e.hit });
        break;
      case 'fired':
        onFired(fx, e, deps);
        break;
      case 'swing': {
        timersOf(fx, e.wormId).swingAt = fx.now;
        fx.swings.push({ x: e.x, y: e.y, facing: e.facing, bornAt: fx.now, fiery: e.weapon === 'fire_punch' });
        break;
      }
      case 'landed': {
        const t = timersOf(fx, e.wormId);
        t.landedAt = fx.now;
        t.landSpeed = e.speed;
        if (e.speed > 220) {
          for (let i = 0; i < 5; i += 1) deps.particles.spawn((p) => initPuff(p, e.x + deps.rng.nextFloat(-5, 5), e.y - 1, deps.rng, 1.8, '#a08060', 10));
        }
        break;
      }
      case 'drown':
        fx.sinkers.push({ wormId: e.wormId, x: e.x, y: e.y, facing: e.facing, colorIndex: e.colorIndex, bornAt: fx.now });
        break;
      case 'explosion':
        onExplosion(fx, e);
        break;
      case 'comboStart':
      case 'comboHit':
      case 'comboEnd':
        onCombo(fx, e, deps);
        break;
      default:
        break;
    }
  }
}

/**
 * How far a damage number has floated up (0 to 1, from its first hit) and how visible it is. It
 * fades on the clock of its last hit, so a number still collecting a flurry stays readable.
 */
export function numberLook(number: DamageNumber, now: number): { readonly rise: number; readonly alpha: number } {
  const rise = clamp((now - number.bornAt) / NUMBER_MS, 0, 1);
  const quiet = clamp((now - number.lastAt) / NUMBER_MS, 0, 1);
  return { rise, alpha: quiet < 0.75 ? 1 : 1 - (quiet - 0.75) / 0.25 };
}

function prune<T extends { readonly bornAt: number }>(list: T[], now: number, ms: number): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item !== undefined && now - item.bornAt > ms) list.splice(i, 1);
  }
}

export interface FxWorld {
  readonly world: SimWorld;
  /** Ledger hp by worm id, for the drips of the badly hurt. */
  readonly hpOf: (wormId: string) => number;
  readonly maxHp: number;
}

/** One tick: the clock, the numbers riding their worms, wounds dripping, rocket trails, expiry. */
export function advanceFx(fx: FxState, dtMs: number, scene: FxWorld | null, deps: FxDeps): void {
  fx.now += dtMs;
  if (scene !== null) {
    for (const number of fx.numbers) {
      const body = scene.world.worms.find((w) => w.id === number.wormId);
      if (body !== undefined && body.alive) {
        number.x = body.x;
        number.y = body.y - WORM_HEIGHT;
      }
    }
    const dt = dtMs / 1000;
    for (const body of scene.world.worms) {
      // Thrown worms tumble by what they turned this tick, so a change of speed never jumps the angle.
      if (body.alive && body.motion === 'flying') timersOf(fx, body.id).tumble += tumbleRate(body.vx, body.vy) * dt;
      else {
        const timers = fx.worms.get(body.id);
        if (timers !== undefined) timers.tumble = 0;
      }
    }
    for (const body of scene.world.worms) {
      if (!body.alive || body.motion === 'drowning') continue;
      const hp = scene.hpOf(body.id);
      if (hp <= 0) continue;
      const hurt = 1 - hp / scene.maxHp;
      // Below 60 percent a worm bleeds: the lower, the faster the drips.
      if (hurt > 0.4 && deps.rng.next() < (hurt - 0.4) * 5 * dt) dripFrom(deps.gore, body.x, body.y - WORM_HEIGHT * 0.5, deps.rng);
    }
    emitTrails(scene.world, deps);
  }
  prune(fx.tracers, fx.now, TRACER_MS);
  prune(fx.flashes, fx.now, Math.max(MUZZLE_MS, 160));
  prune(fx.rings, fx.now, RING_MS);
  prune(fx.swings, fx.now, SWING_MS);
  for (let i = fx.numbers.length - 1; i >= 0; i -= 1) {
    const number = fx.numbers[i];
    if (number !== undefined && fx.now - number.lastAt > NUMBER_MS) fx.numbers.splice(i, 1);
  }
  prune(fx.sinkers, fx.now, SINK_MS);
  if (fx.combo !== null && fx.combo.endedAt !== null && fx.now - fx.combo.endedAt > Math.max(COMBO_HUD_LINGER_MS, fx.combo.ko ? KO_MS : 0)) fx.combo = null;
  if (fx.screenFlash !== null && fx.now - fx.screenFlash.at > fx.screenFlash.ms) fx.screenFlash = null;
  if (fx.redPulse !== null && fx.now - fx.redPulse.at > 600) fx.redPulse = null;
}

/** Smoke behind rockets, gold behind the holy grenade, sparks off lit fuses, flames off napalm. */
function emitTrails(world: SimWorld, deps: FxDeps): void {
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    if (p.spec.trail === 'smoke') {
      deps.particles.spawn((particle) => initPuff(particle, p.x - p.vx * 0.012, p.y - p.vy * 0.012, deps.rng, 1.4, '#c4c4c4', 6));
      if (deps.rng.next() < 0.6) deps.particles.spawn((particle) => initSpark(particle, p.x, p.y, -p.vx * 0.15 + deps.rng.nextFloat(-20, 20), -p.vy * 0.15 + deps.rng.nextFloat(-20, 20), deps.rng, '#ffb347', 0.18));
    } else if (p.spec.trail === 'sparkle') {
      if (deps.rng.next() < 0.5) deps.particles.spawn((particle) => initSpark(particle, p.x, p.y, deps.rng.nextFloat(-25, 25), deps.rng.nextFloat(-40, 0), deps.rng, '#ffe07a', 0.5));
    }
    if (p.weaponId === 'napalm_blob' && deps.rng.next() < 0.7) {
      deps.particles.spawn((particle) => initSpark(particle, p.x, p.y - 1, deps.rng.nextFloat(-12, 12), deps.rng.nextFloat(-70, -30), deps.rng, deps.rng.next() < 0.5 ? '#ff7b1c' : '#ffd23f', 0.35));
    }
    if (p.weaponId === 'dynamite' && deps.rng.next() < 0.45) {
      deps.particles.spawn((particle) => initSpark(particle, p.x + 1, p.y - p.spec.radiusPx - 1, deps.rng.nextFloat(-30, 30), deps.rng.nextFloat(-60, -10), deps.rng, '#fff0a0', 0.25));
    }
  }
}

function toScreen(camera: Camera, viewport: Size): { readonly z: number; readonly ox: number; readonly oy: number } {
  const shake = shakeOffset(camera.shake);
  const z = camera.zoom;
  return { z, ox: viewport.w / 2 - (camera.x + shake.x) * z, oy: viewport.h / 2 - (camera.y + shake.y) * z };
}

function drawStar(ctx: Ctx2D, x: number, y: number, outer: number, inner: number, points: number, rotation: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i / (points * 2)) * TWO_PI;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * World space effects, drawn over the worms and the gore. On the super move's white screen
 * (whiteout above one half) the light effects would vanish into the white, so the blows' impact
 * stars are drawn in black and red instead.
 */
export function drawFxWorld(ctx: Ctx2D, fx: FxState, camera: Camera, viewport: Size, sprites?: ReadonlyMap<number, CharacterSprites>, whiteout = 0): void {
  const { z, ox, oy } = toScreen(camera, viewport);
  const sx = (x: number): number => x * z + ox;
  const sy = (y: number): number => y * z + oy;
  ctx.save();

  for (const sinker of fx.sinkers) {
    const age = fx.now - sinker.bornAt;
    const t = age / SINK_MS;
    const y = sinker.y + age * 0.03;
    const set = sprites?.get(sinker.colorIndex);
    const frame = set?.atlas.frame(age < 600 ? 'drown_gasp' : 'drown_sink');
    if (set !== undefined && frame !== undefined) {
      drawSprite(ctx, set.image, frame, set.atlas.pivotOf(frame), { x: sx(sinker.x), y: sy(y), zoom: z, flipX: sinker.facing === -1, alpha: clamp(1 - t, 0, 1) });
    }
    ctx.globalAlpha = clamp(1 - t, 0, 1) * 0.8;
    ctx.strokeStyle = '#e8f6ff';
    ctx.lineWidth = Math.max(1, z * 0.5);
    for (let i = 0; i < 4; i += 1) {
      const bubbleAge = (age + i * 260) % 900;
      ctx.beginPath();
      ctx.arc(sx(sinker.x + Math.sin(i * 2.1 + age / 200) * 3), sy(y - 14 - bubbleAge * 0.03), (0.8 + (i % 2) * 0.6) * z, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  for (const ring of fx.rings) {
    const t = (fx.now - ring.bornAt) / RING_MS;
    ctx.globalAlpha = clamp(1 - t, 0, 1) * 0.85;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = Math.max(1, (1 - t) * 5 * z);
    ctx.beginPath();
    ctx.arc(sx(ring.x), sy(ring.y), Math.max(1, ring.radius * (0.25 + t * 0.9) * z), 0, TWO_PI);
    ctx.stroke();
  }

  const inked = whiteout > 0.5;
  ctx.globalCompositeOperation = inked ? 'source-over' : 'lighter';
  for (const tracer of fx.tracers) {
    const t = (fx.now - tracer.bornAt) / TRACER_MS;
    ctx.globalAlpha = clamp(1 - t, 0, 1);
    ctx.strokeStyle = '#fff2b0';
    ctx.lineWidth = Math.max(1, 0.9 * z);
    ctx.beginPath();
    // The tracer's tail catches up with its head: the round visibly travels.
    const tail = clamp(t * 1.4, 0, 1);
    ctx.moveTo(sx(tracer.x0 + (tracer.x1 - tracer.x0) * tail), sy(tracer.y0 + (tracer.y1 - tracer.y0) * tail));
    ctx.lineTo(sx(tracer.x1), sy(tracer.y1));
    ctx.stroke();
  }
  for (const flash of fx.flashes) {
    const age = fx.now - flash.bornAt;
    if (flash.kind === 'muzzle') {
      const t = age / MUZZLE_MS;
      if (t > 1) continue;
      ctx.globalAlpha = 1 - t;
      const x = sx(flash.x);
      const y = sy(flash.y);
      const len = flash.size * z * (1.2 - t * 0.4);
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      ctx.moveTo(x - Math.sin(flash.angle) * len * 0.35, y + Math.cos(flash.angle) * len * 0.35);
      ctx.lineTo(x + Math.cos(flash.angle) * len, y + Math.sin(flash.angle) * len);
      ctx.lineTo(x + Math.sin(flash.angle) * len * 0.35, y - Math.cos(flash.angle) * len * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fffbe6';
      ctx.beginPath();
      ctx.arc(x, y, len * 0.3, 0, TWO_PI);
      ctx.fill();
    } else if (flash.kind === 'blast') {
      const t = age / 160;
      if (t > 1) continue;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = '#fff4d0';
      ctx.beginPath();
      ctx.arc(sx(flash.x), sy(flash.y), Math.max(1, flash.size * z * (0.6 + t * 0.4)), 0, TWO_PI);
      ctx.fill();
    } else {
      const t = age / 130;
      if (t > 1) continue;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = inked ? '#000000' : '#fff6e0';
      drawStar(ctx, sx(flash.x), sy(flash.y), flash.size * z * (0.8 + t * 0.6), flash.size * z * 0.3, 8, flash.angle + t);
      if (inked) {
        ctx.fillStyle = '#c00010';
        drawStar(ctx, sx(flash.x), sy(flash.y), flash.size * z * 0.55, flash.size * z * 0.2, 6, -flash.angle - t);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  for (const swing of fx.swings) {
    const t = (fx.now - swing.bornAt) / SWING_MS;
    const x = sx(swing.x);
    const y = sy(swing.y);
    const r = 16 * z;
    ctx.globalAlpha = clamp(1 - t, 0, 1) * 0.85;
    ctx.strokeStyle = swing.fiery ? '#ff8a1c' : '#ffffff';
    ctx.lineWidth = Math.max(1.5, 3.5 * z * (1 - t));
    ctx.beginPath();
    // A sweep from low in front to high above: an uppercut or a bat swing.
    const from = swing.facing === 1 ? 0.6 : Math.PI - 0.6;
    const to = swing.facing === 1 ? -1.7 : Math.PI + 1.7;
    const head = from + (to - from) * clamp(t * 1.6, 0, 1);
    ctx.arc(x, y, r, Math.min(from, head), Math.max(from, head));
    ctx.stroke();
    if (swing.fiery) {
      ctx.strokeStyle = '#ffe06b';
      ctx.lineWidth = Math.max(1, 1.5 * z * (1 - t));
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, Math.min(from, head), Math.max(from, head));
      ctx.stroke();
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const number of fx.numbers) {
    const { rise, alpha } = numberLook(number, fx.now);
    const pop = 1 + Math.max(0, 1 - (fx.now - number.lastAt) / 180) * 0.45;
    const size = Math.round(clamp(11 + number.amount * 0.18, 12, 26) * pop);
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.globalAlpha = alpha;
    const x = sx(number.x);
    const y = sy(number.y) - 24 - rise * 26;
    const text = `-${Math.round(number.amount)}`;
    ctx.fillStyle = '#1a0000';
    ctx.fillText(text, x + 1.5, y + 1.5);
    ctx.fillStyle = number.amount >= 30 ? '#ff2a2a' : '#ff6a4a';
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function outlinedText(ctx: Ctx2D, text: string, x: number, y: number, fill: string, outline: string, offset: number): void {
  ctx.fillStyle = outline;
  for (const [dx, dy] of [[-offset, 0], [offset, 0], [0, -offset], [0, offset], [offset, offset]] as const) ctx.fillText(text, x + dx, y + dy);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Screen space overlays: the super's name card, the hit counter, K.O., MISS, flashes and the red edges. */
export function drawFxScreen(ctx: Ctx2D, fx: FxState, viewport: Size): void {
  ctx.save();
  if (fx.redPulse !== null) {
    const t = (fx.now - fx.redPulse.at) / 600;
    const a = clamp(1 - t, 0, 1) * fx.redPulse.strength * 0.55;
    if (a > 0) {
      const edge = Math.min(viewport.w, viewport.h) * 0.18;
      for (const [x, y, w, h, vertical, flip] of [
        [0, 0, viewport.w, edge, true, false],
        [0, viewport.h - edge, viewport.w, edge, true, true],
        [0, 0, edge, viewport.h, false, false],
        [viewport.w - edge, 0, edge, viewport.h, false, true],
      ] as const) {
        const g = vertical ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(flip ? 1 : 0, `rgba(160, 0, 0, ${a})`);
        g.addColorStop(flip ? 0 : 1, 'rgba(160, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  const show = fx.combo;
  if (show !== null) {
    const since = fx.now - show.startedAt;
    if (since < SUPER_CARD_MS) {
      // The name card slams in from the left over a red slash, KOF style, and leaves to the right.
      const t = since / SUPER_CARD_MS;
      const slide = t < 0.18 ? 1 - t / 0.18 : t > 0.82 ? -(t - 0.82) / 0.18 : 0;
      const x = viewport.w / 2 - slide * viewport.w * 0.8;
      const y = viewport.h * 0.3;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#b00010';
      ctx.beginPath();
      ctx.moveTo(x - viewport.w * 0.42, y + 22);
      ctx.lineTo(x + viewport.w * 0.36, y - 30);
      ctx.lineTo(x + viewport.w * 0.42, y - 18);
      ctx.lineTo(x - viewport.w * 0.36, y + 34);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 900 ${Math.round(clamp(viewport.w / 14, 30, 72))}px system-ui, sans-serif`;
      const name = isWeaponId(show.weapon) ? getWeapon(show.weapon).name : '';
      outlinedText(ctx, name.toUpperCase(), x, y, '#ffe14a', '#1a0000', 3);
      ctx.font = `bold ${Math.round(clamp(viewport.w / 60, 11, 18))}px system-ui, sans-serif`;
      outlinedText(ctx, 'SUPER DESPERATION MOVE', x, y + 38, '#ffffff', '#1a0000', 2);
    }
    if (show.hits >= 2) {
      const pop = 1 + Math.max(0, 1 - (fx.now - show.lastHitAt) / 140) * 0.5;
      const x = viewport.w * 0.07;
      const y = viewport.h * 0.42;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 900 ${Math.round(46 * pop)}px system-ui, sans-serif`;
      outlinedText(ctx, String(show.hits), x, y, '#ffcf1f', '#2a0000', 3);
      ctx.font = 'italic 900 24px system-ui, sans-serif';
      outlinedText(ctx, 'HITS', x + 16 + String(show.hits).length * 26 * pop, y + 6, '#ff4d2e', '#2a0000', 2);
    }
    if (show.ko && show.finisherAt !== null) {
      const t = (fx.now - show.finisherAt) / KO_MS;
      if (t < 1) {
        const grow = 1 + Math.max(0, 0.25 - t) * 3;
        ctx.globalAlpha = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `italic 900 ${Math.round(clamp(viewport.w / 7, 60, 150) * grow)}px system-ui, sans-serif`;
        outlinedText(ctx, 'K.O.', viewport.w / 2, viewport.h * 0.45, '#e00000', '#120000', 5);
      }
    }
    if (show.endedAt !== null && show.hits === 0 && show.victimId === null) {
      const t = (fx.now - show.endedAt) / COMBO_HUD_LINGER_MS;
      if (t < 1) {
        ctx.globalAlpha = 1 - t;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'italic 900 48px system-ui, sans-serif';
        outlinedText(ctx, 'MISS', viewport.w / 2, viewport.h * 0.4 - t * 20, '#d8d8d8', '#202020', 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  if (fx.screenFlash !== null) {
    const t = (fx.now - fx.screenFlash.at) / fx.screenFlash.ms;
    const a = clamp(1 - t, 0, 1) * fx.screenFlash.strength;
    if (a > 0) {
      ctx.globalAlpha = a;
      ctx.fillStyle = fx.screenFlash.color;
      ctx.fillRect(0, 0, viewport.w, viewport.h);
    }
  }
  ctx.restore();
}
