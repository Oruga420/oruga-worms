/**
 * Beam supers in the sim (Kamehameha): a timeline the world steps once per tick, like a combo.
 * The charge holds the attacker still while the energy gathers in its hands; then the beam's head
 * races along the aim, boring a tunnel through the land and hitting every worm it touches once;
 * where it ends at full reach, it bursts. The full beam holds a moment, fades, and lets the
 * attacker go. The attacker is HELD from the charge to the end: stepWorld skips it in the worm
 * controller and the beam keeps it where it stood.
 *
 * Damage is emitted, never applied (the match reducer applies it), and every hit says where it
 * landed and which way it pushed, so the presentation can spray the blood the right way. Mutates
 * the bodies in place (hot path), like the rest of the sim.
 */

import { msToTicks } from '../config/units.ts';
import { carve } from '../terrain/terrain.ts';
import { TICK_S, WORM_HALF_WIDTH, WORM_HEIGHT } from './constants.ts';
import { explode } from './explosion.ts';
import type { BeamBody, BeamStage, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';
import type { BeamSpec } from '../weapons/types.ts';

/** Cues of the beam, all present in the audio plan. */
export const BEAM_SOUNDS = Object.freeze({
  charge: 'ui_power_charge',
  crackle: 'wpn_teleport_zap',
  fire: Object.freeze(['wpn_holy_blast', 'wpn_supersheep_jet']),
  tip: 'exp_large',
});

const NOBODY: ReadonlySet<string> = new Set();

function ticksFor(ms: number): number {
  return Math.max(1, msToTicks(ms));
}

/** Ticks for the head to cover length px. */
function travelTicks(spec: BeamSpec, length: number): number {
  return Math.max(1, Math.ceil(length / (spec.speedPxPerS * TICK_S)));
}

/** Total length of a beam that runs length px: the charge, the head's run, the hold and the fade. */
export function beamTicks(spec: BeamSpec, length: number = spec.rangePx): number {
  return ticksFor(spec.chargeMs) + travelTicks(spec, length) + ticksFor(spec.holdMs) + ticksFor(spec.fadeMs);
}

/**
 * How far a ray from (x0, y0) along the unit (dx, dy) runs before it leaves a width by height
 * world, capped at reach: the beam's head stops at the edge, it does not fly on unseen.
 */
export function beamReach(x0: number, y0: number, dx: number, dy: number, reach: number, width: number, height: number): number {
  let t = reach;
  if (dx > 0) t = Math.min(t, (width - x0) / dx);
  else if (dx < 0) t = Math.min(t, -x0 / dx);
  if (dy > 0) t = Math.min(t, (height - y0) / dy);
  else if (dy < 0) t = Math.min(t, -y0 / dy);
  return Math.max(0, t);
}

export interface SpawnBeamParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: BeamSpec;
  /** Where the beam leaves the hands, and its direction (normalised here). */
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
}

export function spawnBeam(world: SimWorld, params: SpawnBeamParams): BeamBody {
  const { attacker, spec } = params;
  const norm = Math.hypot(params.dx, params.dy) || 1;
  const dx = params.dx / norm;
  const dy = params.dy / norm;
  const facing: 1 | -1 = dx > 0 ? 1 : dx < 0 ? -1 : attacker.facing;
  attacker.facing = facing;
  const beam: BeamBody = {
    id: world.nextId(),
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'charge',
    stageTicks: 0,
    x0: params.x0,
    y0: params.y0,
    dx,
    dy,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    length: 0,
    maxLength: beamReach(params.x0, params.y0, dx, dy, spec.rangePx, world.terrain.width, world.terrain.height),
    // The tunnel starts clear of the attacker, so the land under its own feet stays put.
    carved: spec.radiusPx + WORM_HALF_WIDTH,
    hit: [],
    alive: true,
  };
  world.beams.push(beam);
  world.events.push({ type: 'beamStart', beamId: beam.id, weaponId: beam.weaponId, attackerId: attacker.id, x: beam.x0, y: beam.y0, dx, dy });
  world.events.push({ type: 'sound', id: BEAM_SOUNDS.charge, x: attacker.x, y: attacker.y });
  return beam;
}

/** Ids of the worms live beams hold this tick: their attackers. */
export function heldByBeams(beams: readonly BeamBody[]): ReadonlySet<string> {
  if (beams.length === 0) return NOBODY;
  const held = new Set<string>();
  for (const beam of beams) if (beam.alive) held.add(beam.attackerId);
  return held;
}

/** 0..1 through the current stage: the charge, the head's run, the hold or the fade. */
export function beamProgress(beam: BeamBody): number {
  const spec = beam.spec;
  if (beam.stage === 'fire') return beam.maxLength <= 0 ? 1 : Math.min(1, beam.length / beam.maxLength);
  const length = beam.stage === 'charge' ? ticksFor(spec.chargeMs) : beam.stage === 'hold' ? ticksFor(spec.holdMs) : ticksFor(spec.fadeMs);
  return Math.min(1, Math.max(0, beam.stageTicks / length));
}

function wormById(world: SimWorld, id: string): WormBody | undefined {
  return world.worms.find((w) => w.id === id);
}

function hold(worm: WormBody, x: number, y: number): void {
  worm.x = x;
  worm.y = y;
  worm.vx = 0;
  worm.vy = 0;
  worm.restTicks = 0;
}

