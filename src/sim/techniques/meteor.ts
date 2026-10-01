/**
 * Fujitora's meteor in the sim (Issho, One Piece): a timeline the world steps once per tick. The
 * worm raises its sword at the spot the player clicked and the sky darkens; then gravity drags a
 * meteor down onto it out of the top of the world, slanting in from the side the worm faces, and it
 * falls until it meets land, a worm or the water, wherever that is on its line: the biggest crater
 * in the game.
 *
 * The rock starts clear under the top bedrock ceiling (the air strike's lesson: a body spawned on
 * it went off at the top of the world). The caller is HELD until the rock lands, and let go before
 * the blast, so it is thrown like anyone else when it called the meteor down on its own head.
 *
 * Damage is emitted, never applied (the match reducer applies it).
 */

import { BORDER_BEDROCK_PX } from '../../terrain/mask.ts';
import { TICK_S } from '../constants.ts';
import { explode } from '../explosion.ts';
import type { MeteorBody, MeteorStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { MeteorSpec } from '../../weapons/types.ts';
import { beat, enter, finished, flightStop, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of the meteor; the call is a voice line the mixer skips until it is generated. */
export const METEOR_SOUNDS = Object.freeze({
  call: 'voice_super_meteor',
  rumble: 'wld_sudden_death_siren',
  whistle: 'wpn_bomb_whistle',
  burst: 'exp_large',
  splash: 'exp_water_splash',
});

/** The longest fall a meteor gets, world px: from the top of the tallest world to its bottom and then some. */
export const METEOR_MAX_FALL_PX = 4000;

/** Where a meteor called down on (tx, ty) by a worm facing `facing` starts its fall, and the way it falls. */
export function meteorPath(spec: MeteorSpec, tx: number, ty: number, facing: 1 | -1): { readonly startX: number; readonly startY: number; readonly dx: number; readonly dy: number } {
  const norm = Math.hypot(spec.slant, 1);
  const dx = (facing * spec.slant) / norm;
  const dy = 1 / norm;
  const startY = BORDER_BEDROCK_PX + Math.ceil(spec.radiusPx) + 2;
  // Back along the fall from the target to the top: the line passes through the spot clicked.
  const back = Math.max(0, (ty - startY) / dy);
  return { startX: tx - dx * back, startY, dx, dy };
}

export interface SpawnMeteorParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: MeteorSpec;
  readonly targetX: number;
  readonly targetY: number;
}

export function spawnMeteor(world: SimWorld, params: SpawnMeteorParams): MeteorBody {
  const { attacker, spec } = params;
  const facing: 1 | -1 = params.targetX > attacker.x ? 1 : params.targetX < attacker.x ? -1 : attacker.facing;
  attacker.facing = facing;
  const path = meteorPath(spec, params.targetX, params.targetY, facing);
  const body: MeteorBody = {
    id: world.nextId(),
    kind: 'meteor',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'call',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    targetX: params.targetX,
    targetY: params.targetY,
    startX: path.startX,
    startY: path.startY,
    dx: path.dx,
    dy: path.dy,
    x: path.startX,
    y: path.startY,
    burstX: null,
    burstY: null,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  beat(world, body, 'call', 0, params.targetX, params.targetY);
  sound(world, METEOR_SOUNDS.call, attacker.x, attacker.y);
  sound(world, METEOR_SOUNDS.rumble, params.targetX, params.targetY);
  return body;
}

export function meteorHolds(body: MeteorBody, out: Set<string>): void {
  if (body.stage !== 'recover') out.add(body.attackerId);
}

/** How far the rock has fallen from where it started, world px. */
export function meteorFallen(body: MeteorBody): number {
  return Math.hypot(body.x - body.startX, body.y - body.startY);
}

export function meteorStageLength(body: MeteorBody): number {
  const spec = body.spec;
  const lengths: Readonly<Record<MeteorStage, number>> = {
    call: ticksFor(spec.callMs),
    // Down to the spot it was called on; it may land sooner, or fall past it.
    fall: Math.max(1, Math.ceil(Math.hypot(body.targetX - body.startX, body.targetY - body.startY) / (spec.fallSpeedPxPerS * TICK_S))),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

export function cancelMeteor(world: SimWorld, body: MeteorBody): void {
  if (body.stage !== 'recover') release(wormById(world, body.attackerId));
  finished(world, body, body.burstX !== null);
}

function burst(world: SimWorld, body: MeteorBody, x: number, y: number, attacker: WormBody | undefined): void {
  body.x = x;
  body.y = y;
  body.burstX = x;
  body.burstY = y;
  enter(body, 'recover');
  release(attacker);
  beat(world, body, 'burst', 0, x, y);
  const wet = y >= world.terrain.water.y - 1;
  explode(world, { x, y, blast: body.spec.blast, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, soundId: wet ? METEOR_SOUNDS.splash : METEOR_SOUNDS.burst });
}

/** One tick of the meteor. Runs after the worm controller, so the placement here is final. */
export function stepMeteor(world: SimWorld, body: MeteorBody): void {
  const attacker = wormById(world, body.attackerId);
  const spec = body.spec;
  body.stageTicks += 1;
  if (body.stage !== 'recover' && attacker !== undefined && attacker.alive) place(attacker, body.holdX, body.holdY);
  switch (body.stage) {
    case 'call':
      if (attacker === undefined || !attacker.alive) {
        cancelMeteor(world, body);
        return;
      }
      if (body.stageTicks < ticksFor(spec.callMs)) return;
      enter(body, 'fall');
      beat(world, body, 'fall', 0, body.startX, body.startY);
      sound(world, METEOR_SOUNDS.whistle, body.targetX, body.targetY);
      return;
    case 'fall': {
      // Once called it comes down whatever happens to the one who called it.
      const fallen = meteorFallen(body);
      const next = Math.min(METEOR_MAX_FALL_PX, fallen + spec.fallSpeedPxPerS * TICK_S);
      const stop = flightStop(world, body.startX, body.startY, body.dx, body.dy, fallen, next, spec.radiusPx, null);
      if (stop !== null) {
        burst(world, body, stop.x, stop.y, attacker);
        return;
      }
      body.x = body.startX + body.dx * next;
      body.y = body.startY + body.dy * next;
      const out = body.x < -spec.radiusPx * 4 || body.x > world.terrain.width + spec.radiusPx * 4 || body.y > world.terrain.height + spec.radiusPx;
      if (out || next >= METEOR_MAX_FALL_PX) {
        // Off the edge of the world: it is gone without a sound.
        enter(body, 'recover');
        release(attacker);
      }
      return;
    }
    case 'recover':
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.burstX !== null);
      return;
  }
}
