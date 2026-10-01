/**
 * The Tesoro del Cielo in the sim (Shaka of Virgo's Tenbu Horin), in two scenes the world steps once
 * per tick.
 *
 * The cast, on the caster's turn: the worm sits in the lotus, the twin trees bloom behind it and the
 * treasure's wheel comes down over the nearest enemy in plain sight within reach (weapons/behaviors/
 * technique.ts locks it, by the Freezer's rule). Once the wheel closes the target is sealed: the sim
 * says so (a 'sealed' event) and the match ledger keeps the seal (match/seals.ts). With nobody in
 * reach the wheel turns over nothing and the turn is spent all the same.
 *
 * A strike, on each turn the sealed worm's team loses (the controller starts it when the ledger takes
 * the turn): the wheel turns over the sealed worm and takes a sense from it, and the caster pays for
 * it out of its own health (a toll, like a super's). The last strike takes the worm's life.
 *
 * The caster is HELD for the cast; the sealed worm is held for a strike, lifted a little in the
 * wheel's light, and let go before the end (at 0 hp after the last, it bursts like any other).
 *
 * Damage is emitted, never applied (the match reducer applies it).
 */

import { wormMiddleY } from '../worm-size.ts';
import type { TreasureBody, TreasureStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { TreasureSpec } from '../../weapons/types.ts';
import { beat, enter, finished, kill, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of the Tesoro del Cielo; the call is a voice line the mixer skips until it is generated. */
export const TREASURE_SOUNDS = Object.freeze({
  om: 'wpn_holy_choir',
  call: 'voice_super_tenbu_horin',
  wheel: 'ui_power_charge',
  seal: 'wpn_mine_arm',
  miss: 'exp_small_1',
  sense: 'wpn_teleport_zap',
  gasp: Object.freeze(['wrm_hurt_grunt_1', 'wrm_hurt_grunt_2', 'wrm_hurt_grunt_3']),
  nirvana: 'wpn_holy_blast',
});

/** How high the sealed worm floats in the wheel's light during a strike, world px. */
export const STRIKE_LIFT_PX = 6;
/** The share of a strike gone when the sense is taken: the wheel turns first, then it bites. */
export const STRIKE_LANDS_AT = 0.55;

export interface SpawnTreasureCastParams {
  readonly weaponId: string;
  readonly caster: WormBody;
  readonly target: WormBody | null;
  readonly spec: TreasureSpec;
  readonly facing: 1 | -1;
}

export function spawnTreasureCast(world: SimWorld, params: SpawnTreasureCastParams): TreasureBody {
  const { caster, target, spec, facing } = params;
  caster.facing = facing;
  const body: TreasureBody = {
    id: world.nextId(),
    kind: 'treasure',
    weaponId: params.weaponId,
    attackerId: caster.id,
    ownerTeamId: caster.teamId,
    spec,
    stage: 'cast',
    stageTicks: 0,
    holdX: caster.x,
    holdY: caster.y,
    facing,
    mode: 'cast',
    victimId: target === null ? null : target.id,
    targetX: target === null ? caster.x + facing * 60 : target.x,
    targetY: target === null ? caster.y : target.y,
    hit: 0,
    fatal: false,
    landed: false,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, caster.x, caster.y);
  sound(world, TREASURE_SOUNDS.om, caster.x, caster.y);
  sound(world, TREASURE_SOUNDS.call, caster.x, caster.y);
  return body;
}

export interface SpawnTreasureStrikeParams {
  readonly weaponId: string;
  readonly casterId: string;
  readonly casterTeamId: string;
  readonly target: WormBody;
  readonly spec: TreasureSpec;
  /** Which strike, from 1, and whether it is the last one. */
  readonly hit: number;
  readonly fatal: boolean;
}

/** One strike of the treasure on its sealed worm, started by the controller on a turn the ledger took. */
export function spawnTreasureStrike(world: SimWorld, params: SpawnTreasureStrikeParams): TreasureBody {
  const { target } = params;
  const caster = wormById(world, params.casterId);
  const facing: 1 | -1 = caster === undefined ? 1 : target.x >= caster.x ? 1 : -1;
  const body: TreasureBody = {
    id: world.nextId(),
    kind: 'treasure',
    weaponId: params.weaponId,
    attackerId: params.casterId,
    ownerTeamId: params.casterTeamId,
    spec: params.spec,
    stage: 'strike',
    stageTicks: 0,
    holdX: caster?.x ?? target.x,
    holdY: caster?.y ?? target.y,
    facing,
    mode: 'strike',
    victimId: target.id,
    targetX: target.x,
    targetY: target.y,
    hit: params.hit,
    fatal: params.fatal,
    landed: false,
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, target.x, target.y);
  sound(world, TREASURE_SOUNDS.om, target.x, target.y);
  return body;
}

/** The worms the treasure holds this tick: the caster in the lotus for a cast, the sealed worm for a strike. */
export function treasureHolds(body: TreasureBody, out: Set<string>): void {
  if (body.stage === 'cast') out.add(body.attackerId);
  if (body.stage === 'strike' && body.victimId !== null) out.add(body.victimId);
}

export function treasureStageLength(body: TreasureBody): number {
  const spec = body.spec;
  const lengths: Readonly<Record<TreasureStage, number>> = {
    cast: ticksFor(spec.castMs),
    strike: ticksFor(spec.strikeMs),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

/** Total length of a cast, and of a strike, in ticks. */
export function treasureTicks(spec: TreasureSpec, mode: 'cast' | 'strike'): number {
  return (mode === 'cast' ? ticksFor(spec.castMs) : ticksFor(spec.strikeMs)) + ticksFor(spec.recoverMs);
}

/** The tick of a strike on which the sense goes. */
export function strikeLandTick(spec: TreasureSpec): number {
  return Math.max(1, Math.round(ticksFor(spec.strikeMs) * STRIKE_LANDS_AT));
}

export function cancelTreasure(world: SimWorld, body: TreasureBody): void {
  if (body.stage === 'cast') release(wormById(world, body.attackerId));
  if (body.stage === 'strike') release(wormById(world, body.victimId));
  finished(world, body, body.landed);
}

/** The wheel closes on the target: the ledger hears of the seal. */
function seal(world: SimWorld, body: TreasureBody, target: WormBody): void {
  const spec = body.spec;
  body.landed = true;
  const middle = wormMiddleY(target);
  world.events.push({ type: 'sealed', weaponId: body.weaponId, casterId: body.attackerId, casterTeamId: body.ownerTeamId, targetId: target.id, hits: spec.hits, hitToll: spec.hitToll });
  beat(world, body, 'seal', spec.hits, target.x, middle);
  sound(world, TREASURE_SOUNDS.seal, target.x, middle);
}

/** A strike bites: a sense goes from the sealed worm, the caster pays, and the last strike kills. */
function bite(world: SimWorld, body: TreasureBody, target: WormBody): void {
  const spec = body.spec;
  body.landed = true;
  const middle = wormMiddleY(target);
  const caster = wormById(world, body.attackerId);
  if (caster !== undefined && caster.alive) {
    world.events.push({ type: 'damage', wormId: caster.id, amount: spec.hitToll, sourceTeamId: null, sourceWormId: null, cause: 'toll', at: { x: caster.x, y: wormMiddleY(caster), dx: 0, dy: -1 } });
  }
  if (body.fatal) {
    kill(world, body, target, 'blast');
    beat(world, body, 'nirvana', body.hit, target.x, middle);
    sound(world, TREASURE_SOUNDS.nirvana, target.x, middle);
    return;
  }
  beat(world, body, 'sense', body.hit, target.x, middle);
  sound(world, TREASURE_SOUNDS.sense, target.x, middle);
  sound(world, TREASURE_SOUNDS.gasp[(body.hit - 1) % TREASURE_SOUNDS.gasp.length] ?? 'wrm_hurt_grunt_1', target.x, middle);
}

/** One tick of the Tesoro del Cielo. Runs after the worm controller, so the placements here are final. */
export function stepTreasure(world: SimWorld, body: TreasureBody): void {
  const spec = body.spec;
  const target = wormById(world, body.victimId);
  const targetUp = target !== undefined && target.alive && target.motion !== 'drowning';
  body.stageTicks += 1;
  switch (body.stage) {
    case 'cast': {
      const caster = wormById(world, body.attackerId);
      if (caster === undefined || !caster.alive) {
        cancelTreasure(world, body);
        return;
      }
      place(caster, body.holdX, body.holdY);
      if (targetUp) place(target, body.targetX, body.targetY);
      if (body.stageTicks === Math.ceil(ticksFor(spec.castMs) * 0.4)) sound(world, TREASURE_SOUNDS.wheel, body.targetX, body.targetY);
      if (body.stageTicks < ticksFor(spec.castMs)) return;
      enter(body, 'recover');
      release(caster);
      if (targetUp) {
        release(target);
        beat(world, body, 'wheel', 0, target.x, wormMiddleY(target));
        seal(world, body, target);
      } else {
        beat(world, body, 'miss', 0, body.targetX, body.targetY - 8);
        sound(world, TREASURE_SOUNDS.miss, body.targetX, body.targetY);
      }
      return;
    }
    case 'strike': {
      if (!targetUp) {
        cancelTreasure(world, body);
        return;
      }
      const t = Math.min(1, body.stageTicks / Math.max(1, strikeLandTick(spec)));
      place(target, body.targetX, body.targetY - STRIKE_LIFT_PX * t);
      if (body.stageTicks === strikeLandTick(spec)) bite(world, body, target);
      if (body.stageTicks < ticksFor(spec.strikeMs)) return;
      enter(body, 'recover');
      release(target);
      return;
    }
    case 'recover':
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.landed);
      return;
  }
}
