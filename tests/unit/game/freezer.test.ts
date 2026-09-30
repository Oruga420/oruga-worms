import { describe, expect, it } from 'vitest';
import { innerGlow, swelling, SWELL_X, SWELL_Y, throb, tipCharge, tremble, tyrantForm } from '@/game/freezer.ts';
import { pulseTicks } from '@/sim/hex.ts';
import type { HexBody, HexStage } from '@/sim/types.ts';
import { WEAPONS } from '@/weapons/registry.ts';

const SPEC = WEAPONS.freezer.hex!;
const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));

function hex(stage: HexStage, stageTicks: number, extra: Partial<HexBody> = {}): HexBody {
  return {
    id: 1,
    weaponId: 'freezer',
    attackerId: 'a',
    ownerTeamId: 'red',
    victimId: 'v',
    spec: SPEC,
    stage,
    stageTicks,
    holdX: 100,
    holdY: 200,
    facing: 1,
    tipX: 107,
    tipY: 191.5,
    targetX: 300,
    targetY: 192,
    arcPx: 36,
    flightTicks: 22,
    groundX: 300,
    groundY: 200,
    liftPx: 36,
    pulses: 0,
    burst: false,
    alive: true,
    ...extra,
  };
}

describe('freezer look: the emperor', () => {
  it('takes the form as the arm goes up, keeps it while the light works, and drops it in the recovery', () => {
    expect(tyrantForm(hex('point', 0))).toBe(0);
    expect(tyrantForm(hex('point', ticks(SPEC.pointMs)))).toBe(1);
    for (const stage of ['shot', 'rise', 'swell'] as const) expect(tyrantForm(hex(stage, 3))).toBe(1);
    expect(tyrantForm(hex('recover', Math.round(ticks(SPEC.recoverMs) * 0.3)))).toBe(1);
    expect(tyrantForm(hex('recover', ticks(SPEC.recoverMs)))).toBe(0);
  });

  it('gathers the light on the fingertip through the point, and has none once it flies', () => {
    const early = tipCharge(hex('point', 5));
    const late = tipCharge(hex('point', ticks(SPEC.pointMs) - 1));
    expect(early).toBeLessThan(late);
    expect(late).toBeGreaterThan(0.95);
    expect(tipCharge(hex('shot', 1))).toBe(0);
  });
});

describe('freezer look: the victim', () => {
  it('flares as the light goes in, settles as it floats, then burns brighter as it swells', () => {
    expect(innerGlow(hex('shot', 5))).toBe(0);
    const flare = innerGlow(hex('rise', 1));
    const settled = innerGlow(hex('rise', ticks(SPEC.riseMs) - 1));
    expect(flare).toBeGreaterThan(settled);
    const swelling = innerGlow(hex('swell', ticks(SPEC.swellMs) - 1));
    expect(swelling).toBeGreaterThan(settled);
    expect(innerGlow(hex('swell', 10, { burst: true }))).toBe(0);
    expect(innerGlow(hex('rise', 10, { victimId: null }))).toBe(0);
  });

  it('swells only while it hangs at the top, wider than tall, bigger and bigger to the burst', () => {
    expect(swelling(hex('rise', 30))).toEqual({ x: 1, y: 1 });
    const start = swelling(hex('swell', 1));
    const end = swelling(hex('swell', ticks(SPEC.swellMs)));
    expect(start.x).toBeLessThan(1.05);
    expect(end.x).toBeGreaterThanOrEqual(1 + SWELL_X);
    expect(end.y).toBeGreaterThanOrEqual(1 + SWELL_Y);
    expect(end.x).toBeGreaterThan(end.y);
    expect(swelling(hex('recover', 3, { burst: true }))).toEqual({ x: 1, y: 1 });
  });

  it('jolts on every throb and settles before the next', () => {
    const [first, second] = pulseTicks(SPEC);
    expect(throb(hex('swell', first! - 1))).toBe(0);
    expect(throb(hex('swell', first!))).toBe(1);
    expect(throb(hex('swell', second! - 1))).toBeLessThan(0.1);
    const on = swelling(hex('swell', second!));
    const before = swelling(hex('swell', second! - 1));
    expect(on.x - before.x).toBeGreaterThan(0.08);
  });

  it('trembles a little while it floats, and harder and harder as it swells', () => {
    expect(tremble(hex('shot', 3))).toBe(0);
    expect(tremble(hex('rise', 3))).toBeGreaterThan(0);
    expect(tremble(hex('swell', ticks(SPEC.swellMs)))).toBeGreaterThan(tremble(hex('swell', 1)));
  });
});
