/**
 * force_field in the sim: a timeline the world steps once per tick, modeled on the Explosión Final
 * (sim/techniques/final.ts). The worm raises a barrier around itself; once it is up, the shield
 * goes out as its own sim event, and the match reducer is the only thing that ever decides what it
 * absorbs or blocks (match/machine.ts onDamageApplied).
 *
 * The caster is HELD through the charge (stepWorld skips it in the worm controller) and let go once
 * the shield lands.
 */

import type { ForceFieldBody, ForceFieldStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { ForceFieldSpec } from '../../weapons/types.ts';
import { beat, enter, finished, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of force_field; the call is a voice line the mixer skips until it is generated. */
export const FORCE_FIELD_SOUNDS = Object.freeze({
  charge: 'wpn_teleport_zap',
  shield: 'wpn_holy_choir',
});

export interface SpawnForceFieldParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: ForceFieldSpec;
}

export function spawnForceField(world: SimWorld, params: SpawnForceFieldParams): ForceFieldBody {
  const { attacker, spec } = params;
  const body: ForceFieldBody = {
    id: world.nextId(),
    kind: 'force_field',
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
  sound(world, FORCE_FIELD_SOUNDS.charge, attacker.x, attacker.y);
  return body;
}

/** The worm force_field holds this tick: its caster, through the charge. */
export function forceFieldHolds(body: ForceFieldBody, out: Set<string>): void {
  if (body.stage === 'charge') out.add(body.attackerId);
}

export function forceFieldStageLength(body: ForceFieldBody): number {
  const lengths: Readonly<Record<ForceFieldStage, number>> = {
    charge: ticksFor(body.spec.chargeMs),
    recover: ticksFor(body.spec.recoverMs),
  };
  return lengths[body.stage];
}

export function cancelForceField(world: SimWorld, body: ForceFieldBody): void {
  if (body.stage === 'charge') release(wormById(world, body.attackerId));
  finished(world, body, body.applied);
}

/** The barrier goes up: the caster's own event, the match layer gives it its buffer and its expiry. */
function raise(world: SimWorld, body: ForceFieldBody, attacker: WormBody): void {
  body.applied = true;
  enter(body, 'recover');
  release(attacker);
  world.events.push({ type: 'shield', casterId: attacker.id, durability: body.spec.durability, ownTurns: body.spec.ownTurns });
  beat(world, body, 'shield', 0, attacker.x, attacker.y);
  sound(world, FORCE_FIELD_SOUNDS.shield, attacker.x, attacker.y);
}

/** One tick of force_field. Runs after the worm controller, so the placement here is final. */
export function stepForceField(world: SimWorld, body: ForceFieldBody): void {
  const attacker = wormById(world, body.attackerId);
  body.stageTicks += 1;
  switch (body.stage) {
    case 'charge':
      if (attacker === undefined || !attacker.alive) {
        // Gone before the barrier could go up (drowned, or the match ended): no shield raised.
        cancelForceField(world, body);
        return;
      }
      place(attacker, body.holdX, body.holdY);
      if (body.stageTicks < ticksFor(body.spec.chargeMs)) return;
      raise(world, body, attacker);
      return;
    case 'recover':
      if (body.stageTicks >= ticksFor(body.spec.recoverMs)) finished(world, body, body.applied);
      return;
  }
}
