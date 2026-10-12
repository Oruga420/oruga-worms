/**
 * Worm commands: what a voice agent, a WebMCP tool or a script may ask the human's active worm to
 * do, in place of the keys. The controller turns each into a short script played out over the
 * ticks (walk counting the steps, turn, swing the aim, charge, fire), through the same intents and
 * the same fire path a keyboard uses, so a command can never do what a player could not.
 *
 * The auto attack asks the heuristic CPU (ai/heuristic.ts) for the best shot with the weapon the
 * player named, from where the worm stands or a short walk away, and plays it: a few beats of
 * "calculating" while the reticle hops over the enemies, then the walk, the aim and the shot.
 *
 * Pure: the types, the plan out of a CPU answer and the pick of the worm it is meant for. Unit tested.
 */

import { WALK_SPEED_PX_PER_S } from '../sim/constants.ts';
import type { CpuTurnResponse } from '../ai/contract.ts';
import type { WeaponId } from '../weapons/types.ts';

export type WormCommand =
  /** Pick which worm of the active team plays this turn, before it has moved or fired. */
  | { readonly kind: 'select'; readonly wormId: string }
  /** Walk this many steps of the movement budget (the HUD's steps); -1 is left. */
  | { readonly kind: 'walk'; readonly dir: -1 | 1; readonly steps: number }
  | { readonly kind: 'face'; readonly dir: -1 | 1 }
  | { readonly kind: 'jump' }
  | { readonly kind: 'backflip' }
  /** Elevation in degrees, -90..90, positive up. */
  | { readonly kind: 'aim'; readonly angleDeg: number }
  | { readonly kind: 'aimBy'; readonly deltaDeg: number }
  | { readonly kind: 'weapon'; readonly id: WeaponId }
  /** Fire the weapon in hand at the aim; power 0..1 (full when absent); targetPoint for an air strike, a teleport, a meteor. */
  | { readonly kind: 'fire'; readonly power?: number; readonly targetPoint?: { readonly x: number; readonly y: number } }
  /** Let the AI find the best shot (with this weapon, at this worm when named), show it calculating, and take it. */
  | { readonly kind: 'auto'; readonly weapon?: WeaponId; readonly targetWormId?: string; readonly message?: string }
  | { readonly kind: 'skip' }
  /** Drops whatever the worm was still doing on command. */
  | { readonly kind: 'stop' };

export type CommandResult =
  | { readonly ok: true; readonly text: string; readonly data?: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly text: string };

export const ok = (text: string, data?: Readonly<Record<string, unknown>>): CommandResult => (data === undefined ? { ok: true, text } : { ok: true, text, data });
export const refuse = (text: string): CommandResult => ({ ok: false, text });

/** The most steps one command may ask for; the budget cuts it shorter anyway. */
export const MAX_COMMAND_STEPS = 20;
/** Ticks the worm "calculates" before an auto attack, with the reticle hopping over the enemies. */
export const CALC_TICKS = 110;
/** A walk that gains less than this in this many ticks is against a wall: it stops there. */
export const STALL_PX = 0.5;
export const STALL_TICKS = 18;

export interface PlanWorm {
  readonly id: string;
  readonly teamId: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly alive: boolean;
}

/** The shot the AI picked, as the controller plays it. */
export interface AutoPlan {
  readonly weapon: WeaponId;
  readonly walkDir: -1 | 0 | 1;
  /** Steps of the movement budget the walk takes (0 when it fires from where it stands). */
  readonly walkSteps: number;
  readonly facing: 1 | -1;
  readonly angleDeg: number;
  /** 0..1. */
  readonly power: number;
  readonly fuseMs?: number;
  readonly targetPoint?: { readonly x: number; readonly y: number };
  /** The worm it is meant for, null when the AI found nobody to hit. */
  readonly targetId: string | null;
  /** 0..1, how sure the AI is of it. */
  readonly confidence: number;
  /** The AI found no shot with that weapon and fires straight at the nearest enemy instead. */
  readonly fallback: boolean;
}

