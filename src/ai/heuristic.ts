/**
 * The deterministic heuristic CPU (architecture.md section F, ai/heuristic.ts): for each weapon
 * with ammo, from where the worm stands and from the spots it can walk to (walked with the sim's
 * own rules), facing whichever way an enemy is, sample aim angle and power, simulate the shot with
 * the real integrator against the mask, and score by expected enemy damage minus self and ally
 * damage. The best candidate becomes a CpuTurnResponse: walk there, turn, fire. A walk that gives
 * up little is preferred to standing still, so the CPU moves about like a player does, and a turn
 * with no shot walks toward the nearest enemy and passes. Difficulty adds bounded jitter. Because it
 * uses a seeded index and the real trajectory, it is fully reproducible and can never make the CPU
 * play worse than this floor.
 *
 * The ballistic search is coarse then fine: a grid of angles and powers with the shell as a point,
 * which is cheap, then the neighbourhood of the best of it with the shell's real size. Marching a
 * grenade's full disc through every sample of a fine grid was most of a second per turn.
 */

import { GRAVITY_PX_PER_S2, TICK_S, WALK_SPEED_PX_PER_S, WORM_HALF_WIDTH } from '../sim/constants.ts';
import { stepHorizontal } from '../sim/worm-controller.ts';
import { wormHalfWidth, wormHeight, wormMiddleY } from '../sim/worm-size.ts';
import { clamp } from '../core/math.ts';
import type { CpuDifficulty, CpuTurnRequest, CpuTurnResponse } from './contract.ts';
import { CPU_TURN_SCHEMA } from './contract.ts';
import { pickSkipTaunt, pickTaunt } from './taunts.ts';
import { clearShot, estimateBlast, simulateShot, type ShotSpec, type TrajectoryEnv, type WormPoint } from './trajectory.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import type { WeaponDef, WeaponId } from '../weapons/types.ts';
import type { WeaponRegistry } from '../weapons/registry.ts';
import { pickLockTarget } from '../weapons/behaviors/combo.ts';
import { degToRad } from '../core/math.ts';
import { blastDamage } from '../sim/damage.ts';
import { plantSpot } from '../sim/sprout.ts';

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

const ANGLE_MIN = -85;
const ANGLE_MAX = 85;
/** The coarse pass: every 10 degrees from -80 to 80, at three charges (full power for an uncharged weapon). */
const COARSE_ANGLES: readonly number[] = Object.freeze(Array.from({ length: 17 }, (_, i) => -80 + i * 10));
const COARSE_POWERS: readonly number[] = Object.freeze([0.45, 0.7, 0.95]);
/** The fine pass round the best coarse shot: half a coarse step each way, and a tenth of a charge. */
const FINE_ANGLE_STEP = 5;
const FINE_POWER_STEP = 0.1;