/** Hands the attacker back to physics: it settles, or falls, from where it stood. */
function release(worm: WormBody): void {
  if (!worm.alive) return;
  worm.vx = 0;
  worm.vy = 0;
  worm.motion = 'falling';
  worm.onGround = false;
  worm.restTicks = 0;
  worm.fallStartY = worm.y;
}

function enter(beam: BeamBody, stage: BeamStage): void {
  beam.stage = stage;
  beam.stageTicks = 0;
}

function end(world: SimWorld, beam: BeamBody, attacker: WormBody | undefined): void {
  beam.alive = false;
  if (attacker !== undefined) release(attacker);
  world.events.push({ type: 'beamEnd', beamId: beam.id, attackerId: beam.attackerId, hits: beam.hit.length });
}

/**
 * Ends every live beam on the spot and lets its attacker go. For a match that ends mid beam (a
 * surrender): the sim is not stepped after MatchEnd, so a beam left alive would never finish.
 */
export function cancelBeams(world: SimWorld): void {
  for (const beam of world.beams) if (beam.alive) end(world, beam, wormById(world, beam.attackerId));
  world.beams = world.beams.filter((b) => b.alive);
}

/** Bores the tunnel from where it stopped up to `upTo` px along the beam. */
function bore(world: SimWorld, beam: BeamBody, upTo: number): void {
  const step = Math.max(2, beam.spec.radiusPx * 0.8);
  let carved = false;
  while (beam.carved <= upTo) {
    const result = carve(world.terrain, beam.x0 + beam.dx * beam.carved, beam.y0 + beam.dy * beam.carved, beam.spec.radiusPx);
    if (result.spans.length > 0) carved = true;
    beam.carved += step;
  }
  if (carved) world.events.push({ type: 'activity', kind: 'carve' });
}

/** Every worm the beam, now reaching `upTo` px, touches for the first time takes it and is thrown. */
function strike(world: SimWorld, beam: BeamBody, upTo: number): void {
  const spec = beam.spec;
  const reach = spec.radiusPx + WORM_HALF_WIDTH;
  for (const worm of world.worms) {
    if (!worm.alive || worm.id === beam.attackerId || worm.motion === 'drowning' || beam.hit.includes(worm.id)) continue;
    const cx = worm.x;
    const cy = worm.y - WORM_HEIGHT / 2;
    const along = (cx - beam.x0) * beam.dx + (cy - beam.y0) * beam.dy;
    if (along < 0 || along > upTo + reach) continue;
    // Distance from the beam's axis: the cross product with its unit direction.
    const off = Math.abs((cx - beam.x0) * beam.dy - (cy - beam.y0) * beam.dx);
    if (off > reach) continue;
    beam.hit.push(worm.id);
    const at = { x: cx, y: cy, dx: beam.dx, dy: beam.dy };
    world.events.push({ type: 'damage', wormId: worm.id, amount: spec.damage, sourceTeamId: beam.ownerTeamId, sourceWormId: beam.attackerId, cause: 'blast', at });
    worm.vx = beam.dx * spec.push;
    worm.vy = beam.dy * spec.push - spec.lift;
    worm.motion = 'flying';
    worm.onGround = false;
    worm.restTicks = 0;
    // Like a blast's victim, a worm the beam threw pays no fall damage for that landing.
    worm.exemptNextLanding = true;
  }
}

/** One tick of a beam. Runs after the worm controller, so the attacker's placement here is final. */
export function stepBeam(world: SimWorld, beam: BeamBody): void {
  if (!beam.alive) return;
  const attacker = wormById(world, beam.attackerId);
  if (attacker === undefined || !attacker.alive) {
    end(world, beam, attacker);
    return;
  }
  const spec = beam.spec;
  beam.stageTicks += 1;
  hold(attacker, beam.holdX, beam.holdY);
  switch (beam.stage) {
    case 'charge': {
      const charge = ticksFor(spec.chargeMs);
      if (beam.stageTicks === Math.ceil(charge / 2)) world.events.push({ type: 'sound', id: BEAM_SOUNDS.crackle, x: attacker.x, y: attacker.y });
      if (beam.stageTicks >= charge) {
        enter(beam, 'fire');
        world.events.push({ type: 'beamFire', beamId: beam.id, attackerId: beam.attackerId, x: beam.x0, y: beam.y0, dx: beam.dx, dy: beam.dy });
        for (const id of BEAM_SOUNDS.fire) world.events.push({ type: 'sound', id, x: beam.x0, y: beam.y0 });
      }
      return;
    }
    case 'fire': {
      const next = Math.min(beam.maxLength, beam.length + spec.speedPxPerS * TICK_S);
      bore(world, beam, next);
      strike(world, beam, next);
      beam.length = next;
      if (next >= beam.maxLength) {
        // At full reach it bursts; a beam cut short by the world's edge just leaves it.
        const tipX = beam.x0 + beam.dx * next;
        const tipY = beam.y0 + beam.dy * next;
        if (beam.maxLength >= spec.rangePx - 0.5 && tipY < world.terrain.water.y) {
          explode(world, { x: tipX, y: tipY, blast: spec.tipBlast, sourceTeamId: beam.ownerTeamId, sourceWormId: beam.attackerId, soundId: BEAM_SOUNDS.tip });
        }
        enter(beam, 'hold');
      }
      return;
    }
    case 'hold':
      if (beam.stageTicks >= ticksFor(spec.holdMs)) enter(beam, 'fade');
      return;
    case 'fade':
      if (beam.stageTicks >= ticksFor(spec.fadeMs)) end(world, beam, attacker);
      return;
  }
}
