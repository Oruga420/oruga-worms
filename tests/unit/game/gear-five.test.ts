import { describe, expect, it } from 'vitest';
import { drumBounce, gearWhiteness, hatScale, lumpDown, mouthState } from '@/game/gear-five.ts';
import { drumTicks } from '@/sim/devour.ts';
import type { DevourBody, DevourStage } from '@/sim/types.ts';
import { WEAPONS } from '@/weapons/registry.ts';

const SPEC = WEAPONS.gear_five.devour!;
const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));

function devour(stage: DevourStage, stageTicks: number, extra: Partial<DevourBody> = {}): DevourBody {
  return {
    id: 1,
    weaponId: 'gear_five',
    attackerId: 'a',
    ownerTeamId: 'red',
    victimId: 'v',
    spec: SPEC,
    stage,
    stageTicks,
    holdX: 100,
    holdY: 200,
    facing: 1,
    shoulderX: 104,
    shoulderY: 191,
    reachX: 200,
    reachY: 192,
    grabX: 200,
    grabY: 200,
    mouthX: 111,
    mouthY: 193,
    chomps: 0,
    swallowed: false,
    burped: false,
    alive: true,
    ...extra,
  };
}

describe('gear 5 look: the white', () => {
  it('whitens through the awakening, stays white for the meal and wears off at the end', () => {
    const awaken = ticks(SPEC.awakenMs);
    expect(gearWhiteness(devour('awaken', 0))).toBe(0);
    expect(gearWhiteness(devour('awaken', Math.round(awaken / 2)))).toBeGreaterThan(0.3);
    expect(gearWhiteness(devour('awaken', awaken))).toBeGreaterThan(0.85);
    for (const stage of ['stretch', 'reel', 'chew'] as const) expect(gearWhiteness(devour(stage, 3))).toBe(1);
    const recover = ticks(SPEC.recoverMs);
    expect(gearWhiteness(devour('recover', Math.round(recover * 0.3)))).toBe(1);
    expect(gearWhiteness(devour('recover', recover))).toBe(0);
  });
});

describe('gear 5 look: the drums', () => {
  it('bounces on each drum, swings back and settles, and stays still between the awakening and the drums', () => {
    const first = drumTicks(SPEC)[0]!;
    expect(drumBounce(devour('awaken', first - 1))).toBe(0);
    expect(drumBounce(devour('awaken', first))).toBe(1);
    const swing = [...Array(20).keys()].map((k) => drumBounce(devour('awaken', first + k)));
    expect(Math.min(...swing)).toBeLessThan(-0.2);
    expect(drumBounce(devour('stretch', 2))).toBe(0);
  });

  it('puts the hat on only once it has awoken, popping in bigger than life', () => {
    expect(hatScale(devour('awaken', 100))).toBe(0);
    expect(hatScale(devour('stretch', 0))).toBeGreaterThan(1.2);
    expect(hatScale(devour('chew', 5))).toBe(1);
  });
});

describe('gear 5 look: the mouth', () => {
  it('has no giant head while it awakens, while the arm flies out, or after a whiff', () => {
    expect(mouthState(devour('awaken', 50))).toBeNull();
    expect(mouthState(devour('stretch', 5))).toBeNull();
    expect(mouthState(devour('reel', 10, { victimId: null }))).toBeNull();
  });

  it('grows and opens wide as the meal is reeled in', () => {
    const reel = ticks(SPEC.reelMs);
    const early = mouthState(devour('reel', 1))!;
    const late = mouthState(devour('reel', reel))!;
    expect(early.grow).toBeLessThan(late.grow);
    expect(late.grow).toBe(1);
    expect(late.open).toBeGreaterThan(0.8);
  });

  it('snaps shut on every bite and opens again before the next', () => {
    const interval = ticks(SPEC.chompIntervalMs);
    for (let bite = 0; bite < SPEC.chomps; bite += 1) {
      expect(mouthState(devour('chew', 1 + bite * interval))!.open).toBeLessThan(0.1);
      expect(mouthState(devour('chew', 1 + bite * interval + Math.round(interval / 2)))!.open).toBeGreaterThan(0.8);
    }
  });

  it('shrinks back to the worm after the swallow', () => {
    const recover = ticks(SPEC.recoverMs);
    expect(mouthState(devour('recover', 1, { swallowed: true }))!.grow).toBeGreaterThan(0.9);
    expect(mouthState(devour('recover', Math.round(recover * 0.5), { swallowed: true }))).toBeNull();
  });
});

describe('gear 5 look: the lump', () => {
  it('goes down from the neck to the belly after the swallow, and is gone with the burp', () => {
    const recover = ticks(SPEC.recoverMs);
    expect(lumpDown(devour('chew', 10))).toBeNull();
    const high = lumpDown(devour('recover', Math.round(recover * 0.15), { swallowed: true }))!;
    const low = lumpDown(devour('recover', Math.round(recover * 0.35), { swallowed: true }))!;
    expect(low).toBeGreaterThan(high);
    expect(lumpDown(devour('recover', Math.round(recover * 0.5), { swallowed: true, burped: true }))).toBeNull();
    expect(lumpDown(devour('recover', 5, { victimId: null }))).toBeNull();
  });
});
