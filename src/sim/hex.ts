/**
 * The Freezer in the sim: a timeline the world steps once per tick, like Gear 5. The worm points a
 * finger at the victim the fire behavior locked (weapons/behaviors/hex.ts) while a pink light
 * gathers on its tip; the light flies to the victim on a low arc and sinks into its body; the
 * victim floats up off the ground, glowing from inside, swells up throbbing faster and faster, and
 * bursts. With nobody in sight the light flies on as far as it gets and fizzles out.
 *
 * Both worms are HELD from the point until the burst: stepWorld skips them in the worm controller
 * and the hex places them every tick, so gravity, landings and the drowning check never interfere.
 * The burst deals the victim all the health it has, whatever a crate gave it, and takes its body out
 * of the world (the controller turns it into gore, as it does any worm blown apart); then it goes
 * off as a blast that hurts whoever stands close, the attacker included. Nobody is held after the
 * burst: the attacker lowers its finger and laughs, or flies if it stood too close.
 *
 * Damage is emitted, never applied (the match reducer applies it). Mutates the bodies in place
 * (hot path), like the rest of the sim.
 */

import { msToTicks } from '../config/units.ts';
import { sweep } from './collision.ts';
import { WORM_HEIGHT } from './constants.ts';
import { explode } from './explosion.ts';
import type { HexBeat, HexBody, HexStage, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';
import type { HexSpec } from '../weapons/types.ts';

/**
 * Cues of the Freezer, all present in the audio plan. The burst brings its own boom, cry and
 * splatter. The scream and the laugh are voice lines (voice_super_* in tools/audio/sounds.plan.json):
 * the mixer skips them until they have been generated.
 */
export const HEX_SOUNDS = Object.freeze({
  shot: 'wpn_teleport_zap',
  /** The light is in: the worm is a bomb now, armed. */
  enter: 'wpn_mine_arm',
  fizzle: 'exp_small_1',
  /** The throbs beep like a mine about to go, faster and faster. */
  pulse: 'wpn_mine_beep',
  scream: Object.freeze(['wrm_hurt_grunt_1', 'wrm_hurt_grunt_2', 'wrm_hurt_grunt_3']),
  stretch: 'wpn_banana_boing',
  krilin: 'voice_super_freezer_krilin',
  laugh: 'voice_super_freezer_laugh',
});

/** The emperor starts laughing this many ticks after the burst, as the scream for the victim rings out. */
export const LAUGH_TICK = 20;

/** What the burst takes: everything, whatever a health crate added. The ledger stops at 0. */
export const BURST_DAMAGE = 1_000_000;

/** The fingertip of the arm the worm holds out to point (the sheets' hold_gun pose), where the light gathers. */
export const HAND_AHEAD_PX = 7;
export const HAND_LIFT = 0.53;

/** The light's path bows up this much of its length over the straight line, up to a cap, world px. */
const ARC_SHARE = 0.18;
const ARC_MAX_PX = 44;
/** Even a worm right in front gets to see the light coming. */
const MIN_FLIGHT_TICKS = 12;
/** Room kept over the head at the top of the float, for the swelling, world px. */
const HEADROOM_PX = 10;

const NOBODY: ReadonlySet<string> = new Set();

function ticksFor(ms: number): number {
  return Math.max(1, msToTicks(ms));
}

/** Where the light leaves from: the fingertip of the arm held out in front, for a worm standing at (x, y). */
export function fingertip(x: number, y: number, facing: 1 | -1): { readonly x: number; readonly y: number } {
  return { x: x + facing * HAND_AHEAD_PX, y: y - WORM_HEIGHT * HAND_LIFT };
}

/** Ticks the light takes over a distance, world px. */
export function flightTicksFor(spec: HexSpec, distancePx: number): number {
  return Math.max(MIN_FLIGHT_TICKS, Math.round((distancePx / spec.lightSpeedPxPerS) * 60));
}

/** The throbs while the victim swells, as ticks into the swell: closer and closer together, the last just before the burst. */
export function pulseTicks(spec: HexSpec): readonly number[] {
  const total = ticksFor(spec.swellMs);
  const out: number[] = [];
  for (let k = 1; k <= spec.pulses; k += 1) {
    const at = Math.round(total * Math.pow(k / (spec.pulses + 1), 0.6));
    out.push(Math.min(total - 1, Math.max(out.length === 0 ? 1 : (out[out.length - 1] ?? 0) + 1, at)));
  }
  return out;
}

/** Total length in ticks: the point, the light's flight, the float and the swell, and the recovery (a whiff skips the middle). */
export function hexTicks(spec: HexSpec, flightTicks: number, bursts = true): number {
  const middle = bursts ? ticksFor(spec.riseMs) + ticksFor(spec.swellMs) : 0;
  return ticksFor(spec.pointMs) + flightTicks + middle + ticksFor(spec.recoverMs);
}

/** How high the victim can float: the spec's lift, less under a ceiling, keeping room over its head. */
function headroom(world: SimWorld, victim: WormBody, liftPx: number): number {
  const headY = victim.y - WORM_HEIGHT;
  const path = sweep(world.terrain.mask, victim.x, headY, victim.x, headY - liftPx - HEADROOM_PX, 0);
  if (path.hit === null) return liftPx;
  return Math.max(0, Math.min(liftPx, headY - path.y - HEADROOM_PX));
}

export interface SpawnHexParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly victim: WormBody | null;
  readonly spec: HexSpec;
  readonly facing: 1 | -1;
  /** Where the light goes: the victim's middle, or as far as it got when nobody was in sight. */
  readonly targetX: number;
  readonly targetY: number;
}

