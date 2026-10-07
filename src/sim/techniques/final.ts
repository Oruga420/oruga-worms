/**
 * The Explosión Final in the sim (Majin Vegeta's last stand): a timeline the world steps once per
 * tick. The worm plants its feet and gathers everything it has, the air shaking round it, then lets
 * it all go at once: every worm within the kill radius of where it stands is gone, whatever its
 * health, whoever's side it is on, the worm itself first of all, and the land goes with them. There
 * is no price in health: the price is the worm.
 *
 * The worm is HELD through the charge (stepWorld skips it in the worm controller) and let go for
 * the burst, which takes it like anyone else. Damage is emitted, never applied.
 */

import { explode } from '../explosion.ts';
import { wormMiddleY } from '../worm-size.ts';
import type { FinalBody, FinalStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { FinalSpec } from '../../weapons/types.ts';
import { beat, enter, finished, kill, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of the Explosión Final; the farewell is a voice line the mixer skips until it is generated. */
export const FINAL_SOUNDS = Object.freeze({
  charge: 'ui_power_charge',
  call: 'voice_super_final_explosion',
  hum: 'wpn_holy_choir',
  burst: 'wpn_holy_blast',
});

export interface SpawnFinalParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: FinalSpec;
}

export function spawnFinal(world: SimWorld, params: SpawnFinalParams): FinalBody {
  const { attacker, spec } = params;
  const body: FinalBody = {
    id: world.nextId(),
    kind: 'final',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'charge',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing: attacker.facing,
    burstX: null,
    burstY: null,
    killed: [],
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, FINAL_SOUNDS.charge, attacker.x, attacker.y);
  sound(world, FINAL_SOUNDS.hum, attacker.x, attacker.y);
  sound(world, FINAL_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

/** The worm the explosion holds this tick: its user, through the charge. */
export function finalHolds(body: FinalBody, out: Set<string>): void {
  if (body.stage === 'charge') out.add(body.attackerId);
}

export function finalStageLength(body: FinalBody): number {
  const lengths: Readonly<Record<FinalStage, number>> = {
    charge: ticksFor(body.spec.chargeMs),
    recover: ticksFor(body.spec.recoverMs),
  };
  return lengths[body.stage];
}

/** How long the explosion takes from the first tick to the last. */
export function finalTicks(spec: FinalSpec): number {
  return ticksFor(spec.chargeMs) + ticksFor(spec.recoverMs);
}

export function cancelFinal(world: SimWorld, body: FinalBody): void {
  if (body.stage === 'charge') release(wormById(world, body.attackerId));
  finished(world, body, body.killed.length > 0);
}

/** Everything goes at (x, y): every worm within the kill radius, the user included, and the land. */
function burst(world: SimWorld, body: FinalBody, x: number, y: number, attacker: WormBody | undefined): void {
  const spec = body.spec;
  body.burstX = x;
  body.burstY = y;
  enter(body, 'recover');
  release(attacker);
  for (const worm of world.worms) {
    if (!worm.alive || worm.motion === 'drowning') continue;
    const mx = worm.x;
    const my = wormMiddleY(worm);
    const distance = Math.hypot(mx - x, my - y);
    if (distance > spec.killRadiusPx) continue;
    body.killed.push(worm.id);
    kill(world, body, worm, 'blast', distance === 0 ? 0 : (mx - x) / distance, distance === 0 ? -1 : (my - y) / distance);
  }
  beat(world, body, 'burst', body.killed.length, x, y);
  explode(world, { x, y, blast: spec.blast, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, soundId: FINAL_SOUNDS.burst });
}

/** One tick of the Explosión Final. Runs after the worm controller, so the placement here is final. */
export function stepFinal(world: SimWorld, body: FinalBody): void {
  const attacker = wormById(world, body.attackerId);
  body.stageTicks += 1;
  switch (body.stage) {
    case 'charge':
      if (attacker === undefined || !attacker.alive) {
        // Gone before it could let go (drowned, or the match ended): nothing goes off.
        cancelFinal(world, body);
        return;
      }
      place(attacker, body.holdX, body.holdY);
      if (body.stageTicks < ticksFor(body.spec.chargeMs)) return;
      burst(world, body, attacker.x, wormMiddleY(attacker), attacker);
      return;
    case 'recover':
      if (body.stageTicks >= ticksFor(body.spec.recoverMs)) finished(world, body, body.killed.length > 0);
      return;
  }
}