/** How far the CPU considers walking each way before it fires, px, as far as its movement budget goes. */
export const WALK_STOPS_PX: readonly number[] = Object.freeze([45, 120]);
/** A shot after a walk is taken over a standing one when it scores at least this share of it. */
export const WALK_TOLERANCE = 0.9;

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
  // Where the sim launches it from (behaviors/types.ts muzzlePoint): lower and closer on a Saibaman.
  const size = from.size ?? 1;
  return {
    x0: from.x + facing * 6 * size,
    y0: from.y - 10 * size,
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

/** Where one shot lands and what it is worth; exact false marches the shell as a point (the cheap pass). */
function scoreShot(input: HeuristicInput, def: WeaponDef, from: WormPoint, angle: number, power: number, facing: 1 | -1, env: TrajectoryEnv, exact: boolean): { score: number; enemy: number } | null {
  const shot = shotFor(def, from, angle, power, facing);
  if (shot === null) return null;
  const impact = simulateShot(exact ? shot : { ...shot, radiusPx: 0 }, env);
  if (impact === null) return null;
  return scoreImpact(impact.x, impact.y, def.blast!.radiusPx, def.blast!.maxDamage, from, input.worms, input.request.active.team);
}

interface CoarseShot {
  readonly angle: number;
  readonly power: number;
  readonly score: number;
}

/** The coarse pass: the best of the grid, the shell marched as a point. Null when nothing on the grid scores. */
function coarseBallistic(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1, env: TrajectoryEnv): CoarseShot | null {
  const powers = def.charged ? COARSE_POWERS : [1];
  let coarse: CoarseShot | null = null;
  for (const angle of COARSE_ANGLES) {
    for (const power of powers) {
      const scored = scoreShot(input, def, from, angle, power, facing, env, false);
      if (scored !== null && (coarse === null || scored.score > coarse.score)) coarse = { angle, power, score: scored.score };
    }
  }
  return coarse !== null && coarse.score > 0 ? coarse : null;
}

/** The fine pass round a coarse shot, with the shell's real size: that is the shot that will fire. */
function fineBallistic(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1, env: TrajectoryEnv, coarse: CoarseShot): Candidate | null {
  let best: Candidate | null = null;
  for (const da of [0, -FINE_ANGLE_STEP, FINE_ANGLE_STEP]) {
    for (const dp of def.charged ? [0, -FINE_POWER_STEP, FINE_POWER_STEP] : [0]) {
      const angle = clamp(coarse.angle + da, ANGLE_MIN, ANGLE_MAX);
      const power = def.charged ? clamp(Math.round((coarse.power + dp) * 100) / 100, 0.05, 1) : 1;
      const scored = scoreShot(input, def, from, angle, power, facing, env, true);
      if (scored === null || (best !== null && scored.score <= best.score)) continue;
      const confidence = clamp(scored.enemy / Math.max(1, def.blast!.maxDamage), 0, 1);
      best = { weapon: def.id, angleDeg: angle, power, score: scored.score, confidence, ...(def.fuse === undefined ? {} : { fuseMs: def.fuse.defaultMs }) };
    }
  }
  return best !== null && best.score > 0 ? best : null;
}

/**
 * Direct line estimate for hitscan and melee: damage to an enemy within range on the side the worm
 * faces, and for a gun with a clear line from the muzzle to the target's middle.
 */
function evaluateDirect(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  const range = def.hitscan?.rangePx ?? def.melee?.reachPx ?? 0;
  const perHit = def.hitscan !== undefined ? def.hitscan.damagePerPellet * def.hitscan.pellets : (def.melee?.damage ?? 0);
  let best: Candidate | null = null;
  for (const worm of input.worms) {
    if (!worm.alive || worm.teamId === input.request.active.team) continue;
    const dx = worm.x - from.x;
    const dy = worm.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range || dx * facing <= 0) continue;
    if (def.hitscan !== undefined && !clearShot(input.mask, from.x + facing * 6 * (from.size ?? 1), from.y - wormHeight(from) * 0.6, worm.x, wormMiddleY(worm))) continue;
    const angle = Math.round((Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI);
    const score = Math.min(perHit, worm.hp);
    if (best === null || score > best.score) best = { weapon: def.id, angleDeg: clamp(angle, ANGLE_MIN, ANGLE_MAX), power: 1, score, confidence: clamp(score / Math.max(1, perHit), 0, 1) };
  }
  return best;
}

/**
 * A super move takes no aim: the rush locks its victim by the sim's own rule, from the facing the
 * plan will turn the worm to. Score that victim and nobody else; a worm behind a wall, or beyond a
 * nearer enemy the lock prefers, would take none of the damage.
 */
function evaluateCombo(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  const combo = def.combo;
  if (combo === undefined) return null;
  const request = input.request;
  const enemies = input.worms.filter((w) => w.alive && w.teamId !== request.active.team && w.y < request.waterY);
  const victim = pickLockTarget(input.mask, { x: from.x, y: from.y, facing }, enemies, combo.rangePx);
  if (victim === null) return null;
  const total = combo.hits * combo.damagePerHit + combo.finisherDamage;
  const score = Math.min(total, victim.hp);
  return { weapon: def.id, angleDeg: 0, power: 1, score, confidence: clamp(score / Math.max(1, total), 0, 1) };
}

/**
 * Gear 5 takes no aim either: the arm grabs whom the sim's lock rule picks, and a worm it grabs is
 * eaten, however much health it has. Score that victim's whole health, and nobody else's.
 */
function evaluateDevour(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  const devour = def.devour;
  if (devour === undefined) return null;
  const request = input.request;
  const enemies = input.worms.filter((w) => w.alive && w.teamId !== request.active.team && w.y < request.waterY);
  const victim = pickLockTarget(input.mask, { x: from.x, y: from.y, facing }, enemies, devour.rangePx);
  if (victim === null || victim.hp <= 0) return null;
  return { weapon: def.id, angleDeg: 0, power: 1, score: victim.hp, confidence: 1 };
}

/**
 * The Freezer takes no aim either: the light goes into whom the sim's lock rule picks, and a worm
 * it goes into bursts, however much health it has. Score that victim's whole health, plus the burst
 * on whoever floats or stands close to it, enemies less friends (twice), the CPU's own worm included.
 */
function evaluateHex(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  const hex = def.hex;
  if (hex === undefined) return null;
  const request = input.request;
  const enemies = input.worms.filter((w) => w.alive && w.teamId !== request.active.team && w.y < request.waterY);
  const victim = pickLockTarget(input.mask, { x: from.x, y: from.y, facing }, enemies, hex.rangePx);
  if (victim === null || victim.hp <= 0) return null;
  // Where it bursts: its middle, up where it floats (a ceiling may hold it lower; close enough).
  const bx = victim.x;
  const by = victim.y - hex.liftPx - wormHeight(victim) / 2;
  let score = victim.hp;
  for (const worm of input.worms) {
    if (!worm.alive || worm.id === victim.id || worm.y >= request.waterY) continue;
    const distance = Math.hypot(worm.x - bx, wormMiddleY(worm) - by);
    if (distance > hex.burst.radiusPx) continue;
    const dealt = Math.min(blastDamage(hex.burst.maxDamage, distance, hex.burst.radiusPx), worm.hp);
    score += worm.teamId === request.active.team ? -2 * dealt : dealt;
  }
  return { weapon: def.id, angleDeg: 0, power: 1, score, confidence: 1 };
}

/**
 * What a Saibaman is worth to the CPU, in the damage points its shots score: a modest sure thing,
 * so it plants when it has no shot better than a so-so hit, and shoots when it has one.
 */
export const SPROUT_SCORE = 18;

/**
 * The Saibaman seed takes no aim: it goes into the ground in front, where the sim's plantSpot puts
 * it. Worth SPROUT_SCORE when it can grow there, nothing when there is no ground for it or the team
 * is already at its cap.
 */
function evaluateSprout(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  const sprout = def.sprout;
  if (sprout === undefined) return null;
  const team = input.request.active.team;
  if (input.worms.filter((w) => w.alive && w.teamId === team).length >= sprout.maxTeamWorms) return null;
  if (plantSpot(input.mask, input.request.waterY, from.x, from.y, facing, sprout) === null) return null;
  return { weapon: def.id, angleDeg: 0, power: 1, score: SPROUT_SCORE, confidence: 0.6 };
}

/** A beam is thin: sweep the aim finer than a shell's. */
const BEAM_ANGLE_STEP = 2;

/**
 * A beam goes through the land, so no line of sight is needed: every aim is scored by the worms
 * on its line, the way the sim's beam decides whom it touches, enemies less friends (twice). The
 * burst at the tip is a bonus the CPU does not count on.
 */
function evaluateBeam(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  const beam = def.beam;
  if (beam === undefined) return null;
  const activeTeam = input.request.active.team;
  const x0 = from.x + facing * 6 * (from.size ?? 1);
  const y0 = from.y - wormHeight(from) * 0.6;
  let best: Candidate | null = null;
  for (let angle = ANGLE_MIN; angle <= ANGLE_MAX; angle += BEAM_ANGLE_STEP) {
    const a = degToRad(angle);
    const dx = Math.cos(a) * facing;
    const dy = -Math.sin(a);
    let enemy = 0;
    let friendly = 0;
    for (const worm of input.worms) {
      if (!worm.alive || worm.id === from.id || worm.y >= input.request.waterY) continue;
      // The sim's beam touches a worm within its radius of the worm's own half width (a Saibaman is thinner).
      const reach = beam.radiusPx + wormHalfWidth(worm);
      const cx = worm.x;
      const cy = wormMiddleY(worm);
      const along = (cx - x0) * dx + (cy - y0) * dy;
      if (along < 0 || along > beam.rangePx + reach) continue;
      if (Math.abs((cx - x0) * dy - (cy - y0) * dx) > reach) continue;
      const dealt = Math.min(beam.damage, worm.hp);
      if (worm.teamId === activeTeam) friendly += dealt * 2;
      else enemy += dealt;
    }
    const score = enemy - friendly;
    if (enemy > 0 && (best === null || score > best.score)) best = { weapon: def.id, angleDeg: angle, power: 1, score, confidence: clamp(enemy / Math.max(1, beam.damage), 0, 1) };
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

/** A place to fire from: where the worm stands, or a spot along the ground it can walk to first. */
export interface Spot {
  readonly at: WormPoint;
  /** 0 to stay put; otherwise which way it walks, and for how long. */
  readonly dir: -1 | 0 | 1;
  readonly walkMs: number;
}

/**
 * Where the worm can fire from this turn: where it stands, then the spots WALK_STOPS_PX along the
 * ground each way, walked tick by tick with the sim's own step (slopes climbed, walls stopping it),
 * as far as the movement budget goes. A walk ends before a drop the worm would fall off, and before
 * the water.
 */
export function walkSpots(input: HeuristicInput, from: WormPoint): Spot[] {
  const request = input.request;
  const spots: Spot[] = [{ at: from, dir: 0, walkMs: 0 }];
  const maxTicks = Math.floor(Math.max(0, request.active.maxWalkMs) / 1000 / TICK_S);
  const stepPx = WALK_SPEED_PX_PER_S * TICK_S;
  for (const dir of [-1, 1] as const) {
    if (dir === -1 ? !request.active.canMoveLeft : !request.active.canMoveRight) continue;
    const walker = { x: from.x, y: from.y, ...(from.size === undefined ? {} : { size: from.size }) };
    let walked = 0;
    let stop = 0;
    for (let tick = 1; tick <= maxTicks && stop < WALK_STOPS_PX.length; tick += 1) {
      const x = walker.x;
      if (stepHorizontal(input.mask, walker, walker.x + dir * stepPx) !== 'moved' || walker.y >= request.waterY - 4) break;
      walked += Math.abs(walker.x - x);
      if (walked >= (WALK_STOPS_PX[stop] ?? Infinity)) {
        spots.push({ at: { ...from, x: walker.x, y: walker.y }, dir, walkMs: Math.round(tick * TICK_S * 1000) });
        stop += 1;
      }
    }
  }
  return spots;
}

/** The ways worth facing from a spot: toward any enemy, or both when an enemy is straight above or below. */
function facingsFrom(input: HeuristicInput, at: WormPoint): readonly (1 | -1)[] {
  let right = false;
  let left = false;
  for (const worm of input.worms) {
    if (!worm.alive || worm.teamId === input.request.active.team) continue;
    const dx = worm.x - at.x;
    if (dx >= -WORM_HALF_WIDTH) right = true;
    if (dx <= WORM_HALF_WIDTH) left = true;
  }
  if (right && left) return [1, -1];
  return left ? [-1] : [1];
}

interface Choice extends Candidate {
  readonly spot: Spot;
  readonly facing: 1 | -1;
}

/** Every shot but a shell's, which ballisticChoices searches across the spots at once. */
function evaluate(input: HeuristicInput, def: WeaponDef, from: WormPoint, facing: 1 | -1): Candidate | null {
  if (def.combo !== undefined) return evaluateCombo(input, def, from, facing);
  if (def.devour !== undefined) return evaluateDevour(input, def, from, facing);
  if (def.hex !== undefined) return evaluateHex(input, def, from, facing);
  if (def.sprout !== undefined) return evaluateSprout(input, def, from, facing);
  if (def.beam !== undefined) return evaluateBeam(input, def, from, facing);
  if (def.kind === 'HITSCAN' || def.kind === 'MELEE') return evaluateDirect(input, def, from, facing);
  return null;
}

/** Of two shots, the better: the higher score, then the one that walks the way it will fire, then the shorter walk. */
function better<T extends { readonly score: number; readonly spot: Spot; readonly facing?: 1 | -1 }>(a: T, b: T): boolean {
  if (a.score !== b.score) return a.score > b.score;
  const ahead = (c: T): number => (c.spot.dir !== 0 && c.spot.dir === c.facing ? 1 : 0);
  if (ahead(a) !== ahead(b)) return ahead(a) > ahead(b);
  return a.spot.walkMs < b.spot.walkMs;
}

/**
 * The best shot, and the one the CPU takes: standing still wins only by more than WALK_TOLERANCE,
 * otherwise the best shot from a spot it walks to is taken, so the worm moves about on its turn,
 * toward where it will fire when that is as good.
 */
export function pickChoice<T extends { readonly score: number; readonly spot: Spot; readonly facing?: 1 | -1 }>(choices: readonly T[]): T | null {
  let best: T | null = null;
  for (const choice of choices) if (best === null || better(choice, best)) best = choice;
  if (best === null || best.score <= 0 || best.spot.dir !== 0) return best;
  let walk: T | null = null;
  for (const choice of choices) {
    if (choice.spot.dir !== 0 && choice.score >= best.score * WALK_TOLERANCE && (walk === null || better(choice, walk))) walk = choice;
  }
  return walk ?? best;
}

/**
 * A shell's best shots: the coarse pass from every spot and facing, then the fine pass only on the
 * best of them from where it stands and the best after a walk (all pickChoice needs to choose).
 */
function ballisticChoices(input: HeuristicInput, def: WeaponDef, spots: readonly Spot[], env: TrajectoryEnv): Choice[] {
  let stay: { spot: Spot; facing: 1 | -1; coarse: CoarseShot } | null = null;
  let walk: { spot: Spot; facing: 1 | -1; coarse: CoarseShot } | null = null;
  for (const spot of spots) {
    for (const facing of facingsFrom(input, spot.at)) {
      const coarse = coarseBallistic(input, def, spot.at, facing, env);
      if (coarse === null) continue;
      if (spot.dir === 0) {
        if (stay === null || coarse.score > stay.coarse.score) stay = { spot, facing, coarse };
      } else if (walk === null || coarse.score > walk.coarse.score) walk = { spot, facing, coarse };
    }
  }
  const out: Choice[] = [];
  for (const pick of [stay, walk]) {
    if (pick === null) continue;
    const fine = fineBallistic(input, def, pick.spot.at, pick.facing, env, pick.coarse);
    if (fine !== null) out.push({ ...fine, spot: pick.spot, facing: pick.facing });
  }
  return out;
}

function nearestEnemy(input: HeuristicInput, from: WormPoint): WormPoint | null {
  let best: WormPoint | null = null;
  for (const worm of input.worms) {
    if (!worm.alive || worm.teamId === input.request.active.team || worm.y >= input.request.waterY) continue;
    if (best === null || Math.hypot(worm.x - from.x, worm.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y)) best = worm;
  }
  return best;
}

export function decideHeuristic(input: HeuristicInput): CpuTurnResponse {
  const from = activeWorm(input);
  const request = input.request;
  const env: TrajectoryEnv = { mask: input.mask, waterY: request.waterY, wind: request.wind, gravity: request.gravity || GRAVITY_PX_PER_S2 };
  const spots = from === undefined ? [] : walkSpots(input, from);
  const choices: Choice[] = [];
  for (const entry of request.ammo) {
    if (entry.count === 0) continue;
    const def = input.registry[entry.weapon];
    if (def === undefined) continue;
    if (def.kind === 'TARGETED') {
      // Called in from the sky: where the worm stands and which way it faces do not matter.
      const stay = spots[0];
      const candidate = def.strike !== undefined && stay !== undefined ? evaluateTargeted(input, def) : null;
      if (candidate !== null && stay !== undefined) choices.push({ ...candidate, spot: stay, facing: 1 });
      continue;
    }
    if (def.kind === 'PROJECTILE' || def.kind === 'TIMED') {
      choices.push(...ballisticChoices(input, def, spots, env));
      continue;
    }
    for (const spot of spots) {
      for (const facing of facingsFrom(input, spot.at)) {
        const candidate = evaluate(input, def, spot.at, facing);
        if (candidate !== null) choices.push({ ...candidate, spot, facing });
      }
    }
  }
  const jitter = JITTER[request.difficulty];
  const seedIndex = request.turn;
  const best = pickChoice(choices);
  const move = (spot: Spot | undefined): CpuTurnResponse['move'] =>
    spot === undefined || spot.dir === 0 ? { direction: 'none', durationMs: 0 } : { direction: spot.dir === -1 ? 'left' : 'right', durationMs: spot.walkMs };
  if (best === null || best.score <= 0) {
    // Nothing worth firing: walk as far as it can toward the nearest enemy, face it, and pass.
    const enemy = from === undefined ? null : nearestEnemy(input, from);
    const toward: -1 | 1 = enemy !== null && from !== undefined && enemy.x < from.x ? -1 : 1;
    const approach = spots.filter((spot) => spot.dir === toward).at(-1);
    const skip = request.ammo.some((a) => a.weapon === 'skip_go' && a.count !== 0);
    return {
      schema: CPU_TURN_SCHEMA,
      weapon: (skip ? 'skip_go' : (request.ammo.find((a) => a.count !== 0)?.weapon ?? 'skip_go')) as WeaponId,
      aimAngleDeg: 0,
      power: 0,
      facing: toward === 1 ? 'right' : 'left',
      move: move(approach),
      taunt: pickSkipTaunt(seedIndex),
      confidence: 0,
      reasoning: 'no shot scored above zero, closing in and skipping',
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
    facing: best.facing === 1 ? 'right' : 'left',
    move: move(best.spot),
    ...(best.fuseMs === undefined ? {} : { fuseMs: best.fuseMs }),
    ...(best.targetPoint === undefined ? {} : { targetPoint: best.targetPoint }),
    taunt: pickTaunt(request.personality, seedIndex),
    confidence: Math.round(best.confidence * 100) / 100,
    reasoning: `${best.spot.dir === 0 ? 'from where it stands' : `after a ${best.spot.walkMs} ms walk`}, expected score ${Math.round(best.score)}`,
  };
}
