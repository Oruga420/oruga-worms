/**
 * Turns a CpuTurnResponse into a timed sequence of input intents (architecture.md section F,
 * ai/plan-executor.ts): walk for a while, face the target, then fire. The CPU drives the exact
 * same worm controller a human does, so there is no separate CPU movement path and no class of
 * divergence bugs. Power is quantized to the charge steps the executor can reproduce, so the
 * shot the heuristic simulated is the shot that fires.
 */

import { TICK_S } from '../sim/constants.ts';
import type { WormIntent } from '../sim/types.ts';
import type { CpuTurnResponse } from './contract.ts';
import type { FireAim } from '../weapons/fire.ts';

/** Number of charge steps a held fire can reach; power snaps to one so the sim matches the plan. */
export const CHARGE_STEPS = 20;

export function quantizePower(power0to100: number): number {
  const fraction = Math.max(0, Math.min(1, power0to100 / 100));
  return Math.round(fraction * CHARGE_STEPS) / CHARGE_STEPS;
}

export type PlanStep =
  | { readonly kind: 'move'; readonly intent: WormIntent; readonly ticks: number }
  | { readonly kind: 'aim'; readonly facing: 1 | -1; readonly angleDeg: number }
  | { readonly kind: 'fire'; readonly aim: FireAim };

export interface Plan {
  readonly steps: readonly PlanStep[];
  readonly aim: FireAim;
  readonly facing: 1 | -1;
}

/** Builds the ordered steps: an optional walk, an aim, then the fire with the quantized power. */
export function buildPlan(response: CpuTurnResponse): Plan {
  const facing: 1 | -1 = response.facing === 'left' ? -1 : 1;
  const aim: FireAim = {
    angleDeg: response.aimAngleDeg,
    power: quantizePower(response.power),
    ...(response.fuseMs === undefined ? {} : { fuseMs: response.fuseMs }),
    ...(response.targetPoint === undefined ? {} : { targetPoint: response.targetPoint }),
  };
  const steps: PlanStep[] = [];
  if (response.move.direction !== 'none' && response.move.durationMs > 0) {
    const moveX = response.move.direction === 'left' ? -1 : 1;
    steps.push({ kind: 'move', intent: { moveX, jump: false, backflip: false, thrust: false }, ticks: Math.max(1, Math.round(response.move.durationMs / 1000 / TICK_S)) });
  }
  steps.push({ kind: 'aim', facing, angleDeg: response.aimAngleDeg });
  steps.push({ kind: 'fire', aim });
  return { steps, aim, facing };
}

/**
 * Walk ticks the movement budget can still pay for: remainingPx of budget at pxPerTick per tick.
 * The request already tells the model its limit (active.maxWalkMs) and the sanitizer clamps to
 * it, so this is defence in depth for the controller, which must never queue a walk the sim will
 * cut short behind the plan's back (backlog 4.4). Never negative; never above the requested ticks.
 */
export function capWalkTicks(ticks: number, remainingPx: number, pxPerTick: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0;
  if (!Number.isFinite(remainingPx) || remainingPx <= 0) return 0;
  if (!Number.isFinite(pxPerTick) || pxPerTick <= 0) return Math.floor(ticks);
  return Math.max(0, Math.min(Math.floor(ticks), Math.floor(remainingPx / pxPerTick)));
}

/** Expands a plan into one WormIntent per tick for the walk phase, for a driver that ticks the sim. */
export function walkIntents(plan: Plan): readonly WormIntent[] {
  const out: WormIntent[] = [];
  for (const step of plan.steps) {
    if (step.kind === 'move') for (let i = 0; i < step.ticks; i += 1) out.push(step.intent);
  }
  return out;
}