/** The enemy the shot is meant for: the one nearest where it is sent, or along the line it leaves on. */
export function pickTarget(from: { readonly x: number; readonly y: number }, facing: 1 | -1, angleDeg: number, enemies: readonly PlanWorm[], targetPoint?: { readonly x: number; readonly y: number }): PlanWorm | null {
  let best: PlanWorm | null = null;
  let bestScore = Infinity;
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a) * facing;
  const dy = -Math.sin(a);
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    let score: number;
    if (targetPoint !== undefined) {
      score = Math.hypot(enemy.x - targetPoint.x, enemy.y - targetPoint.y);
    } else {
      const ex = enemy.x - from.x;
      const ey = enemy.y - from.y;
      const along = ex * dx + ey * dy;
      // Behind the worm: only when there is nobody in front.
      const off = Math.abs(ex * dy - ey * dx);
      score = along < 0 ? 1e6 + Math.hypot(ex, ey) : off * 0.5 + Math.hypot(ex, ey) * 0.25;
    }
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/** Straight at a worm: the elevation from (x, y) to it, and which way to face. */
export function straightAt(from: { readonly x: number; readonly y: number }, to: { readonly x: number; readonly y: number }): { readonly facing: 1 | -1; readonly angleDeg: number } {
  const facing: 1 | -1 = to.x < from.x ? -1 : 1;
  const angleDeg = (Math.atan2(from.y - to.y, Math.abs(to.x - from.x)) * 180) / Math.PI;
  return { facing, angleDeg: Math.max(-90, Math.min(90, angleDeg)) };
}

/**
 * The AI's answer as a plan for the worm. When the answer is not a shot with the weapon asked for
 * (the heuristic found nothing it scores above zero), the worm fires anyway, straight at the enemy
 * named or the nearest one: the player asked for it, the AI just says it is not sure.
 */
export function planFromResponse(input: {
  readonly response: CpuTurnResponse;
  readonly weapon: WeaponId;
  readonly from: PlanWorm;
  readonly enemies: readonly PlanWorm[];
  readonly stepPx: number;
  readonly targetWormId?: string;
}): AutoPlan {
  const { response, weapon, from, enemies, stepPx } = input;
  const named = input.targetWormId === undefined ? undefined : enemies.find((w) => w.id === input.targetWormId && w.alive);
  const usable = response.weapon === weapon && response.confidence > 0;
  if (usable) {
    const facing: 1 | -1 = response.facing === 'left' ? -1 : 1;
    const walkDir: -1 | 0 | 1 = response.move.direction === 'none' || response.move.durationMs <= 0 ? 0 : response.move.direction === 'left' ? -1 : 1;
    const walkPx = walkDir === 0 ? 0 : (response.move.durationMs / 1000) * WALK_SPEED_PX_PER_S;
    const walkSteps = walkDir === 0 ? 0 : Math.max(1, Math.round(walkPx / Math.max(1, stepPx)));
    const target = pickTarget({ x: from.x + walkDir * walkPx, y: from.y }, facing, response.aimAngleDeg, enemies, response.targetPoint);
    return {
      weapon,
      walkDir,
      walkSteps,
      facing,
      angleDeg: response.aimAngleDeg,
      power: Math.max(0.05, Math.min(1, response.power / 100)),
      ...(response.fuseMs === undefined ? {} : { fuseMs: response.fuseMs }),
      ...(response.targetPoint === undefined ? {} : { targetPoint: response.targetPoint }),
      targetId: target?.id ?? null,
      confidence: response.confidence,
      fallback: false,
    };
  }
  let target: PlanWorm | null = named ?? null;
  if (target === null) {
    let bestDistance = Infinity;
    for (const enemy of enemies) {
      const d = Math.hypot(enemy.x - from.x, enemy.y - from.y);
      if (enemy.alive && d < bestDistance) {
        bestDistance = d;
        target = enemy;
      }
    }
  }
  if (target === null) return { weapon, walkDir: 0, walkSteps: 0, facing: 1, angleDeg: 45, power: 1, targetId: null, confidence: 0, fallback: true };
  const line = straightAt({ x: from.x, y: from.y - 10 }, { x: target.x, y: target.y - 10 });
  return { weapon, walkDir: 0, walkSteps: 0, facing: line.facing, angleDeg: Math.round(line.angleDeg), power: 1, targetPoint: { x: target.x, y: target.y }, targetId: target.id, confidence: 0.2, fallback: true };
}
