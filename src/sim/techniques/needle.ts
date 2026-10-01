/**
 * Antares in the sim (Milo of Scorpio's Scarlet Needle): a timeline the world steps once per tick.
 * The worm raises a finger at the first worm along its aim (weapons/behaviors/technique.ts finds
 * it) while the nail grows red; fourteen needles sting the victim, one star of the Scorpio
 * constellation each, every one a little damage; then a breath, and the fifteenth needle, Antares,
 * goes into the heart: all the health it has left goes, whatever a crate gave it. Nobody on the
 * line: the needles fly on as far as they get and the light dies, the turn spent all the same.
 *
 * Both worms are HELD from the point until Antares: stepWorld skips them in the worm controller and
 * the needle places them every tick, so the victim shakes under the stings on the spot. The victim
 * at 0 hp is let go once Antares is in, and bursts like any worm at 0 hp (the controller's gore).
 *
 * Damage is emitted, never applied (the match reducer applies it).
 */

import { WORM_HEIGHT } from '../constants.ts';
import { wormMiddleY } from '../worm-size.ts';
import type { NeedleBody, NeedleStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { NeedleSpec } from '../../weapons/types.ts';
import { beat, enter, finished, kill, place, release, sound, started, ticksFor, wormById } from './common.ts';

/**
 * Cues of Antares, all in the audio plan. The call of the needle and of Antares are voice lines
 * (voice_super_* in tools/audio/sounds.plan.json): the mixer skips them until they are generated.
 */
export const NEEDLE_SOUNDS = Object.freeze({
  point: 'ui_power_charge',
  call: 'voice_super_scarlet_needle',
  sting: 'wpn_teleport_zap',
  cry: Object.freeze(['wrm_hurt_grunt_1', 'wrm_hurt_grunt_2', 'wrm_hurt_grunt_3']),
  antares: 'voice_super_antares',
  pierce: 'wpn_holy_blast',
  fizzle: 'exp_small_1',
});

/** The fingertip of the arm held out to point (the sheets' hold_gun pose), where the needles leave. */
export function needleTip(x: number, y: number, facing: 1 | -1): { readonly x: number; readonly y: number } {
  return { x: x + facing * 7, y: y - WORM_HEIGHT * 0.53 };
}

/** Ticks into the sting stage of each sting, from 1: the first at once, then one per interval. */
export function stingTicks(spec: NeedleSpec): readonly number[] {
  const every = ticksFor(spec.stingIntervalMs);
  return Array.from({ length: spec.stings }, (_, k) => 1 + k * every);
}

/** How long the stinging lasts: the stings, and one interval after the last for it to land. */
function stingStage(spec: NeedleSpec): number {
  return spec.stings * ticksFor(spec.stingIntervalMs);
}

/** Total length in ticks: the point, the stings, the breath before Antares and the recovery; a whiff skips the middle. */
export function needleTicks(spec: NeedleSpec, lands = true): number {
  return ticksFor(spec.pointMs) + (lands ? stingStage(spec) + ticksFor(spec.antaresMs) : 0) + ticksFor(spec.recoverMs);
}

export interface SpawnNeedleParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly victim: WormBody | null;
  readonly spec: NeedleSpec;
  readonly facing: 1 | -1;
  /** Where the needles go: the victim's middle, or as far as they got. */
  readonly targetX: number;
  readonly targetY: number;
}

