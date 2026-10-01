/**
 * The Hiken in the sim (Portgas D. Ace's Fire Fist): a timeline the world steps once per tick. The
 * worm draws its fist back as its arm catches fire, then throws it: a fist of fire flies straight
 * along the aim until it meets land, a worm or the water, or runs out of reach, and bursts there,
 * flinging burning blobs about that roll and go off like the napalm gun's.
 *
 * The attacker is HELD through the windup and the throw, and let go as the fist bursts, before the
 * blast, so a burst that reaches it throws it like anyone else. The blobs are ordinary projectiles:
 * the turn's Resolving waits for them to burn out.
 *
 * Damage is emitted, never applied (the match reducer applies it).
 */

import { TICK_S } from '../constants.ts';
import { explode } from '../explosion.ts';
import { spawnProjectile } from '../projectile.ts';
import type { HikenBody, HikenStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { HikenSpec } from '../../weapons/types.ts';
import { THROWN_CORE_PX, beat, enter, finished, flightStop, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of the Hiken; the call is a voice line the mixer skips until it is generated. */
export const HIKEN_SOUNDS = Object.freeze({
  flare: 'wpn_firepunch_whoosh',
  call: 'voice_super_hiken',
  release: 'wpn_firepunch_whoosh',
  roar: 'wpn_bazooka_launch',
  burst: 'exp_large',
});

/** The fan the blobs are flung in: degrees either side of its middle, and how far that leans the way the fist flew, off straight up. */
export const FLAME_SPREAD_DEG = 55;
export const FLAME_LEAN_DEG = 30;

export interface SpawnHikenParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: HikenSpec;
  /** Where the fist leaves the shoulder, and its direction (normalised here). */
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
}

export function spawnHiken(world: SimWorld, params: SpawnHikenParams): HikenBody {
  const { attacker, spec } = params;
  const norm = Math.hypot(params.dx, params.dy) || 1;
  const dx = params.dx / norm;
  const dy = params.dy / norm;
  const facing: 1 | -1 = dx > 0 ? 1 : dx < 0 ? -1 : attacker.facing;
  attacker.facing = facing;
  const body: HikenBody = {
    id: world.nextId(),
    kind: 'hiken',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'windup',
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
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  beat(world, body, 'flare', 0, params.x0, params.y0);
  sound(world, HIKEN_SOUNDS.flare, attacker.x, attacker.y);
  sound(world, HIKEN_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

/** The fist in flight, world px; null before the throw and after the burst. */
export function hikenAt(body: HikenBody): { readonly x: number; readonly y: number } | null {
  if (body.stage !== 'fly') return null;
  return { x: body.x0 + body.dx * body.travelled, y: body.y0 + body.dy * body.travelled };
}

export function hikenHolds(body: HikenBody, out: Set<string>): void {
  if (body.stage !== 'recover') out.add(body.attackerId);
}

export function hikenStageLength(body: HikenBody): number {
  const spec = body.spec;
  const lengths: Readonly<Record<HikenStage, number>> = {
    windup: ticksFor(spec.windupMs),
    fly: Math.max(1, Math.ceil(spec.rangePx / (spec.speedPxPerS * TICK_S))),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

export function cancelHiken(world: SimWorld, body: HikenBody): void {
  if (body.stage !== 'recover') release(wormById(world, body.attackerId));
  finished(world, body, body.burstX !== null);
}

/** The fist bursts at (x, y): the blast, and the burning blobs flung up out of it. */
function burst(world: SimWorld, body: HikenBody, x: number, y: number, attacker: WormBody | undefined): void {
  const spec = body.spec;
  body.burstX = x;
  body.burstY = y;
  enter(body, 'recover');
  release(attacker);
  beat(world, body, 'burst', 0, x, y);
  explode(world, { x, y, blast: spec.blast, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, soundId: HIKEN_SOUNDS.burst });
  // Flung up and on, the way the fist was going, not back at whoever threw it.
  const half = (FLAME_SPREAD_DEG * Math.PI) / 180;
  const middle = -Math.PI / 2 + Math.sign(body.dx || body.facing) * ((FLAME_LEAN_DEG * Math.PI) / 180);
  for (let i = 0; i < spec.flames; i += 1) {
    const t = spec.flames === 1 ? 0.5 : i / (spec.flames - 1);
    const angle = middle - half + 2 * half * t;
    const speed = spec.flameSpeed * (1 - world.rng.nextFloat(0, 0.3));
    spawnProjectile(world, {
      kind: 'cluster_child',
      weaponId: 'napalm_blob',
      ownerTeamId: body.ownerTeamId,
      ownerWormId: body.attackerId,
      x,
      y: y - 3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spec: spec.flameProjectile,
      blast: spec.flameBlast,
      windAffected: false,
      gravityScale: 1,
    });
  }
}

/** One tick of the Hiken. Runs after the worm controller, so the placement here is final. */
export function stepHiken(world: SimWorld, body: HikenBody): void {
  const attacker = wormById(world, body.attackerId);
  if (attacker === undefined || !attacker.alive) {
    const at = hikenAt(body);
    if (at !== null) burst(world, body, at.x, at.y, attacker);
    cancelHiken(world, body);
    return;
  }
  const spec = body.spec;
  body.stageTicks += 1;
  if (body.stage !== 'recover') place(attacker, body.holdX, body.holdY);
  switch (body.stage) {
    case 'windup':
      if (body.stageTicks < ticksFor(spec.windupMs)) return;
      enter(body, 'fly');
      beat(world, body, 'release', 0, body.x0, body.y0);
      sound(world, HIKEN_SOUNDS.release, body.x0, body.y0);
      sound(world, HIKEN_SOUNDS.roar, body.x0, body.y0);
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
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.burstX !== null);
      return;
  }
}
