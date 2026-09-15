/**
 * The deterministic heuristic CPU (architecture.md section F, ai/heuristic.ts): for each weapon
 * with ammo, sample aim angle and power, simulate the shot with the real integrator against the
 * mask, and score by expected enemy damage minus self and ally damage. The best candidate
 * becomes a CpuTurnResponse. Difficulty adds bounded jitter; nothing scoring above zero means
 * Skip Go. Because it uses a seeded index and the real trajectory, it is fully reproducible and
 * can never make the CPU play worse than this floor.
 */

import { GRAVITY_PX_PER_S2 } from '../sim/constants.ts';
import { clamp } from '../core/math.ts';
import type { CpuDifficulty, CpuTurnRequest, CpuTurnResponse } from './contract.ts';
import { CPU_TURN_SCHEMA } from './contract.ts';
import { pickSkipTaunt, pickTaunt } from './taunts.ts';
import { estimateBlast, simulateShot, type ShotSpec, type TrajectoryEnv, type WormPoint } from './trajectory.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import type { WeaponDef, WeaponId } from '../weapons/types.ts';
import type { WeaponRegistry } from '../weapons/registry.ts';
import { degToRad } from '../core/math.ts';

export interface HeuristicInput {
  readonly request: CpuTurnRequest;
  readonly registry: WeaponRegistry;
  readonly mask: TerrainMask;
  /** Worm world positions, keyed by the ids the request uses. */
  readonly worms: readonly WormPoint[];
}

interface Candidate {
  readonly weapon: WeaponId;
  readonly angleDeg: number;
  readonly power: number;
  readonly score: number;
  readonly confidence: number;
  readonly fuseMs?: number;
  readonly targetPoint?: { readonly x: number; readonly y: number };
}

const ANGLE_STEP = 5;
const ANGLE_MIN = -85;
const ANGLE_MAX = 85;
const POWER_STEPS = [0.4, 0.6, 0.8, 1] as const;

/** Difficulty jitter in degrees and power fraction, and a weapon downgrade chance for easy. */
const JITTER: Readonly<Record<CpuDifficulty, { readonly angle: number; readonly power: number }>> = Object.freeze({
  easy: { angle: 8, power: 0.15 },
  normal: { angle: 3, power: 0.06 },
  hard: { angle: 1, power: 0.02 },
});

function activeWorm(input: HeuristicInput): WormPoint | undefined {
  return input.worms.find((w) => w.id === input.request.active.wormId);
}

function shotFor(def: WeaponDef, from: WormPoint, angleDeg: number, power: number, facing: 1 | -1): ShotSpec | null {
  const spec = def.projectile;
  const blast = def.blast;
  if (spec === undefined || blast === undefined) return null;
  const speed = def.charged ? def.maxPower * Math.max(0.05, power) : def.maxPower;
  const a = degToRad(angleDeg);
  return {
    x0: from.x + facing * 6,
    y0: from.y - 10,
    vx: Math.cos(a) * speed * facing,
    vy: -Math.sin(a) * speed,
    radiusPx: spec.radiusPx,
    bounce: spec.bounce,
    friction: spec.friction,
    windAffected: def.windAffected,
    gravityScale: def.gravityScale,
    fuseMs: def.fuse === undefined ? null : def.fuse.defaultMs,
    maxLifetimeMs: spec.maxLifetimeMs,
    water: spec.water,
  };
}

function scoreImpact(bx: number, by: number, radius: number, maxDamage: number, from: WormPoint, worms: readonly WormPoint[], activeTeam: string): { score: number; enemy: number } {
  const estimate = estimateBlast(bx, by, radius, maxDamage, worms);
  let enemy = 0;
  let friendly = 0;
  for (const [id, dealt] of estimate.perWorm) {
    const worm = worms.find((w) => w.id === id);
    if (worm === undefined) continue;
    if (worm.id === from.id) friendly += dealt * 3;
    else if (worm.teamId === activeTeam) friendly += dealt * 2;
    else enemy += dealt;
  }
  return { score: enemy - friendly, enemy };
}

function evaluateBallistic(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1, env: TrajectoryEnv): Candidate | null {
  const activeTeam = input.request.active.team;
  let best: Candidate | null = null;
  for (let angle = ANGLE_MIN; angle <= ANGLE_MAX; angle += ANGLE_STEP) {
    for (const power of POWER_STEPS) {
      const shot = shotFor(def, from, angle, power, facing);
      if (shot === null) continue;
      const impact = simulateShot(shot, env);
      if (impact === null) continue;
      const { score, enemy } = scoreImpact(impact.x, impact.y, def.blast!.radiusPx, def.blast!.maxDamage, from, input.worms, activeTeam);
      if (best === null || score > best.score) {
        const confidence = clamp(enemy / Math.max(1, def.blast!.maxDamage), 0, 1);
        best = { weapon: def.id, angleDeg: angle, power, score, confidence, ...(def.fuse === undefined ? {} : { fuseMs: def.fuse.defaultMs }) };
        if (!def.charged) break;
      }
    }
  }
  return best;
}

