import { describe, expect, it } from 'vitest';
import { CPU_TURN_SCHEMA, type CpuTurnResponse } from '@/ai/contract.ts';
import { buildPlan, capWalkTicks, CHARGE_STEPS, quantizePower, walkIntents } from '@/ai/plan-executor.ts';

function response(overrides: Partial<CpuTurnResponse> = {}): CpuTurnResponse {
  return {
    schema: CPU_TURN_SCHEMA,
    weapon: 'bazooka',
    aimAngleDeg: 40,
    power: 75,
    facing: 'right',
    move: { direction: 'none', durationMs: 0 },
    taunt: 'x',
    confidence: 0.8,
    reasoning: 'y',
    ...overrides,
  };
}

describe('quantizePower', () => {
  it('snaps to the charge steps the executor can reproduce', () => {
    expect(quantizePower(0)).toBe(0);
    expect(quantizePower(100)).toBe(1);
    expect(quantizePower(75)).toBe(Math.round(0.75 * CHARGE_STEPS) / CHARGE_STEPS);
    expect(quantizePower(200)).toBe(1);
    expect(quantizePower(-5)).toBe(0);
  });
});

describe('capWalkTicks', () => {
  it('never queues more walk than the movement budget can pay for', () => {
    // 1 px per tick makes the arithmetic plain: 100 px of budget pays for 100 ticks.
    expect(capWalkTicks(180, 100, 1)).toBe(100);
    expect(capWalkTicks(50, 100, 1)).toBe(50);
    expect(capWalkTicks(180, 0, 1)).toBe(0);
    expect(capWalkTicks(180, -20, 1)).toBe(0);
    // Fractional ticks round down: 10 px at 3 px per tick is 3 whole ticks.
    expect(capWalkTicks(180, 10, 3)).toBe(3);
  });

  it('is safe on nonsense inputs', () => {
    expect(capWalkTicks(0, 100, 1)).toBe(0);
    expect(capWalkTicks(Number.NaN, 100, 1)).toBe(0);
    expect(capWalkTicks(12, Number.NaN, 1)).toBe(0);
    // A non positive px per tick cannot bound anything; the requested ticks stand.
    expect(capWalkTicks(12, 100, 0)).toBe(12);
  });
});

describe('buildPlan', () => {
  it('aims then fires when there is no move', () => {
    const plan = buildPlan(response());
    expect(plan.facing).toBe(1);
    expect(plan.steps.map((s) => s.kind)).toEqual(['aim', 'fire']);
    expect(plan.aim.angleDeg).toBe(40);
    expect(plan.aim.power).toBe(quantizePower(75));
  });

  it('walks first when a move is requested and expands the intents', () => {
    const plan = buildPlan(response({ move: { direction: 'left', durationMs: 500 } }));
    expect(plan.facing).toBe(1);
    expect(plan.steps[0]?.kind).toBe('move');
    const intents = walkIntents(plan);
    expect(intents.length).toBe(Math.round(500 / 1000 / (1 / 60)));
    expect(intents.every((i) => i.moveX === -1)).toBe(true);
  });

  it('carries the fuse and target through to the fire aim', () => {
    const plan = buildPlan(response({ weapon: 'air_strike', fuseMs: 3000, targetPoint: { x: 400, y: 200 }, facing: 'left' }));
    expect(plan.facing).toBe(-1);
    expect(plan.aim.fuseMs).toBe(3000);
    expect(plan.aim.targetPoint).toEqual({ x: 400, y: 200 });
  });
});
