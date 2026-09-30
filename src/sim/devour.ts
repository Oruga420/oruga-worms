/**
 * Gear 5 in the sim: a timeline the world steps once per tick, like a combo. The worm awakens to
 * the drums of liberation; its rubber arm shoots out to the victim the fire behavior locked
 * (weapons/behaviors/devour.ts), grabs it and reels it into a giant mouth; the mouth bites it
 * again and again and swallows it whole, and the worm burps. With nobody in reach the hand grabs
 * at the air and snaps back.
 *
 * The eater is HELD from the awakening to the end, and the victim until it is swallowed: stepWorld
 * skips them in the worm controller and the devour places them every tick, so gravity, landings and
 * the drowning check never interfere. A swallowed worm is gone, however much health a crate gave
 * it: the swallow deals all of it and takes the body out of the world.
 *
 * Damage is emitted, never applied (the match reducer applies it), and every bite says where it
 * landed and which way the blood goes: out of the mouth. Mutates the bodies in place (hot path),
 * like the rest of the sim.
 */

import { msToTicks } from '../config/units.ts';
import { WORM_HEIGHT } from './constants.ts';
import type { DevourBeat, DevourBody, DevourStage, HitPoint, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';
import type { DevourSpec } from '../weapons/types.ts';

/** Cues of Gear 5, all present in the audio plan. */
export const DEVOUR_SOUNDS = Object.freeze({
  drum: 'wpn_firepunch_thud',
  awake: Object.freeze(['wpn_holy_choir', 'wpn_teleport_zap']),
  stretch: 'wpn_banana_boing',
  grab: 'wpn_sheep_boing',
  chomp: Object.freeze(['wpn_bat_crack', 'wpn_firepunch_thud']),
  scream: Object.freeze(['wrm_hurt_grunt_1', 'wrm_hurt_grunt_2', 'wrm_hurt_grunt_3']),
  gulp: 'wrm_drown_gurgle',
  burp: Object.freeze(['exp_small_2', 'wpn_sheep_boing']),
});

/** What the swallow takes: everything, whatever a health crate added. The ledger stops at 0. */
export const SWALLOW_DAMAGE = 1_000_000;

/** The victim's feet while it is chewed: in front of the eater's face, lifted into the giant mouth. */
export const MOUTH_AHEAD_PX = 11;
export const MOUTH_LIFT_PX = 7;

/** The burp comes up this far into the recovery. */
export const BURP_AT = 0.4;

/** Where the blood of each bite goes: radians above the horizontal, out of the mouth. Fixed, so replays match. */
const BITE_SPRAY: readonly number[] = Object.freeze([0.85, 0.35, 1.2, 0.6, 0.15, 1.0]);

const NOBODY: ReadonlySet<string> = new Set();

function ticksFor(ms: number): number {
  return Math.max(1, msToTicks(ms));
}

/** The awakening's drum beats, as ticks into it: evenly spaced, the last a beat before the awakening itself. */
export function drumTicks(spec: DevourSpec): readonly number[] {
  const total = ticksFor(spec.awakenMs);
  const out: number[] = [];
  for (let k = 1; k <= spec.drums; k += 1) out.push(Math.max(1, Math.round((total * k) / (spec.drums + 1))));
  return out;
}

/** Total length in ticks: the awakening, the arm out and back, the bites and the recovery (a whiff skips the bites). */
export function devourTicks(spec: DevourSpec, eats = true): number {
  const bites = eats ? spec.chomps * ticksFor(spec.chompIntervalMs) : 0;
  return ticksFor(spec.awakenMs) + ticksFor(spec.stretchMs) + ticksFor(spec.reelMs) + bites + ticksFor(spec.recoverMs);
}

export interface SpawnDevourParams {
  readonly weaponId: string;
  readonly eater: WormBody;
  readonly victim: WormBody | null;
  readonly spec: DevourSpec;
  readonly facing: 1 | -1;
  /** Where the hand goes: the victim's middle, or as far as the arm got when it whiffs. */
  readonly reachX: number;
  readonly reachY: number;
}

export function spawnDevour(world: SimWorld, params: SpawnDevourParams): DevourBody {
  const { eater, victim, facing } = params;
  eater.facing = facing;
  const devour: DevourBody = {
    id: world.nextId(),
    weaponId: params.weaponId,
    attackerId: eater.id,
    ownerTeamId: eater.teamId,
    victimId: victim === null ? null : victim.id,
    spec: params.spec,
    stage: 'awaken',
    stageTicks: 0,
    holdX: eater.x,
    holdY: eater.y,
    facing,
    shoulderX: eater.x + facing * 4,
    shoulderY: eater.y - WORM_HEIGHT * 0.55,
    reachX: params.reachX,
    reachY: params.reachY,
    grabX: victim === null ? params.reachX : victim.x,
    grabY: victim === null ? params.reachY : victim.y,
    mouthX: eater.x + facing * MOUTH_AHEAD_PX,
    mouthY: eater.y - MOUTH_LIFT_PX,
    chomps: 0,
    swallowed: false,
    burped: false,
    alive: true,
  };
  world.devours.push(devour);
  world.events.push({ type: 'devourStart', devourId: devour.id, weaponId: devour.weaponId, attackerId: eater.id, victimId: devour.victimId, x: eater.x, y: eater.y });
  return devour;
}

/** Ids of the worms live devours hold this tick: every eater, and every victim not yet swallowed. */
export function heldByDevours(devours: readonly DevourBody[]): ReadonlySet<string> {
  if (devours.length === 0) return NOBODY;
  const held = new Set<string>();
  for (const devour of devours) {
    if (!devour.alive) continue;
    held.add(devour.attackerId);
    if (devour.victimId !== null && !devour.swallowed) held.add(devour.victimId);
  }
  return held;
}

function stageLength(devour: DevourBody): number {
  const spec = devour.spec;
  switch (devour.stage) {
    case 'awaken':
      return ticksFor(spec.awakenMs);
    case 'stretch':
      return ticksFor(spec.stretchMs);
    case 'reel':
      return ticksFor(spec.reelMs);
    case 'chew':
      return spec.chomps * ticksFor(spec.chompIntervalMs);
    case 'recover':
      return ticksFor(spec.recoverMs);
  }
}

/** 0..1 through the current stage, for the presentation. */
export function devourProgress(devour: DevourBody): number {
  return Math.min(1, Math.max(0, devour.stageTicks / stageLength(devour)));
}

/** The arm shoots out fast and slows as it arrives. */
function stretchEase(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** The arm snaps back slow at first, then all at once. */
function reelEase(t: number): number {
  return t * t;
}

/** The victim's feet this far through the reel: from where it was grabbed into the mouth. */
function reeledFeet(devour: DevourBody, t: number): { readonly x: number; readonly y: number } {
  const k = reelEase(t);
  return { x: devour.grabX + (devour.mouthX - devour.grabX) * k, y: devour.grabY + (devour.mouthY - devour.grabY) * k };
}

/**
 * Where the rubber hand is while the arm is out, world px: flying to the reach point, then back
 * with the victim in its grip (at the victim's middle), or empty to the shoulder after a whiff.
 * Null while the arm is in.
 */
export function devourHand(devour: DevourBody): { readonly x: number; readonly y: number } | null {
  const t = devourProgress(devour);
  if (devour.stage === 'stretch') {
    const k = stretchEase(t);
    return { x: devour.shoulderX + (devour.reachX - devour.shoulderX) * k, y: devour.shoulderY + (devour.reachY - devour.shoulderY) * k };
  }
  if (devour.stage !== 'reel') return null;
  if (devour.victimId !== null) {
    const feet = reeledFeet(devour, t);
    return { x: feet.x, y: feet.y - WORM_HEIGHT / 2 };
  }
  const k = reelEase(t);
  return { x: devour.reachX + (devour.shoulderX - devour.reachX) * k, y: devour.reachY + (devour.shoulderY - devour.reachY) * k };
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

/** Hands a held worm back to physics: it settles, or falls, from where the devour left it. */
function release(worm: WormBody): void {
  if (!worm.alive) return;
  worm.vx = 0;
  worm.vy = 0;
  worm.motion = 'falling';
  worm.onGround = false;
  worm.restTicks = 0;
  worm.fallStartY = worm.y;
}

function beat(world: SimWorld, devour: DevourBody, kind: DevourBeat, n: number, x: number, y: number): void {
  world.events.push({ type: 'devourBeat', devourId: devour.id, attackerId: devour.attackerId, victimId: devour.victimId, beat: kind, n, x, y, facing: devour.facing });
}

function sound(world: SimWorld, id: string, x: number, y: number): void {
  world.events.push({ type: 'sound', id, x, y });
}

function enter(devour: DevourBody, stage: DevourStage): void {
  devour.stage = stage;
  devour.stageTicks = 0;
}

function end(world: SimWorld, devour: DevourBody, eater: WormBody | undefined, victim: WormBody | undefined): void {
  devour.alive = false;
  if (eater !== undefined) release(eater);
  // A devour cut short before the swallow still holds its victim: let it go.
  if (victim !== undefined && !devour.swallowed) release(victim);
  world.events.push({ type: 'devourEnd', devourId: devour.id, attackerId: devour.attackerId, victimId: devour.victimId, eaten: devour.swallowed });
}

/**
 * Ends every live devour on the spot and lets its worms go. For a match that ends mid meal (a
 * surrender): the sim is not stepped after MatchEnd, so a devour left alive would never finish.
 */
export function cancelDevours(world: SimWorld): void {
  for (const devour of world.devours) {
    if (devour.alive) end(world, devour, wormById(world, devour.attackerId), wormById(world, devour.victimId));
  }
  world.devours = world.devours.filter((d) => d.alive);
}

/** Where a bite lands and which way its blood goes: out of the mouth, forward and up, a new angle each time. */
function bitePoint(devour: DevourBody): HitPoint {
  const lift = BITE_SPRAY[devour.chomps % BITE_SPRAY.length] ?? 0.8;
  return {
    x: devour.mouthX + devour.facing * 3,
    y: devour.mouthY - WORM_HEIGHT * 0.5,
    dx: Math.cos(lift) * devour.facing,
    dy: -Math.sin(lift),
  };
}

function bite(world: SimWorld, devour: DevourBody, victim: WormBody): void {
  const at = bitePoint(devour);
  devour.chomps += 1;
  world.events.push({ type: 'damage', wormId: victim.id, amount: devour.spec.chompDamage, sourceTeamId: devour.ownerTeamId, sourceWormId: devour.attackerId, cause: 'melee', at });
  beat(world, devour, 'chomp', devour.chomps, at.x, at.y);
  const crunch = DEVOUR_SOUNDS.chomp[devour.chomps % DEVOUR_SOUNDS.chomp.length] ?? 'wpn_bat_crack';
  sound(world, crunch, at.x, at.y);
  if (devour.chomps % 2 === 1) {
    const scream = DEVOUR_SOUNDS.scream[Math.floor(devour.chomps / 2) % DEVOUR_SOUNDS.scream.length] ?? 'wrm_hurt_grunt_1';
    sound(world, scream, at.x, at.y);
  }
}

/** Down the throat: whatever health is left goes with it, and the body leaves the world. */
function swallow(world: SimWorld, devour: DevourBody, victim: WormBody, eater: WormBody): void {
  const at = bitePoint(devour);
  devour.swallowed = true;
  world.events.push({ type: 'damage', wormId: victim.id, amount: SWALLOW_DAMAGE, sourceTeamId: devour.ownerTeamId, sourceWormId: devour.attackerId, cause: 'melee', at });
  beat(world, devour, 'gulp', 0, at.x, at.y);
  sound(world, DEVOUR_SOUNDS.gulp, at.x, at.y);
  victim.x = eater.x;
  victim.y = eater.y;
  victim.vx = 0;
  victim.vy = 0;
  victim.motion = 'dead';
  victim.alive = false;
}

/** One tick of Gear 5. Runs after the worm controller, so the placements here are final for the tick. */
export function stepDevour(world: SimWorld, devour: DevourBody): void {
  if (!devour.alive) return;
  const eater = wormById(world, devour.attackerId);
  const victim = wormById(world, devour.victimId);
  if (eater === undefined || !eater.alive) {
    end(world, devour, eater, victim);
    return;
  }
  const spec = devour.spec;
  devour.stageTicks += 1;
  const victimUp = victim !== undefined && victim.alive && !devour.swallowed;
  place(eater, devour.holdX, devour.holdY);
  switch (devour.stage) {
    case 'awaken': {
      if (victimUp) place(victim, devour.grabX, devour.grabY);
      const drum = drumTicks(spec).indexOf(devour.stageTicks);
      if (drum !== -1) {
        beat(world, devour, 'drum', drum + 1, eater.x, eater.y - WORM_HEIGHT / 2);
        sound(world, DEVOUR_SOUNDS.drum, eater.x, eater.y);
      }
      if (devour.stageTicks >= ticksFor(spec.awakenMs)) {
        beat(world, devour, 'awake', 0, eater.x, eater.y - WORM_HEIGHT / 2);
        for (const id of DEVOUR_SOUNDS.awake) sound(world, id, eater.x, eater.y);
        enter(devour, 'stretch');
        beat(world, devour, 'stretch', 0, devour.shoulderX, devour.shoulderY);
        sound(world, DEVOUR_SOUNDS.stretch, eater.x, eater.y);
      }
      return;
    }
    case 'stretch':
      if (victimUp) place(victim, devour.grabX, devour.grabY);
      if (devour.stageTicks >= ticksFor(spec.stretchMs)) {
        beat(world, devour, victimUp ? 'grab' : 'snap', 0, devour.reachX, devour.reachY);
        sound(world, DEVOUR_SOUNDS.grab, devour.reachX, devour.reachY);
        enter(devour, 'reel');
      }
      return;
    case 'reel': {
      const t = Math.min(1, devour.stageTicks / ticksFor(spec.reelMs));
      if (victimUp) {
        const feet = reeledFeet(devour, t);
        place(victim, feet.x, feet.y);
      }
      if (t >= 1) enter(devour, victimUp ? 'chew' : 'recover');
      return;
    }
    case 'chew': {
      if (!victimUp) {
        enter(devour, 'recover');
        return;
      }
      place(victim, devour.mouthX, devour.mouthY);
      const interval = ticksFor(spec.chompIntervalMs);
      if ((devour.stageTicks - 1) % interval === 0 && devour.chomps < spec.chomps) bite(world, devour, victim);
      if (devour.stageTicks >= spec.chomps * interval) {
        swallow(world, devour, victim, eater);
        enter(devour, 'recover');
      }
      return;
    }
    case 'recover':
      if (devour.swallowed && !devour.burped && devour.stageTicks >= Math.round(ticksFor(spec.recoverMs) * BURP_AT)) {
        devour.burped = true;
        const x = devour.mouthX + devour.facing * 2;
        const y = devour.mouthY - WORM_HEIGHT * 0.5;
        beat(world, devour, 'burp', 0, x, y);
        for (const id of DEVOUR_SOUNDS.burp) sound(world, id, x, y);
      }
      if (devour.stageTicks >= ticksFor(spec.recoverMs)) end(world, devour, eater, victim);
      return;
  }
}
