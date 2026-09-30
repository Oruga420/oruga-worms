/**
 * The Saibaman seed in the sim: a timeline the world steps once per tick, like the Freezer. The worm
 * kneels and pushes a seed into the ground just in front of it (the spot plantSpot finds); the
 * ground shakes and cracks, crack after crack; then it gives, and a Saibaman leaps out of a small
 * crater: a new worm on the planter's team, a share of a worm's size, whose health, name and turns
 * the ledger gives it (match/machine.ts, WormSpawned).
 *
 * The planter is HELD while it plants and while the ground shakes: stepWorld skips it in the worm
 * controller and the sprout places it every tick, so nothing moves it out of the scene. Nobody is
 * held for the recovery. A seed with no ground to go into, or planted by a team already at its cap,
 * withers where it lies and nothing comes out.
 *
 * Mutates the bodies in place (hot path), like the rest of the sim.
 */

import { msToTicks } from '../config/units.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import { firstSolidBelow } from '../terrain/queries.ts';
import { carve } from '../terrain/terrain.ts';
import type { SproutSpec } from '../weapons/types.ts';
import { wormHalfWidth, wormHeight } from './worm-size.ts';
import { headroomFree } from './worm-controller.ts';
import { addWorm } from './worm-body.ts';
import type { SproutBeat, SproutBody, SproutStage, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';

/**
 * Cues of the seed, all present in the audio plan but the cackle, a voice line
 * (voice_super_saibaman_kekeke in tools/audio/sounds.plan.json) the mixer skips until it has been
 * generated.
 */
export const SPROUT_SOUNDS = Object.freeze({
  plant: 'wrm_land',
  crack: 'wpn_bat_crack',
  rumble: 'wrm_fall_thud',
  pop: 'exp_small_2',
  leap: 'wpn_banana_boing',
  wither: 'wrm_hurt_grunt_2',
  cackle: 'voice_super_saibaman_kekeke',
});

/** How far below the planter's feet the ground in front may be and still take a seed, world px. */
const REACH_DOWN_PX = 24;
/** How far above them: a seed goes into a slope going up, not into a wall. */
const REACH_UP_PX = 12;

const NOBODY: ReadonlySet<string> = new Set();

function ticksFor(ms: number): number {
  return Math.max(1, msToTicks(ms));
}

/**
 * Where a seed goes in for a worm standing at (x, y) facing that way: the ground a stride in front,
 * or a little nearer, or failing both just behind, wherever there is land above the water and room
 * over it for a Saibaman to stand up. Null when there is none: the seed can only wither. The CPU
 * asks the same question before it plants (ai/heuristic.ts).
 */
export function plantSpot(mask: TerrainMask, waterY: number, x: number, y: number, facing: 1 | -1, spec: SproutSpec): { readonly x: number; readonly y: number } | null {
  const sprout = { size: spec.size };
  for (const ahead of [spec.plantAheadPx, spec.plantAheadPx * 0.6, -spec.plantAheadPx]) {
    const sx = Math.round(x + facing * ahead);
    const ground = firstSolidBelow(mask, sx, y - REACH_UP_PX, REACH_UP_PX + REACH_DOWN_PX);
    if (ground === null || ground >= waterY || ground <= y - REACH_UP_PX) continue;
    if (!headroomFree(mask, sx, ground - 1, wormHeight(sprout), wormHalfWidth(sprout))) continue;
    return { x: sx, y: ground - 1 };
  }
  return null;
}

/** Living worms on a team, the new one's rivals for a place under the cap. */
export function teamSize(world: SimWorld, teamId: string): number {
  return world.worms.filter((w) => w.alive && w.teamId === teamId).length;
}

/** The next Saibaman's id on a team: counted over the whole match, the dead included, so it is never reused. */
export function sproutIdFor(world: SimWorld, teamId: string): string {
  const prefix = `${teamId}-saiba-`;
  return `${prefix}${world.worms.filter((w) => w.id.startsWith(prefix)).length + 1}`;
}

/** Ticks at which the ground cracks while it shakes: evenly through the grow, the last one before the break. */
export function crackTicks(spec: SproutSpec): readonly number[] {
  const total = ticksFor(spec.growMs);
  const out: number[] = [];
  for (let k = 1; k <= spec.cracks; k += 1) out.push(Math.max(1, Math.round((total * k) / (spec.cracks + 1))));
  return out;
}

/** Total length in ticks: the planting, the shaking (skipped by a seed that withers) and the recovery. */
export function sproutTicks(spec: SproutSpec, fertile = true): number {
  return ticksFor(spec.plantMs) + (fertile ? ticksFor(spec.growMs) : 0) + ticksFor(spec.recoverMs);
}

export interface SpawnSproutParams {
  readonly weaponId: string;
  readonly planter: WormBody;
  readonly spec: SproutSpec;
  /** Where the seed goes in, or null when there is no ground for it. */
  readonly spot: { readonly x: number; readonly y: number } | null;
}

export function spawnSprout(world: SimWorld, params: SpawnSproutParams): SproutBody {
  const { planter, spec, spot } = params;
  const fertile = spot !== null && teamSize(world, planter.teamId) < spec.maxTeamWorms;
  // Toward the seed: a seed planted behind (no room in front) turns the planter round.
  const facing: 1 | -1 = spot === null || spot.x === planter.x ? planter.facing : spot.x > planter.x ? 1 : -1;
  planter.facing = facing;
  const sprout: SproutBody = {
    id: world.nextId(),
    weaponId: params.weaponId,
    planterId: planter.id,
    teamId: planter.teamId,
    spec,
    stage: 'plant',
    stageTicks: 0,
    holdX: planter.x,
    holdY: planter.y,
    facing,
    spotX: spot?.x ?? planter.x + facing * spec.plantAheadPx,
    spotY: spot?.y ?? planter.y,
    fertile,
    cracks: 0,
    sproutId: null,
    alive: true,
  };
  world.sprouts.push(sprout);
  world.events.push({ type: 'sproutStart', sproutId: sprout.id, weaponId: sprout.weaponId, planterId: planter.id, x: sprout.spotX, y: sprout.spotY, facing });
  return sprout;
}

/** Ids of the worms live sprouts hold this tick: every planter, until the Saibaman is out or the seed has withered. */
export function heldBySprouts(sprouts: readonly SproutBody[]): ReadonlySet<string> {
  if (sprouts.length === 0) return NOBODY;
  const held = new Set<string>();
  for (const sprout of sprouts) if (sprout.alive && sprout.stage !== 'recover') held.add(sprout.planterId);
  return held;
}

function stageLength(sprout: SproutBody): number {
  switch (sprout.stage) {
    case 'plant':
      return ticksFor(sprout.spec.plantMs);
    case 'grow':
      return ticksFor(sprout.spec.growMs);
    case 'recover':
      return ticksFor(sprout.spec.recoverMs);
  }
}

/** 0..1 through the current stage, for the presentation. */
export function sproutProgress(sprout: SproutBody): number {
  return Math.min(1, Math.max(0, sprout.stageTicks / stageLength(sprout)));
}

function wormById(world: SimWorld, id: string): WormBody | undefined {
  return world.worms.find((w) => w.id === id);
}

function place(worm: WormBody, x: number, y: number): void {
  worm.x = x;
  worm.y = y;
  worm.vx = 0;
  worm.vy = 0;
  worm.restTicks = 0;
  if (worm.motion !== 'dead') worm.motion = 'idle';
}

/** Hands the held planter back to physics: it settles, or falls, from where it knelt. */
function release(worm: WormBody): void {
  if (!worm.alive) return;
  worm.vx = 0;
  worm.vy = 0;
  worm.motion = 'falling';
  worm.onGround = false;
  worm.restTicks = 0;
  worm.fallStartY = worm.y;
}

function beat(world: SimWorld, sprout: SproutBody, kind: SproutBeat, n: number): void {
  world.events.push({ type: 'sproutBeat', sproutId: sprout.id, planterId: sprout.planterId, beat: kind, n, x: sprout.spotX, y: sprout.spotY, facing: sprout.facing });
}

function sound(world: SimWorld, id: string, x: number, y: number): void {
  world.events.push({ type: 'sound', id, x, y });
}

function enter(sprout: SproutBody, stage: SproutStage): void {
  sprout.stage = stage;
  sprout.stageTicks = 0;
}

function end(world: SimWorld, sprout: SproutBody, planter: WormBody | undefined): void {
  // Cut short before the recovery, the sprout still holds the planter: let it go.
  if (sprout.stage !== 'recover' && planter !== undefined) release(planter);
  sprout.alive = false;
  world.events.push({ type: 'sproutEnd', sproutId: sprout.id, planterId: sprout.planterId, wormId: sprout.sproutId });
}

/**
 * Ends every live sprout on the spot and lets its planter go. For a match that ends mid planting
 * (a surrender): the sim is not stepped after MatchEnd, so a sprout left alive would never finish.
 */
export function cancelSprouts(world: SimWorld): void {
  for (const sprout of world.sprouts) if (sprout.alive) end(world, sprout, wormById(world, sprout.planterId));
  world.sprouts = world.sprouts.filter((s) => s.alive);
}

function wither(world: SimWorld, sprout: SproutBody, planter: WormBody): void {
  beat(world, sprout, 'wither', 0);
  sound(world, SPROUT_SOUNDS.wither, sprout.spotX, sprout.spotY);
  enter(sprout, 'recover');
  release(planter);
}

/**
 * The ground gives: a small crater where the seed went in, and the Saibaman leaps out of it, on the
 * planter's team and facing its way. The team may have filled up while the ground shook (never, in
 * a turn based game, but a test can do it): then the seed withers after all.
 */
function pop(world: SimWorld, sprout: SproutBody, planter: WormBody): void {
  const spec = sprout.spec;
  if (teamSize(world, sprout.teamId) >= spec.maxTeamWorms) {
    wither(world, sprout, planter);
    return;
  }
  const hole = carve(world.terrain, sprout.spotX, sprout.spotY - 1, spec.holePx);
  if (hole.spans.length > 0) world.events.push({ type: 'activity', kind: 'carve' });
  const id = sproutIdFor(world, sprout.teamId);
  const saibaman = addWorm(world, { id, teamId: sprout.teamId, x: sprout.spotX, y: sprout.spotY, facing: sprout.facing, size: spec.size });
  // Out of the ground in a leap: it lands where it came out, and that landing costs it nothing.
  saibaman.vy = -spec.popSpeed;
  saibaman.motion = 'jumping';
  saibaman.onGround = false;
  saibaman.exemptNextLanding = true;
  sprout.sproutId = id;
  world.events.push({ type: 'activity', kind: 'spawn' });
  world.events.push({ type: 'wormSpawned', wormId: id, teamId: sprout.teamId, x: sprout.spotX, y: sprout.spotY, size: spec.size, hpShare: spec.hpShare });
  beat(world, sprout, 'pop', 0);
  sound(world, SPROUT_SOUNDS.pop, sprout.spotX, sprout.spotY);
  sound(world, SPROUT_SOUNDS.leap, sprout.spotX, sprout.spotY);
  sound(world, SPROUT_SOUNDS.cackle, sprout.spotX, sprout.spotY);
  enter(sprout, 'recover');
  release(planter);
}

/** One tick of the seed. Runs after the worm controller, so the placements here are final for the tick. */
export function stepSprout(world: SimWorld, sprout: SproutBody): void {
  if (!sprout.alive) return;
  const planter = wormById(world, sprout.planterId);
  if (planter === undefined || !planter.alive) {
    end(world, sprout, planter);
    return;
  }
  const spec = sprout.spec;
  sprout.stageTicks += 1;
  if (sprout.stage !== 'recover') place(planter, sprout.holdX, sprout.holdY);
  switch (sprout.stage) {
    case 'plant':
      if (sprout.stageTicks === 1) {
        beat(world, sprout, 'plant', 0);
        sound(world, SPROUT_SOUNDS.plant, sprout.spotX, sprout.spotY);
      }
      if (sprout.stageTicks < ticksFor(spec.plantMs)) return;
      if (sprout.fertile) enter(sprout, 'grow');
      else wither(world, sprout, planter);
      return;
    case 'grow':
      if (crackTicks(spec).includes(sprout.stageTicks)) {
        sprout.cracks += 1;
        beat(world, sprout, 'crack', sprout.cracks);
        sound(world, SPROUT_SOUNDS.crack, sprout.spotX, sprout.spotY);
        sound(world, SPROUT_SOUNDS.rumble, sprout.spotX, sprout.spotY);
      }
      if (sprout.stageTicks >= ticksFor(spec.growMs)) pop(world, sprout, planter);
      return;
    case 'recover':
      if (sprout.stageTicks >= ticksFor(spec.recoverMs)) end(world, sprout, planter);
      return;
  }
}