export function spawnNeedle(world: SimWorld, params: SpawnNeedleParams): NeedleBody {
  const { attacker, victim, facing } = params;
  attacker.facing = facing;
  const tip = needleTip(attacker.x, attacker.y, facing);
  const body: NeedleBody = {
    id: world.nextId(),
    kind: 'needle',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec: params.spec,
    stage: 'point',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    victimId: victim === null ? null : victim.id,
    tipX: tip.x,
    tipY: tip.y,
    targetX: params.targetX,
    targetY: params.targetY,
    groundX: victim === null ? params.targetX : victim.x,
    groundY: victim === null ? params.targetY : victim.y,
    stings: 0,
    pierced: false,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, NEEDLE_SOUNDS.point, tip.x, tip.y);
  sound(world, NEEDLE_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

/** The worms a needle holds this tick: the attacker and its victim, until Antares is in. */
export function needleHolds(body: NeedleBody, out: Set<string>): void {
  if (body.stage === 'recover') return;
  out.add(body.attackerId);
  if (body.victimId !== null && !body.pierced) out.add(body.victimId);
}

export function needleStageLength(body: NeedleBody): number {
  const spec = body.spec;
  const lengths: Readonly<Record<NeedleStage, number>> = {
    point: ticksFor(spec.pointMs),
    sting: stingStage(spec),
    antares: ticksFor(spec.antaresMs),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

/** Antares is done before its time (the match ended): let both worms go, the victim spared. */
export function cancelNeedle(world: SimWorld, body: NeedleBody): void {
  if (body.stage !== 'recover') {
    release(wormById(world, body.attackerId));
    if (!body.pierced) release(wormById(world, body.victimId));
  }
  finished(world, body, body.pierced);
}

function toRecover(world: SimWorld, body: NeedleBody, attacker: WormBody): void {
  enter(body, 'recover');
  release(attacker);
  if (!body.pierced) release(wormById(world, body.victimId));
}

/** One tick of Antares. Runs after the worm controller, so the placements here are final for the tick. */
export function stepNeedle(world: SimWorld, body: NeedleBody): void {
  const attacker = wormById(world, body.attackerId);
  if (attacker === undefined || !attacker.alive) {
    cancelNeedle(world, body);
    return;
  }
  const spec = body.spec;
  const victim = wormById(world, body.victimId);
  const victimUp = victim !== undefined && victim.alive && victim.motion !== 'drowning';
  body.stageTicks += 1;
  if (body.stage !== 'recover') place(attacker, body.holdX, body.holdY);
  if (victimUp && !body.pierced && body.stage !== 'recover') place(victim, body.groundX, body.groundY);
  switch (body.stage) {
    case 'point':
      if (body.stageTicks < ticksFor(spec.pointMs)) return;
      if (victimUp) {
        enter(body, 'sting');
        return;
      }
      beat(world, body, 'fizzle', 0, body.targetX, body.targetY);
      sound(world, NEEDLE_SOUNDS.fizzle, body.targetX, body.targetY);
      toRecover(world, body, attacker);
      return;
    case 'sting': {
      if (!victimUp) {
        toRecover(world, body, attacker);
        return;
      }
      if (stingTicks(spec).includes(body.stageTicks)) {
        body.stings += 1;
        const middle = wormMiddleY(victim);
        world.events.push({ type: 'damage', wormId: victim.id, amount: spec.stingDamage, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, cause: 'hit', at: { x: victim.x, y: middle, dx: body.facing, dy: 0 } });
        beat(world, body, 'sting', body.stings, victim.x, middle);
        sound(world, NEEDLE_SOUNDS.sting, victim.x, middle);
        if (body.stings % 5 === 0) sound(world, NEEDLE_SOUNDS.cry[(body.stings / 5) % NEEDLE_SOUNDS.cry.length] ?? 'wrm_hurt_grunt_1', victim.x, middle);
      }
      if (body.stageTicks >= stingStage(spec)) {
        enter(body, 'antares');
        sound(world, NEEDLE_SOUNDS.antares, attacker.x, attacker.y);
      }
      return;
    }
    case 'antares': {
      if (!victimUp) {
        toRecover(world, body, attacker);
        return;
      }
      if (body.stageTicks < ticksFor(spec.antaresMs)) return;
      const middle = wormMiddleY(victim);
      body.pierced = true;
      kill(world, body, victim, 'hit', body.facing, 0);
      beat(world, body, 'antares', 0, victim.x, middle);
      sound(world, NEEDLE_SOUNDS.pierce, victim.x, middle);
      toRecover(world, body, attacker);
      return;
    }
    case 'recover':
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.pierced);
      return;
  }
}
