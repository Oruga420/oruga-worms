/**
 * Zoltraak in the sim (Frieren's offensive magic): a timeline the world steps once per tick. Magic
 * circles open one by one in an arc over and behind the worm; then each in turn fires a beam of
 * light at the point the aim finds (the first land or worm along it, or the end of its reach), and
 * each beam goes off where it ends: at that point, or at whatever land or worm it meets on its way
 * there. A circle that would open inside the land does not open.
 *
 * The mage is HELD until the last beam has fired. Damage is emitted, never applied.
 */

import { degToRad } from '../../core/math.ts';
import { discBlocked } from '../collision.ts';
import { WORM_HEIGHT } from '../constants.ts';
import { explode } from '../explosion.ts';
import { wormMiddleY } from '../worm-size.ts';
import type { WormBody, ZoltraakBody, ZoltraakStage } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { ZoltraakSpec } from '../../weapons/types.ts';
import { beat, enter, finished, firstWormOnLine, landOnLine, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of Zoltraak; the incantation is a voice line the mixer skips until it is generated. */
export const ZOLTRAAK_SOUNDS = Object.freeze({
  call: 'voice_super_zoltraak',
  circle: 'wpn_teleport_zap',
  beam: 'wpn_holy_blast',
  hit: 'exp_small_2',
});

/** A circle needs this much clear air round its centre to open, world px. */
export const CIRCLE_CLEARANCE_PX = 4;

/**
 * Where the circles hang round a worm standing at (x, y) facing `facing`: an arc over its head,
 * leaning back the way it does not face, spreadPx out from a point over its middle.
 */
export function circleSpots(spec: ZoltraakSpec, x: number, y: number, facing: 1 | -1): { readonly x: number; readonly y: number }[] {
  const cx = x - facing * 4;
  const cy = y - WORM_HEIGHT * 0.9;
  const spots: { x: number; y: number }[] = [];
  for (let k = 0; k < spec.circles; k += 1) {
    const t = spec.circles === 1 ? 0.5 : k / (spec.circles - 1);
    // From over the worm's back, round over its head, to over its front: -150 to -30 degrees.
    const a = degToRad(-150 + 120 * t);
    spots.push({ x: cx + Math.cos(a) * spec.spreadPx * facing, y: cy + Math.sin(a) * spec.spreadPx });
  }
  return spots;
}

/** Where the beams meet for a worm aiming from (x0, y0) along the unit (dx, dy): the first land or worm, or the end of the reach. */
export function meetingPoint(world: SimWorld, spec: ZoltraakSpec, x0: number, y0: number, dx: number, dy: number, skip: string): { readonly x: number; readonly y: number } {
  const land = landOnLine(world, x0, y0, dx, dy, spec.rangePx);
  const worm = firstWormOnLine(world, x0, y0, dx, dy, spec.rangePx, skip);
  const landT = land === null ? spec.rangePx : land.t;
  if (worm !== null && worm.t <= landT) return { x: worm.worm.x, y: wormMiddleY(worm.worm) };
  return { x: x0 + dx * landT, y: y0 + dy * landT };
}

export interface SpawnZoltraakParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: ZoltraakSpec;
  readonly facing: 1 | -1;
  readonly targetX: number;
  readonly targetY: number;
}

