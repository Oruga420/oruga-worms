import { describe, expect, it } from 'vitest';
import { aimBy, AIM_MAX_DEG, AIM_MIN_DEG, CHARGE_TIME_S, INITIAL_AIM, release, setAngle, tickCharge } from '@/game/aim.ts';

describe('aim', () => {
  it('changes the angle by the aim delta and clamps', () => {
    const up = aimBy(INITIAL_AIM, 1, 1);
    expect(up.angleDeg).toBeGreaterThan(INITIAL_AIM.angleDeg);
    expect(aimBy(INITIAL_AIM, 0, 1)).toBe(INITIAL_AIM);
    let s = INITIAL_AIM;
    for (let i = 0; i < 200; i += 1) s = aimBy(s, 1, 1);
    expect(s.angleDeg).toBe(AIM_MAX_DEG);
    let d = INITIAL_AIM;
    for (let i = 0; i < 200; i += 1) d = aimBy(d, -1, 1);
    expect(d.angleDeg).toBe(AIM_MIN_DEG);
  });

  it('setAngle clamps to the range', () => {
    expect(setAngle(INITIAL_AIM, 200).angleDeg).toBe(90);
    expect(setAngle(INITIAL_AIM, -200).angleDeg).toBe(-90);
  });
});

describe('charge', () => {
  it('ramps power to 1 over the charge time while fire is held', () => {
    let s = INITIAL_AIM;
    s = tickCharge(s, true, CHARGE_TIME_S / 2);
    expect(s.charging).toBe(true);
    expect(s.power).toBeCloseTo(0.5, 5);
    s = tickCharge(s, true, CHARGE_TIME_S);
    expect(s.power).toBe(1);
  });

  it('stops charging when fire is released', () => {
    const charged = tickCharge(INITIAL_AIM, true, CHARGE_TIME_S / 2);
    const released = tickCharge(charged, false, 0.1);
    expect(released.charging).toBe(false);
    expect(released.power).toBe(charged.power);
  });

  it('release returns at least a floor power and resets', () => {
    const tapped = release(INITIAL_AIM);
    expect(tapped.power).toBe(0.1);
    expect(tapped.state.power).toBe(0);
    const charged = release(tickCharge(INITIAL_AIM, true, CHARGE_TIME_S));
    expect(charged.power).toBe(1);
  });
});
