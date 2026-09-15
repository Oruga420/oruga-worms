/**
 * Mines (architecture.md section C and the design rules): dropped at the worm's feet or map
 * placed, they fall and settle like a grenade, arm when a worm enters the proximity radius and
 * blow after the fixed placed fuse (3 s) or the map fuse; duds never blow. A nearby blast sets
 * them off (explosion.ts). Mutates bodies in place (hot path).
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import type { BlastSpec, SpawnSpec } from '../weapons/types.ts';
import { MINE_RADIUS_PX, REST_SPEED_PX_PER_S, TICK_S, WORM_HEIGHT } from './constants.ts';
import { explode } from './explosion.ts';
import { applyForces, bounce, speedOf, sweepMove } from './integrator.ts';
import type { MineBody } from './types.ts';
import type { SimWorld } from './world.ts';

export interface SpawnMineParams {
  readonly ownerTeamId: string | null;
  readonly x: number;
  readonly y: number;
  readonly spec: SpawnSpec;
  readonly blast: BlastSpec;
  /** Map hazard mines get a random fuse and may be duds; placed mines never do. */
  readonly mapHazard?: boolean;
}

const GRACE_S = 1.5;
const MINE_BOUNCE = 0.5;
const MINE_FRICTION = 0.7;

export function spawnMine(world: SimWorld, params: SpawnMineParams): MineBody {
  const mines = GAME_CONFIG.mines;
  const mapHazard = params.mapHazard === true;
  const mine: MineBody = {
    id: world.nextId(),
    ownerTeamId: params.ownerTeamId,
    x: params.x,
    y: params.y,
    vx: 0,
    vy: 0,
    spec: params.spec,
    blast: params.blast,
    armed: false,
    fuseTicks: -1,
    graceTicks: mapHazard ? 0 : Math.round(GRACE_S / TICK_S),
    alive: true,
    dud: mapHazard && world.rng.next() < mines.dudChance,
  };
  world.mines.push(mine);
  world.events.push({ type: 'activity', kind: 'spawn' });
  return mine;
}

function fuseTicksFor(world: SimWorld, mine: MineBody, mapHazard: boolean): number {
  const mines = GAME_CONFIG.mines;
  const ms = mapHazard ? world.rng.nextFloat(mines.mapFuseMinMs, mines.mapFuseMaxMs) : mines.placedFuseMs;
  const fromSpec = mine.spec.armDelayMs;
  return Math.max(1, Math.round((fromSpec ?? ms) / 1000 / TICK_S));
}

export function stepMine(world: SimWorld, mine: MineBody, dt: number): void {
  if (!mine.alive) return;
  if (mine.graceTicks > 0) mine.graceTicks -= 1;
  if (mine.armed) {
    mine.fuseTicks -= 1;
    if (mine.fuseTicks <= 0) {
      mine.alive = false;
      if (!mine.dud) explode(world, { x: mine.x, y: mine.y, blast: mine.blast, sourceTeamId: mine.ownerTeamId, sourceWormId: null });
      return;
    }
  } else {
    const proximity = mine.spec.proximityPx ?? 0;
    const trigger = world.worms.some((w) => {
      if (!w.alive || (mine.graceTicks > 0 && w.teamId === mine.ownerTeamId)) return false;
      return Math.hypot(w.x - mine.x, w.y - WORM_HEIGHT / 2 - mine.y) <= proximity;
    });
    if (trigger) {
      mine.armed = true;
      mine.fuseTicks = fuseTicksFor(world, mine, mine.graceTicks === 0 && mine.ownerTeamId === null);
      world.events.push({ type: 'sound', id: 'wpn_mine_arm', x: mine.x, y: mine.y });
    }
  }
  const moving = speedOf(mine) >= REST_SPEED_PX_PER_S || !isResting(world, mine);
  if (!moving) return;
  applyForces(mine, dt, 1, 0, false, world.gravity);
  const hit = sweepMove(world.terrain.mask, mine, dt, MINE_RADIUS_PX);
  if (hit !== null) {
    if (bounce(mine, hit, MINE_BOUNCE, MINE_FRICTION)) world.events.push({ type: 'activity', kind: 'bounce' });
  }
  if (mine.y >= world.terrain.water.y) mine.alive = false;
}

function isResting(world: SimWorld, mine: MineBody): boolean {
  const mask = world.terrain.mask;
  const x = Math.round(mine.x);
  const y = Math.round(mine.y) + MINE_RADIUS_PX + 1;
  return mask.data[y * mask.width + x] !== 0 && mine.vx === 0 && mine.vy === 0;
}