export function spawnHex(world: SimWorld, params: SpawnHexParams): HexBody {
  const { attacker, victim, facing, spec } = params;
  attacker.facing = facing;
  const tip = fingertip(attacker.x, attacker.y, facing);
  const distance = Math.hypot(params.targetX - tip.x, params.targetY - tip.y);
  const hex: HexBody = {
    id: world.nextId(),
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    victimId: victim === null ? null : victim.id,
    spec,
    stage: 'point',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    tipX: tip.x,
    tipY: tip.y,
    targetX: params.targetX,
    targetY: params.targetY,
    arcPx: victim === null ? 0 : Math.min(ARC_MAX_PX, distance * ARC_SHARE),
    flightTicks: flightTicksFor(spec, distance),
    groundX: victim === null ? params.targetX : victim.x,
    groundY: victim === null ? params.targetY : victim.y,
    liftPx: victim === null ? 0 : headroom(world, victim, spec.liftPx),
    pulses: 0,
    burst: false,
    alive: true,
  };
  world.hexes.push(hex);
  world.events.push({ type: 'hexStart', hexId: hex.id, weaponId: hex.weaponId, attackerId: attacker.id, victimId: hex.victimId, x: attacker.x, y: attacker.y });
  return hex;
}

/** Ids of the worms live hexes hold this tick: every attacker and every victim, until the burst or the fizzle. */
export function heldByHexes(hexes: readonly HexBody[]): ReadonlySet<string> {
  if (hexes.length === 0) return NOBODY;
  const held = new Set<string>();
  for (const hex of hexes) {
    if (!hex.alive || hex.stage === 'recover') continue;
    held.add(hex.attackerId);
    if (hex.victimId !== null && !hex.burst) held.add(hex.victimId);
  }
  return held;
}

function stageLength(hex: HexBody): number {
  const spec = hex.spec;
  switch (hex.stage) {
    case 'point':
      return ticksFor(spec.pointMs);
    case 'shot':
      return hex.flightTicks;
    case 'rise':
      return ticksFor(spec.riseMs);
    case 'swell':
      return ticksFor(spec.swellMs);
    case 'recover':
      return ticksFor(spec.recoverMs);
  }
}

/** 0..1 through the current stage, for the presentation. */
export function hexProgress(hex: HexBody): number {
  return Math.min(1, Math.max(0, hex.stageTicks / stageLength(hex)));
}

