/**
 * Builds the compact CpuTurnRequest the sidecar sends to the model and the heuristic reads
 * (architecture.md section F, ai/state-snapshot.ts). It samples the terrain into about 64 surface
 * heights and computes line of sight and bearing to each enemy, keeping the payload around 2.5 KB.
 * The worm world positions come from the sim; the ammo, wind, difficulty and personality come
 * from the match layer, passed in so this module depends on neither.
 */

import { lineOfSight, sampleProfile } from '../terrain/queries.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import { WALK_SPEED_PX_PER_S, WORM_HEIGHT } from '../sim/constants.ts';
import type { CpuDifficulty, CpuPersonality, CpuTurnRequest, CpuWorm } from './contract.ts';
import { CPU_MOVE_MAX_MS, CPU_TURN_SCHEMA } from './contract.ts';
import type { WeaponId } from '../weapons/types.ts';

export interface SnapshotWorm {
  readonly id: string;
  readonly teamId: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly alive: boolean;
}

export interface SnapshotInput {
  readonly matchId: string;
  readonly turn: number;
  readonly difficulty: CpuDifficulty;
  readonly personality: CpuPersonality;
  readonly windStep: number;
  readonly windFraction: number;
  readonly gravity: number;
  readonly waterY: number;
  readonly mask: TerrainMask;
  readonly activeWormId: string;
  readonly activeTeamId: string;
  readonly worms: readonly SnapshotWorm[];
  readonly ammo: readonly { readonly weapon: WeaponId; readonly count: number }[];
  readonly canMoveLeft: boolean;
  readonly canMoveRight: boolean;
  /** Movement budget the active worm has left this turn, world px of real displacement. */
  readonly walkBudgetPx: number;
  readonly lastTurnSummary?: string;
}

const PROFILE_SAMPLES = 64;

function toCpuWorm(worm: SnapshotWorm): CpuWorm {
  return { id: worm.id, team: worm.teamId, x: Math.round(worm.x), y: Math.round(worm.y), hp: Math.round(worm.hp) };
}

/**
 * The longest walk the sim will honour, in ms at walking speed, from the movement budget left in
 * px; never above the contract's CPU_MOVE_MAX_MS, so the model is told a limit the sanitizer will
 * actually enforce and its plan is never truncated behind its back (backlog 4.4).
 */
export function walkBudgetToMs(walkBudgetPx: number): number {
  if (!Number.isFinite(walkBudgetPx) || walkBudgetPx <= 0) return 0;
  const ms = Math.floor((walkBudgetPx / WALK_SPEED_PX_PER_S) * 1000);
  return Math.max(0, Math.min(CPU_MOVE_MAX_MS, ms));
}

export function buildCpuRequest(input: SnapshotInput): CpuTurnRequest {
  const active = input.worms.find((w) => w.id === input.activeWormId);
  const allies = input.worms.filter((w) => w.alive && w.teamId === input.activeTeamId && w.id !== input.activeWormId);
  const enemies = input.worms.filter((w) => w.alive && w.teamId !== input.activeTeamId);
  const step = Math.max(1, Math.floor(input.mask.width / PROFILE_SAMPLES));
  const profile = Array.from(sampleProfile(input.mask, step));
  const ax = active?.x ?? input.mask.width / 2;
  const ay = (active?.y ?? input.mask.height / 2) - WORM_HEIGHT / 2;
  const los = enemies.map((enemy) => {
    const ex = enemy.x;
    const ey = enemy.y - WORM_HEIGHT / 2;
    return {
      targetWormId: enemy.id,
      clear: lineOfSight(input.mask, Math.round(ax), Math.round(ay), Math.round(ex), Math.round(ey)),
      distancePx: Math.round(Math.hypot(ex - ax, ey - ay)),
      bearingDeg: Math.round((Math.atan2(ay - ey, ex - ax) * 180) / Math.PI),
    };
  });
  return {
    schema: CPU_TURN_SCHEMA,
    matchId: input.matchId,
    turn: input.turn,
    difficulty: input.difficulty,
    personality: input.personality,
    windStep: input.windStep,
    wind: Math.round(input.windFraction * 100) / 100,
    gravity: Math.round(input.gravity),
    waterY: Math.round(input.waterY),
    world: { w: input.mask.width, h: input.mask.height },
    active: {
      wormId: input.activeWormId,
      team: input.activeTeamId,
      x: Math.round(active?.x ?? 0),
      y: Math.round(active?.y ?? 0),
      hp: Math.round(active?.hp ?? 0),
      canMoveLeft: input.canMoveLeft,
      canMoveRight: input.canMoveRight,
      maxWalkMs: walkBudgetToMs(input.walkBudgetPx),
    },
    allies: allies.map(toCpuWorm),
    enemies: enemies.map(toCpuWorm),
    ammo: input.ammo.filter((a) => a.count !== 0),
    terrain: { profile, sampleStepPx: step },
    lineOfSight: los,
    ...(input.lastTurnSummary === undefined ? {} : { lastTurnSummary: input.lastTurnSummary }),
  };
}
