/**
 * ROOM in the sim: a timeline the world steps once per tick, modeled on time_stop and force_field.
 * The worm declares the region and holds it open while it takes hold (the presentation's expanding
 * field plays over this), then the exchange goes out as its own event; the aim's elevation at the
 * moment of the cast is captured once and held fixed through the charge, exactly like a thrown
 * technique's direction. Everything the event means (the coverage percent, the radius, who is in
 * it, the cyclic hp swap, the caster's cost) is pure match layer math (match/room.ts): the sim only
 * ever reports the caster and that one angle.
 */

import type { RoomBody, RoomStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { RoomSpec } from '../../weapons/types.ts';
import { beat, enter, finished, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of ROOM; the call is a voice line the mixer skips until it is generated. */
export const ROOM_SOUNDS = Object.freeze({
  charge: 'wld_turn_swoosh',
  open: 'wpn_teleport_zap',
});

export interface SpawnRoomParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: RoomSpec;
  readonly angleDeg: number;
}

export function spawnRoom(world: SimWorld, params: SpawnRoomParams): RoomBody {
  const { attacker, spec } = params;
  const body: RoomBody = {
    id: world.nextId(),
    kind: 'room',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'charge',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing: attacker.facing,
    angleDeg: params.angleDeg,
    applied: false,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, ROOM_SOUNDS.charge, attacker.x, attacker.y);
  return body;
}

/** The worm ROOM holds this tick: its caster, through the charge. */
export function roomHolds(body: RoomBody, out: Set<string>): void {
  if (body.stage === 'charge') out.add(body.attackerId);
}

export function roomStageLength(body: RoomBody): number {
  const lengths: Readonly<Record<RoomStage, number>> = {
    charge: ticksFor(body.spec.chargeMs),
    recover: ticksFor(body.spec.recoverMs),
  };
  return lengths[body.stage];
}

export function cancelRoom(world: SimWorld, body: RoomBody): void {
  if (body.stage === 'charge') release(wormById(world, body.attackerId));
  finished(world, body, body.applied);
}

/** The region is declared: the raw aim angle at the cast goes out, match/room.ts resolves the rest. */
function open(world: SimWorld, body: RoomBody, attacker: WormBody): void {
  body.applied = true;
  enter(body, 'recover');
  release(attacker);
  world.events.push({ type: 'roomCast', casterId: attacker.id, angleDeg: body.angleDeg });
  beat(world, body, 'open', 0, attacker.x, attacker.y);
  sound(world, ROOM_SOUNDS.open, attacker.x, attacker.y);
}

/** One tick of ROOM. Runs after the worm controller, so the placement here is final. */
export function stepRoom(world: SimWorld, body: RoomBody): void {
  const attacker = wormById(world, body.attackerId);
  body.stageTicks += 1;
  switch (body.stage) {
    case 'charge':
      if (attacker === undefined || !attacker.alive) {
        // Gone before the region could be declared (drowned, or the match ended): nothing opens.
        cancelRoom(world, body);
        return;
      }
      place(attacker, body.holdX, body.holdY);
      if (body.stageTicks < ticksFor(body.spec.chargeMs)) return;
      open(world, body, attacker);
      return;
    case 'recover':
      if (body.stageTicks >= ticksFor(body.spec.recoverMs)) finished(world, body, body.applied);
      return;
  }
}
