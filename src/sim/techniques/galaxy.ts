/**
 * The Galaxian Explosion in the sim (Saga of Gemini): a timeline the world steps once per tick. The
 * worm crosses its arms overhead while the stars gather behind it, then hurls a galaxy along its
 * aim. The galaxy flies straight until it meets land, a worm or the water, or runs out of reach, and
 * goes off there: every worm within the kill radius of the burst is gone, whatever its health,
 * whoever's side it is on, the worm that threw it included, and the land goes with them.
 *
 * The attacker is HELD from the charge until the burst: stepWorld skips it in the worm controller.
 * It is let go before the burst, so a burst that reaches it takes it like anyone else.
 *
 * Damage is emitted, never applied (the match reducer applies it).
 */

import { TICK_S } from '../constants.ts';
import { explode } from '../explosion.ts';
import { wormMiddleY } from '../worm-size.ts';
import type { GalaxyBody, GalaxyStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { GalaxySpec } from '../../weapons/types.ts';
import { THROWN_CORE_PX, beat, enter, finished, flightStop, kill, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of the Galaxian Explosion; the call is a voice line the mixer skips until it is generated. */
export const GALAXY_SOUNDS = Object.freeze({
  charge: 'ui_power_charge',
  call: 'voice_super_galaxian',
  hum: 'wpn_holy_choir',
  release: 'wpn_holy_blast',
  burst: 'exp_large',
});

export interface SpawnGalaxyParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: GalaxySpec;
  /** Where the galaxy leaves the hands, and its direction (normalised here). */
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
}

export function spawnGalaxy(world: SimWorld, params: SpawnGalaxyParams): GalaxyBody {
  const { attacker, spec } = params;
  const norm = Math.hypot(params.dx, params.dy) || 1;
  const dx = params.dx / norm;
  const dy = params.dy / norm;
  const facing: 1 | -1 = dx > 0 ? 1 : dx < 0 ? -1 : attacker.facing;
  attacker.facing = facing;
  const body: GalaxyBody = {
    id: world.nextId(),
    kind: 'galaxy',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'charge',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    x0: params.x0,
    y0: params.y0,
    dx,
    dy,
    travelled: 0,
    burstX: null,
    burstY: null,
    killed: [],
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  sound(world, GALAXY_SOUNDS.charge, attacker.x, attacker.y);
  sound(world, GALAXY_SOUNDS.hum, attacker.x, attacker.y);
  sound(world, GALAXY_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

/** The galaxy in flight, world px; null before it leaves the hands and after it has gone off. */
export function galaxyAt(body: GalaxyBody): { readonly x: number; readonly y: number } | null {
  if (body.stage !== 'fly') return null;
  return { x: body.x0 + body.dx * body.travelled, y: body.y0 + body.dy * body.travelled };
}

/** The worm the galaxy holds this tick: its thrower, until the burst. */
export function galaxyHolds(body: GalaxyBody, out: Set<string>): void {
  if (body.stage !== 'recover') out.add(body.attackerId);
}

export function galaxyStageLength(body: GalaxyBody): number {
  const spec = body.spec;
  const lengths: Readonly<Record<GalaxyStage, number>> = {
    charge: ticksFor(spec.chargeMs),
    fly: Math.max(1, Math.ceil(spec.rangePx / (spec.speedPxPerS * TICK_S))),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

/** The longest a galaxy can take, from the charge to the end, flying its whole reach. */
export function galaxyTicks(spec: GalaxySpec): number {
  return ticksFor(spec.chargeMs) + Math.ceil(spec.rangePx / (spec.speedPxPerS * TICK_S)) + 1 + ticksFor(spec.recoverMs);
}

export function cancelGalaxy(world: SimWorld, body: GalaxyBody): void {
  if (body.stage !== 'recover') release(wormById(world, body.attackerId));
  finished(world, body, body.killed.length > 0);
}

/** The galaxy goes off at (x, y): everyone within the kill radius is gone, and the land with them. */
function burst(world: SimWorld, body: GalaxyBody, x: number, y: number, attacker: WormBody | undefined): void {
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
  explode(world, { x, y, blast: spec.blast, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, soundId: GALAXY_SOUNDS.burst });
}

/** One tick of the Galaxian Explosion. Runs after the worm controller, so the placement here is final. */
export function stepGalaxy(world: SimWorld, body: GalaxyBody): void {
  const attacker = wormById(world, body.attackerId);
  if (attacker === undefined || !attacker.alive) {
    // Its thrower gone mid flight: the galaxy still goes off where it is.
    const at = galaxyAt(body);
    if (at !== null) burst(world, body, at.x, at.y, attacker);
    cancelGalaxy(world, body);
    return;
  }
  const spec = body.spec;
  body.stageTicks += 1;
  if (body.stage !== 'recover') place(attacker, body.holdX, body.holdY);
  switch (body.stage) {
    case 'charge':
      if (body.stageTicks < ticksFor(spec.chargeMs)) return;
      enter(body, 'fly');
      beat(world, body, 'release', 0, body.x0, body.y0);
      sound(world, GALAXY_SOUNDS.release, body.x0, body.y0);
      return;
    case 'fly': {
      const next = Math.min(spec.rangePx, body.travelled + spec.speedPxPerS * TICK_S);
      const stop = flightStop(world, body.x0, body.y0, body.dx, body.dy, body.travelled, next, spec.radiusPx, body.attackerId, THROWN_CORE_PX);
      if (stop !== null) {
        body.travelled = stop.t;
        burst(world, body, stop.x, stop.y, attacker);
        return;
      }
      body.travelled = next;
      if (next >= spec.rangePx) burst(world, body, body.x0 + body.dx * next, body.y0 + body.dy * next, attacker);
      return;
    }
    case 'recover':
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.killed.length > 0);
      return;
  }
}