export function spawnZoltraak(world: SimWorld, params: SpawnZoltraakParams): ZoltraakBody {
  const { attacker, spec, facing } = params;
  attacker.facing = facing;
  const circles = circleSpots(spec, attacker.x, attacker.y, facing).filter((spot) => !discBlocked(world.terrain.mask, spot.x, spot.y, CIRCLE_CLEARANCE_PX));
  const body: ZoltraakBody = {
    id: world.nextId(),
    kind: 'zoltraak',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'form',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    circles,
    targetX: params.targetX,
    targetY: params.targetY,
    opened: 0,
    ends: [],
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, ZOLTRAAK_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

export function zoltraakHolds(body: ZoltraakBody, out: Set<string>): void {
  if (body.stage !== 'recover') out.add(body.attackerId);
}

/** Ticks into the form stage at which each circle opens. */
export function circleTicks(spec: ZoltraakSpec, count: number = spec.circles): readonly number[] {
  return Array.from({ length: count }, (_, k) => ticksFor(spec.formMs) + k * ticksFor(spec.circleIntervalMs));
}

function formStage(spec: ZoltraakSpec, count: number): number {
  return (circleTicks(spec, count).at(-1) ?? ticksFor(spec.formMs)) + ticksFor(spec.circleIntervalMs);
}

function fireStage(spec: ZoltraakSpec, count: number): number {
  return Math.max(1, count) * ticksFor(spec.fireIntervalMs);
}

export function zoltraakStageLength(body: ZoltraakBody): number {
  const spec = body.spec;
  const count = body.circles.length;
  const lengths: Readonly<Record<ZoltraakStage, number>> = {
    form: formStage(spec, count),
    fire: fireStage(spec, count),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

export function zoltraakTicks(spec: ZoltraakSpec, count: number = spec.circles): number {
  return formStage(spec, count) + fireStage(spec, count) + ticksFor(spec.recoverMs);
}

export function cancelZoltraak(world: SimWorld, body: ZoltraakBody): void {
  if (body.stage !== 'recover') release(wormById(world, body.attackerId));
  finished(world, body, body.ends.length > 0);
}

/** Circle k fires: its beam runs to the meeting point and goes off where it ends. */
function fireBeam(world: SimWorld, body: ZoltraakBody, k: number): void {
  const circle = body.circles[k];
  if (circle === undefined) return;
  const lx = body.targetX - circle.x;
  const ly = body.targetY - circle.y;
  const length = Math.hypot(lx, ly);
  let end = { x: body.targetX, y: body.targetY };
  if (length > 0) {
    const dx = lx / length;
    const dy = ly / length;
    const land = landOnLine(world, circle.x, circle.y, dx, dy, length);
    const worm = firstWormOnLine(world, circle.x, circle.y, dx, dy, length, body.attackerId);
    const landT = land === null ? length : land.t;
    const t = worm !== null && worm.t < landT ? worm.t : landT;
    end = { x: circle.x + dx * t, y: circle.y + dy * t };
  }
  body.ends.push(end);
  beat(world, body, 'beam', k + 1, end.x, end.y);
  sound(world, ZOLTRAAK_SOUNDS.beam, circle.x, circle.y);
  explode(world, { x: end.x, y: end.y, blast: body.spec.beamBlast, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, soundId: ZOLTRAAK_SOUNDS.hit });
}

/** One tick of Zoltraak. Runs after the worm controller, so the placement here is final. */
export function stepZoltraak(world: SimWorld, body: ZoltraakBody): void {
  const attacker = wormById(world, body.attackerId);
  if (attacker === undefined || !attacker.alive) {
    cancelZoltraak(world, body);
    return;
  }
  const spec = body.spec;
  const count = body.circles.length;
  body.stageTicks += 1;
  if (body.stage !== 'recover') place(attacker, body.holdX, body.holdY);
  switch (body.stage) {
    case 'form': {
      const k = circleTicks(spec, count).indexOf(body.stageTicks);
      const circle = body.circles[k];
      if (k >= 0 && circle !== undefined) {
        body.opened += 1;
        beat(world, body, 'circle', body.opened, circle.x, circle.y);
        sound(world, ZOLTRAAK_SOUNDS.circle, circle.x, circle.y);
      }
      if (body.stageTicks >= formStage(spec, count)) enter(body, 'fire');
      return;
    }
    case 'fire': {
      const every = ticksFor(spec.fireIntervalMs);
      if ((body.stageTicks - 1) % every === 0) fireBeam(world, body, body.ends.length);
      if (body.stageTicks >= fireStage(spec, count)) {
        enter(body, 'recover');
        release(attacker);
      }
      return;
    }
    case 'recover':
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.ends.length > 0);
      return;
  }
}
