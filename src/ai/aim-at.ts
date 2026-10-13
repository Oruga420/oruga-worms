/**
 * Aim at one worm: the angle, the charge and the facing that put a shot on it from where the
 * shooter stands now, without blowing the shooter or its friends up. Used when the player names the
 * target ("dispárale a Ana") and, after an auto attack's walk, to aim again from the spot the worm
 * really reached, so a walk a few px off the plan cannot turn a good shot into one at its own feet.
 *
 * A shell (bazooka, grenade, mortar...) is marched through the real trajectory (trajectory.ts, the
 * sim's own integrator against the mask, with the wind): a coarse grid with the shell as a point,
 * then the neighbourhood of the best with its real size. The impact nearest the target wins among
 * those whose blast leaves the shooter and its friends out; with no safe one, the one that hurts
 * them least. Straight weapons (guns, beams, melee) aim along the line; an animal is pointed at it
 * and let go; a weapon called from the sky goes on the target. Pure; unit tested.
 */

import { clamp } from '../core/math.ts';
import { wormHalfWidth, wormHeight, wormMiddleY } from '../sim/worm-size.ts';
import type { WeaponDef } from '../weapons/types.ts';
import { shotFor } from './heuristic.ts';
import { simulateShot, type TrajectoryEnv, type WormPoint } from './trajectory.ts';

export interface AimSolution {
  readonly facing: 1 | -1;
  readonly angleDeg: number;
  /** 0..1. */
  readonly power: number;
  readonly targetPoint?: { readonly x: number; readonly y: number };
  /** World px between where the shot is expected to go off and the target's middle; 0 for a straight or called in shot. */
  readonly missPx: number;
  /** The blast is expected to leave the shooter and its team out. */
  readonly safe: boolean;
}

export interface AimInput {
  readonly def: WeaponDef;
  readonly from: WormPoint;
  readonly target: WormPoint;
  /** Every worm, the shooter's friends among them, for the blast check. */
  readonly worms: readonly WormPoint[];
  readonly env: TrajectoryEnv;
}

const COARSE_ANGLE_STEP = 5;
const COARSE_POWERS: readonly number[] = Object.freeze([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
const FINE_ANGLE_STEP = 1;
const FINE_POWER_STEP = 0.02;
/** Slack beyond the blast radius a friend must stand at to count as out of it. */
const SAFETY_PX = 8;

/** Straight at the target's middle from the muzzle (guns, beams, melee). */
function straight(from: WormPoint, target: WormPoint): AimSolution {
  const facing: 1 | -1 = target.x < from.x ? -1 : 1;
  const x0 = from.x + facing * 6 * (from.size ?? 1);
  const y0 = from.y - 10 * (from.size ?? 1);
  const angleDeg = clamp((Math.atan2(y0 - wormMiddleY(target), Math.abs(target.x - x0)) * 180) / Math.PI, -90, 90);
  return { facing, angleDeg, power: 1, missPx: 0, safe: true };
}

interface Tried {
  readonly angle: number;
  readonly power: number;
  readonly miss: number;
  /** Damage-ish harm to the shooter and friends: 0 when all of them stand clear of the blast. */
  readonly harm: number;
}

function better(a: Tried, b: Tried | null): boolean {
  if (b === null) return true;
  if ((a.harm === 0) !== (b.harm === 0)) return a.harm === 0;
  if (a.harm !== b.harm && a.harm > 0) return a.harm < b.harm;
  return a.miss < b.miss;
}

export function aimAtWorm(input: AimInput): AimSolution {
  const { def, from, target } = input;
  if (def.requiresTargetSelect) return { facing: target.x < from.x ? -1 : 1, angleDeg: 60, power: 1, targetPoint: { x: target.x, y: target.y }, missPx: 0, safe: true };
  if (def.projectile === undefined || def.blast === undefined) return straight(from, target);
  const facing: 1 | -1 = target.x < from.x ? -1 : 1;
  const tx = target.x;
  const ty = wormMiddleY(target);
  const radius = def.blast.radiusPx;
  const friends = input.worms.filter((w) => w.alive && w.teamId === from.teamId);
  // Every worm stops a contact shell, the shooter too once the shell is clear of the muzzle.
  const env = { ...input.env, bodies: input.worms.filter((w) => w.alive).map((w) => ({ x: w.x, y: w.y, halfWidth: wormHalfWidth(w), height: wormHeight(w), shooter: w.id === from.id })) };
  const tryShot = (angle: number, power: number, exact: boolean): Tried | null => {
    const shot = shotFor(def, from, angle, power, facing);
    if (shot === null) return null;
    const impact = simulateShot(exact ? shot : { ...shot, radiusPx: 0 }, env);
    if (impact === null) return null;
    let harm = 0;
    for (const friend of friends) {
      const d = Math.hypot(friend.x - impact.x, wormMiddleY(friend) - impact.y);
      if (d < radius + SAFETY_PX) harm += (radius + SAFETY_PX - d) * (friend.id === from.id ? 3 : 2);
    }
    return { angle, power, miss: Math.hypot(tx - impact.x, ty - impact.y), harm };
  };
  const powers = def.charged ? COARSE_POWERS : [1];
  let best: Tried | null = null;
  for (let angle = -85; angle <= 85; angle += COARSE_ANGLE_STEP) {
    for (const power of powers) {
      const tried = tryShot(angle, power, false);
      if (tried !== null && better(tried, best)) best = tried;
    }
  }
  if (best === null) return straight(from, target);
  const coarse = best;
  best = null;
  for (let da = -COARSE_ANGLE_STEP; da <= COARSE_ANGLE_STEP; da += FINE_ANGLE_STEP) {
    for (let dp = def.charged ? -0.1 : 0; dp <= (def.charged ? 0.1 : 0) + 1e-9; dp += FINE_POWER_STEP) {
      const tried = tryShot(clamp(coarse.angle + da, -89, 89), def.charged ? clamp(Math.round((coarse.power + dp) * 100) / 100, 0.05, 1) : 1, true);
      if (tried !== null && better(tried, best)) best = tried;
    }
  }
  const pick = best ?? coarse;
  return { facing, angleDeg: pick.angle, power: pick.power, missPx: Math.round(pick.miss), safe: pick.harm === 0 };
}

