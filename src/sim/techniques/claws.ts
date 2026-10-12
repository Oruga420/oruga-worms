/**
 * adamantium_claws in the sim: a timeline the world steps once per tick, modeled on Antares
 * (sim/techniques/needle.ts) but shorter: a bounded ranged melee execute, in plain sight, no sting
 * phase. The worm's claws unsheathe; whatever living worm the aim finds first, within reach, before
 * a wall, is gone, whatever its health, same as Antares or Gear 5 (sim/techniques/common.ts kill(),
 * so the same shield and immortality checks in the reducer apply, match/machine.ts onDamageApplied).
 * Nobody on the line: the claws swipe at the air and the turn is spent all the same.
 *
 * Both worms are HELD from the windup to the strike: stepWorld skips them in the worm controller and
 * the technique places them every tick, so the victim does not stumble off out of reach mid swing.
 */

import { wormMiddleY } from '../worm-size.ts';
import type { ClawsBody, ClawsStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { ClawsSpec } from '../../weapons/types.ts';
import { beat, enter, finished, kill, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of adamantium_claws, all in the audio plan. */
export const CLAWS_SOUNDS = Object.freeze({
  unsheathe: 'wpn_bat_crack',
  slash: 'wpn_firepunch_thud',
  miss: 'exp_small_1',
});

export interface SpawnClawsParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly victim: WormBody | null;
  readonly spec: ClawsSpec;
  readonly facing: 1 | -1;
  /** Where the claws reach: the victim's middle, or as far as they got. */
  readonly targetX: number;
  readonly targetY: number;
}

export function spawnClaws(world: SimWorld, params: SpawnClawsParams): ClawsBody {
  const { attacker, victim, facing } = params;
  attacker.facing = facing;
  const body: ClawsBody = {
    id: world.nextId(),
    kind: 'claws',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec: params.spec,
    stage: 'windup',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    victimId: victim === null ? null : victim.id,
    targetX: params.targetX,
    targetY: params.targetY,
    struck: false,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, CLAWS_SOUNDS.unsheathe, attacker.x, attacker.y);
  return body;
}

/** The worms the claws hold this tick: the attacker, and its victim until the strike. */
export function clawsHolds(body: ClawsBody, out: Set<string>): void {
  if (body.stage === 'recover') return;
  out.add(body.attackerId);
  if (body.victimId !== null && !body.struck) out.add(body.victimId);
}

export function clawsStageLength(body: ClawsBody): number {
  const lengths: Readonly<Record<ClawsStage, number>> = {
    windup: ticksFor(body.spec.windupMs),
    recover: ticksFor(body.spec.recoverMs),
  };
  return lengths[body.stage];
}

/** The claws are cut short before the strike (the match ended): let both worms go, the victim spared. */
export function cancelClaws(world: SimWorld, body: ClawsBody): void {
  if (body.stage !== 'recover') {
    release(wormById(world, body.attackerId));
    if (!body.struck) release(wormById(world, body.victimId));
  }
  finished(world, body, body.struck);
}

function toRecover(body: ClawsBody, attacker: WormBody): void {
  enter(body, 'recover');
  release(attacker);
}

/** One tick of adamantium_claws. Runs after the worm controller, so the placements here are final. */
export function stepClaws(world: SimWorld, body: ClawsBody): void {
  const attacker = wormById(world, body.attackerId);
  if (attacker === undefined || !attacker.alive) {
    cancelClaws(world, body);
    return;
  }
  const victim = wormById(world, body.victimId);
  const victimUp = victim !== undefined && victim.alive && victim.motion !== 'drowning';
  body.stageTicks += 1;
  if (body.stage !== 'recover') place(attacker, body.holdX, body.holdY);
  if (victimUp && !body.struck && body.stage !== 'recover') place(victim, victim.x, victim.y);
  switch (body.stage) {
    case 'windup':
      if (body.stageTicks < ticksFor(body.spec.windupMs)) return;
      if (!victimUp) {
        beat(world, body, 'miss', 0, body.targetX, body.targetY);
        sound(world, CLAWS_SOUNDS.miss, body.targetX, body.targetY);
        toRecover(body, attacker);
        return;
      }
      body.struck = true;
      kill(world, body, victim, 'hit', body.facing, 0);
      beat(world, body, 'slash', 0, victim.x, wormMiddleY(victim));
      sound(world, CLAWS_SOUNDS.slash, victim.x, wormMiddleY(victim));
      toRecover(body, attacker);
      return;
    case 'recover':
      if (body.stageTicks >= ticksFor(body.spec.recoverMs)) finished(world, body, body.struck);
      return;
  }
}