/** Direct line estimate for hitscan and melee: damage if an enemy is on a clear bearing within range. */
function evaluateDirect(input: HeuristicInput, def: WeaponDef, from: WormPoint): Candidate | null {
  const range = def.hitscan?.rangePx ?? def.melee?.reachPx ?? 0;
  const perHit = def.hitscan !== undefined ? def.hitscan.damagePerPellet * def.hitscan.pellets : (def.melee?.damage ?? 0);
  let best: Candidate | null = null;
  for (const worm of input.worms) {
    if (!worm.alive || worm.teamId === input.request.active.team) continue;
    const dx = worm.x - from.x;
    const dy = worm.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range) continue;
    const angle = Math.round((Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI);
    const score = Math.min(perHit, worm.hp);
    if (best === null || score > best.score) best = { weapon: def.id, angleDeg: clamp(angle, ANGLE_MIN, ANGLE_MAX), power: 1, score, confidence: clamp(score / Math.max(1, perHit), 0, 1) };
  }
  return best;
}

/** Air strike and homing: aim at the enemy with the most hp on a roughly open sky. */
function evaluateTargeted(input: HeuristicInput, def: WeaponDef): Candidate | null {
  let best: Candidate | null = null;
  for (const worm of input.worms) {
    if (!worm.alive || worm.teamId === input.request.active.team) continue;
    const score = Math.min(def.blast?.maxDamage ?? def.strike?.childBlast.maxDamage ?? 40, worm.hp);
    if (best === null || score > best.score) best = { weapon: def.id, angleDeg: 60, power: 1, score, confidence: 0.6, targetPoint: { x: worm.x, y: worm.y } };
  }
  return best;
}

export function decideHeuristic(input: HeuristicInput): CpuTurnResponse {
  const from = activeWorm(input);
  const request = input.request;
  const facing: 1 | -1 = request.active.canMoveRight || !request.active.canMoveLeft ? 1 : -1;
  const env: TrajectoryEnv = { mask: input.mask, waterY: request.waterY, wind: request.wind, gravity: request.gravity || GRAVITY_PX_PER_S2 };
  let best: Candidate | null = null;
  if (from !== undefined) {
    for (const entry of request.ammo) {
      if (entry.count === 0) continue;
      const def = input.registry[entry.weapon];
      if (def === undefined) continue;
      let candidate: Candidate | null = null;
      if (def.kind === 'PROJECTILE' || def.kind === 'TIMED') candidate = evaluateBallistic(input, def, from, facing, env);
      else if (def.kind === 'HITSCAN' || def.kind === 'MELEE') candidate = evaluateDirect(input, def, from);
      else if (def.kind === 'TARGETED' && def.strike !== undefined) candidate = evaluateTargeted(input, def);
      if (candidate !== null && (best === null || candidate.score > best.score)) best = candidate;
    }
  }
  const jitter = JITTER[request.difficulty];
  const seedIndex = request.turn;
  if (best === null || best.score <= 0) {
    return {
      schema: CPU_TURN_SCHEMA,
      weapon: (request.ammo.find((a) => a.count !== 0)?.weapon ?? 'skip_go') as WeaponId,
      aimAngleDeg: 0,
      power: 0,
      facing: facing === 1 ? 'right' : 'left',
      move: { direction: 'none', durationMs: 0 },
      taunt: pickSkipTaunt(seedIndex),
      confidence: 0,
      reasoning: 'no shot scored above zero, skipping',
    };
  }
  const wobble = ((seedIndex * 2654435761) % 1000) / 1000 - 0.5;
  const angle = clamp(best.angleDeg + wobble * 2 * jitter.angle, -90, 90);
  const power = clamp(best.power + wobble * 2 * jitter.power, 0.05, 1);
  return {
    schema: CPU_TURN_SCHEMA,
    weapon: best.weapon,
    aimAngleDeg: Math.round(angle),
    power: Math.round(power * 100),
    facing: facing === 1 ? 'right' : 'left',
    move: { direction: 'none', durationMs: 0 },
    ...(best.fuseMs === undefined ? {} : { fuseMs: best.fuseMs }),
    ...(best.targetPoint === undefined ? {} : { targetPoint: best.targetPoint }),
    taunt: pickTaunt(request.personality, seedIndex),
    confidence: Math.round(best.confidence * 100) / 100,
    reasoning: `best of ballistic search, expected score ${Math.round(best.score)}`,
  };
}
