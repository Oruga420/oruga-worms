/**
 * time_stop in the sim: a timeline the world steps once per tick, modeled on the Explosión Final
 * (sim/techniques/final.ts). The worm plants its feet and the world seems to hold its breath, then
 * the freeze goes out: every other living worm owes the ledger one skipped own turn (match/turn.ts).
 * Physics is untouched; a frozen worm still falls, still drowns, during the turns it sits out.
 *
 * The caster is HELD through the charge (stepWorld skips it in the worm controller) and let go once
 * the freeze lands. The freeze itself is not damage: it is emitted as its own sim event and the
 * match reducer is the only thing that ever decides who it reaches.
 */

import type { TimeStopBody, TimeStopStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { TimeStopSpec } from '../../weapons/types.ts';
import { beat, enter, finished, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of time_stop; the call is a voice line the mixer skips until it is generated. */
export const TIME_STOP_SOUNDS = Object.freeze({
  charge: 'wld_timer_beep',
  call: 'wpn_teleport_zap',
  freeze: 'exp_small_1',
});

export interface SpawnTimeStopParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: TimeStopSpec;
}

export function spawnTimeStop(world: SimWorld, params: SpawnTimeStopParams): TimeStopBody {
  const { attacker, spec } = params;
  const body: TimeStopBody = {
    id: world.nextId(),
    kind: 'time_stop',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'charge',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing: attacker.facing,
    applied: false,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, TIME_STOP_SOUNDS.charge, attacker.x, attacker.y);
  sound(world, TIME_STOP_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

/** The worm time_stop holds this tick: its caster, through the charge. */
export function timeStopHolds(body: TimeStopBody, out: Set<string>): void {
  if (body.stage === 'charge') out.add(body.attackerId);
}

export function timeStopStageLength(body: TimeStopBody): number {
  const lengths: Readonly<Record<TimeStopStage, number>> = {
    charge: ticksFor(body.spec.chargeMs),
    recover: ticksFor(body.spec.recoverMs),
  };
  return lengths[body.stage];
}

export function cancelTimeStop(world: SimWorld, body: TimeStopBody): void {
  if (body.stage === 'charge') release(wormById(world, body.attackerId));
  finished(world, body, body.applied);
}

/** The freeze goes out: every other living worm owes the ledger one skipped own turn. */
function freeze(world: SimWorld, body: TimeStopBody, attacker: WormBody): void {
  body.applied = true;
  enter(body, 'recover');
  release(attacker);
  world.events.push({ type: 'freeze', casterId: attacker.id, turns: body.spec.freezeTurns });
  beat(world, body, 'freeze', 0, attacker.x, attacker.y);
  sound(world, TIME_STOP_SOUNDS.freeze, attacker.x, attacker.y);
}

/** One tick of time_stop. Runs after the worm controller, so the placement here is final. */
export function stepTimeStop(world: SimWorld, body: TimeStopBody): void {
  const attacker = wormById(world, body.attackerId);
  body.stageTicks += 1;
  switch (body.stage) {
    case 'charge':
      if (attacker === undefined || !attacker.alive) {
        // Gone before the freeze could go out (drowned, or the match ended): nothing locks up.
        cancelTimeStop(world, body);
        return;
      }
      place(attacker, body.holdX, body.holdY);
      if (body.stageTicks < ticksFor(body.spec.chargeMs)) return;
      freeze(world, body, attacker);
      return;
    case 'recover':
      if (body.stageTicks >= ticksFor(body.spec.recoverMs)) finished(world, body, body.applied);
      return;
  }
}