/** The light glides off the fingertip, speeds up, and slows as it reaches the body. */
function flightEase(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The float: quick off the ground, easing into the hover. */
function riseEase(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Where the light is while it flies, world px, or where it was ticksAgo ticks back (the fingertip
 * before it left): along a low arc from the fingertip to the target. Null when it is not flying.
 */
export function hexLight(hex: HexBody, ticksAgo = 0): { readonly x: number; readonly y: number } | null {
  if (hex.stage !== 'shot') return null;
  const t = flightEase(Math.min(1, Math.max(0, (hex.stageTicks - ticksAgo) / hex.flightTicks)));
  // A quadratic curve whose middle bows arcPx over the chord's middle.
  const cx = (hex.tipX + hex.targetX) / 2;
  const cy = (hex.tipY + hex.targetY) / 2 - hex.arcPx * 2;
  const u = 1 - t;
  return { x: u * u * hex.tipX + 2 * u * t * cx + t * t * hex.targetX, y: u * u * hex.tipY + 2 * u * t * cy + t * t * hex.targetY };
}

/** How far the victim floats over the ground, world px: rising, then hovering at the top until it bursts. */
export function hexLift(hex: HexBody): number {
  switch (hex.stage) {
    case 'rise':
      return hex.liftPx * riseEase(hexProgress(hex));
    case 'swell':
      return hex.liftPx;
    default:
      return 0;
  }
}

function wormById(world: SimWorld, id: string | null): WormBody | undefined {
  if (id === null) return undefined;
  return world.worms.find((w) => w.id === id);
}

function place(worm: WormBody, x: number, y: number): void {
  worm.x = x;
  worm.y = y;
  worm.vx = 0;
  worm.vy = 0;
  worm.restTicks = 0;
  if (worm.motion !== 'dead') worm.motion = 'idle';
}

/** Hands a held worm back to physics: it settles, or falls, from where the hex left it. */
function release(worm: WormBody): void {
  if (!worm.alive) return;
  worm.vx = 0;
  worm.vy = 0;
  worm.motion = 'falling';
  worm.onGround = false;
  worm.restTicks = 0;
  worm.fallStartY = worm.y;
}

function beat(world: SimWorld, hex: HexBody, kind: HexBeat, n: number, x: number, y: number): void {
  world.events.push({ type: 'hexBeat', hexId: hex.id, attackerId: hex.attackerId, victimId: hex.victimId, beat: kind, n, x, y, facing: hex.facing });
}

function sound(world: SimWorld, id: string, x: number, y: number): void {
  world.events.push({ type: 'sound', id, x, y });
}

function enter(hex: HexBody, stage: HexStage): void {
  hex.stage = stage;
  hex.stageTicks = 0;
}

function end(world: SimWorld, hex: HexBody, attacker: WormBody | undefined, victim: WormBody | undefined): void {
  // Cut short before the burst, the hex still holds both worms: let them go, the victim unharmed.
  if (hex.stage !== 'recover') {
    if (attacker !== undefined) release(attacker);
    if (victim !== undefined && !hex.burst) release(victim);
  }
  hex.alive = false;
  world.events.push({ type: 'hexEnd', hexId: hex.id, attackerId: hex.attackerId, victimId: hex.victimId, burst: hex.burst });
}

/**
 * Ends every live hex on the spot and lets its worms go. For a match that ends mid spell (a
 * surrender): the sim is not stepped after MatchEnd, so a hex left alive would never finish.
 */
export function cancelHexes(world: SimWorld): void {
  for (const hex of world.hexes) {
    if (hex.alive) end(world, hex, wormById(world, hex.attackerId), wormById(world, hex.victimId));
  }
  world.hexes = world.hexes.filter((h) => h.alive);
}

/** The light is spent, in the body or in the air: the attacker is its own again for the recovery. */
function toRecover(hex: HexBody, attacker: WormBody): void {
  enter(hex, 'recover');
  release(attacker);
}

/**
 * The body gives: all its health goes, its body leaves the world, and the blast goes off where its
 * middle was. The attacker is let go first, so a blast that reaches it throws it like anyone else.
 */
function burst(world: SimWorld, hex: HexBody, victim: WormBody, attacker: WormBody): void {
  const x = victim.x;
  const y = victim.y - WORM_HEIGHT / 2;
  hex.burst = true;
  world.events.push({ type: 'damage', wormId: victim.id, amount: BURST_DAMAGE, sourceTeamId: hex.ownerTeamId, sourceWormId: hex.attackerId, cause: 'blast', at: { x, y, dx: 0, dy: -1 } });
  beat(world, hex, 'burst', 0, x, y);
  victim.vx = 0;
  victim.vy = 0;
  victim.motion = 'dead';
  victim.alive = false;
  toRecover(hex, attacker);
  explode(world, { x, y, blast: hex.spec.burst, sourceTeamId: hex.ownerTeamId, sourceWormId: hex.attackerId });
  sound(world, HEX_SOUNDS.krilin, x, y);
}

/** One tick of the Freezer. Runs after the worm controller, so the placements here are final for the tick. */
export function stepHex(world: SimWorld, hex: HexBody): void {
  if (!hex.alive) return;
  const attacker = wormById(world, hex.attackerId);
  const victim = wormById(world, hex.victimId);
  if (attacker === undefined || !attacker.alive) {
    end(world, hex, attacker, victim);
    return;
  }
  const spec = hex.spec;
  hex.stageTicks += 1;
  const victimUp = victim !== undefined && victim.alive && !hex.burst;
  if (hex.stage !== 'recover') place(attacker, hex.holdX, hex.holdY);
  switch (hex.stage) {
    case 'point':
      if (victimUp) place(victim, hex.groundX, hex.groundY);
      if (hex.stageTicks >= ticksFor(spec.pointMs)) {
        beat(world, hex, 'shot', 0, hex.tipX, hex.tipY);
        sound(world, HEX_SOUNDS.shot, hex.tipX, hex.tipY);
        enter(hex, 'shot');
      }
      return;
    case 'shot':
      if (victimUp) place(victim, hex.groundX, hex.groundY);
      if (hex.stageTicks < hex.flightTicks) return;
      if (victimUp) {
        beat(world, hex, 'enter', 0, hex.targetX, hex.targetY);
        sound(world, HEX_SOUNDS.enter, hex.targetX, hex.targetY);
        sound(world, HEX_SOUNDS.scream[0] ?? 'wrm_hurt_grunt_1', hex.targetX, hex.targetY);
        enter(hex, 'rise');
      } else {
        beat(world, hex, 'fizzle', 0, hex.targetX, hex.targetY);
        sound(world, HEX_SOUNDS.fizzle, hex.targetX, hex.targetY);
        toRecover(hex, attacker);
      }
      return;
    case 'rise':
      if (!victimUp) {
        toRecover(hex, attacker);
        return;
      }
      place(victim, hex.groundX, hex.groundY - hexLift(hex));
      if (hex.stageTicks >= ticksFor(spec.riseMs)) enter(hex, 'swell');
      return;
    case 'swell': {
      if (!victimUp) {
        toRecover(hex, attacker);
        return;
      }
      place(victim, hex.groundX, hex.groundY - hex.liftPx);
      const middleY = victim.y - WORM_HEIGHT / 2;
      if (pulseTicks(spec).includes(hex.stageTicks)) {
        hex.pulses += 1;
        beat(world, hex, 'pulse', hex.pulses, victim.x, middleY);
        sound(world, HEX_SOUNDS.pulse, victim.x, middleY);
        if (hex.pulses % 2 === 0) {
          sound(world, HEX_SOUNDS.stretch, victim.x, middleY);
          sound(world, HEX_SOUNDS.scream[(hex.pulses / 2) % HEX_SOUNDS.scream.length] ?? 'wrm_hurt_grunt_2', victim.x, middleY);
        }
      }
      if (hex.stageTicks >= ticksFor(spec.swellMs)) burst(world, hex, victim, attacker);
      return;
    }
    case 'recover':
      if (hex.burst && hex.stageTicks === LAUGH_TICK) sound(world, HEX_SOUNDS.laugh, attacker.x, attacker.y);
      if (hex.stageTicks >= ticksFor(spec.recoverMs)) end(world, hex, attacker, victim);
      return;
  }
}
