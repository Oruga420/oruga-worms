import { describe, expect, it } from 'vitest';
import { crackGlow, drawSproutScene, isSaibaman, moundTremble, seedDepth, seedHand, sinceCrack } from '@/game/saibaman.ts';
import { crackTicks } from '@/sim/sprout.ts';
import type { SproutBody, SproutStage } from '@/sim/types.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const SPEC = WEAPONS.saibaman.sprout!;
const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));

function sprout(stage: SproutStage, stageTicks: number, extra: Partial<SproutBody> = {}): SproutBody {
  return {
    id: 7,
    weaponId: 'saibaman',
    planterId: 'a',
    teamId: 'red',
    spec: SPEC,
    stage,
    stageTicks,
    holdX: 100,
    holdY: 199,
    facing: 1,
    spotX: 122,
    spotY: 199,
    fertile: true,
    cracks: 0,
    sproutId: null,
    alive: true,
    ...extra,
  };
}

describe('saibaman look', () => {
  it('knows a Saibaman by its size', () => {
    expect(isSaibaman({ size: 0.5 })).toBe(true);
    expect(isSaibaman({ size: 1 })).toBe(false);
    expect(isSaibaman({})).toBe(false);
  });

  it('holds the seed out, then pushes it down into the ground, and has it in by the end of the planting', () => {
    expect(seedDepth(sprout('plant', 1))).toBe(0);
    const half = seedDepth(sprout('plant', Math.round(ticks(SPEC.plantMs) * 0.55)));
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);
    expect(seedDepth(sprout('plant', ticks(SPEC.plantMs)))).toBe(1);
    expect(seedDepth(sprout('grow', 5))).toBe(1);
    // In the planter's hand, a little in front of it and up at its middle.
    expect(seedHand(sprout('plant', 1))).toEqual({ x: 107, y: 192 });
  });

  it('shows no light until the first crack, then brighter and brighter to the break', () => {
    expect(crackGlow(sprout('grow', 5))).toBe(0);
    const first = crackGlow(sprout('grow', 30, { cracks: 1 }));
    const last = crackGlow(sprout('grow', ticks(SPEC.growMs) - 1, { cracks: 3 }));
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(first);
    expect(crackGlow(sprout('recover', 5, { cracks: 3 }))).toBe(0);
  });

  it('shakes the mound harder with every crack, and flashes each crack as it opens', () => {
    const amplitude = (cracks: number): number => Math.max(...Array.from({ length: 40 }, (_, i) => Math.abs(moundTremble(sprout('grow', 10, { cracks }), i * 7))));
    expect(amplitude(0)).toBeGreaterThan(0);
    expect(amplitude(3)).toBeGreaterThan(amplitude(1));
    expect(moundTremble(sprout('plant', 10), 123)).toBe(0);
    const [firstCrack] = crackTicks(SPEC);
    expect(sinceCrack(sprout('grow', (firstCrack ?? 1) - 1))).toBe(Infinity);
    expect(sinceCrack(sprout('grow', (firstCrack ?? 1) + 4, { cracks: 1 }))).toBe(4);
  });

  it('draws the seed, the mound, the cracks and a wilted seed without throwing', () => {
    const spot = { x: 300, y: 400 };
    const hand = { x: 280, y: 380 };
    const draw = (body: SproutBody): number => {
      const ctx = createRecordingContext();
      drawSproutScene(ctx, body, spot, hand, 2.5, 1000);
      return ctx.calls.filter((c) => c.name === 'fill' || c.name === 'stroke').length;
    };
    expect(draw(sprout('plant', 5))).toBeGreaterThan(0);
    const cracked = draw(sprout('grow', 60, { cracks: 3 }));
    expect(cracked).toBeGreaterThan(draw(sprout('grow', 5)));
    expect(draw(sprout('recover', 5, { fertile: false }))).toBeGreaterThan(0);
    // Once the Saibaman is out there is nothing left to draw but the crater in the land.
    expect(draw(sprout('recover', 5, { sproutId: 'red-saiba-1', cracks: 3 }))).toBe(0);
  });
});
