import { describe, expect, it } from 'vitest';
import { createCamera } from '@/engine/camera.ts';
import { drawSceneryDepth } from '@/game/scenery-detail.ts';
import { SCENARIOS } from '@/terrain/scenarios.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const viewport = { w: 960, h: 540 };
const camera = createCamera({ x: 900, y: 350 });

describe('scenery depth layers', () => {
  it.each(['spaceship', 'castle'] as const)('%s is deterministic, parallax-aware and isolates canvas state', (id) => {
    const draw = (x: number, timeMs = 1000) => {
      const ctx = createRecordingContext();
      drawSceneryDepth(ctx, viewport, { ...camera, x }, SCENARIOS[id].sky, 300, timeMs);
      return ctx.calls;
    };
    const still = draw(900);
    expect(still[0]?.name).toBe('save');
    expect(still.at(-1)?.name).toBe('restore');
    expect(still).toEqual(draw(900));
    expect(still).not.toEqual(draw(1200));
    expect(still.some((call) => call.name === 'drawImage')).toBe(false);
    expect(still.filter((call) => call.name === 'closePath').length).toBeGreaterThan(8);
    expect(still.flatMap((call) => call.args).filter((value) => typeof value === 'number').every(Number.isFinite)).toBe(true);
  });

  it('does not introduce orbital or woodland silhouettes into either tropical sky', () => {
    for (const id of ['island', 'kame_house'] as const) {
      const ctx = createRecordingContext();
      drawSceneryDepth(ctx, viewport, camera, SCENARIOS[id].sky, 300, 0);
      expect(ctx.calls).toHaveLength(0);
    }
  });

  it('animates orbital debris with time without borrowing the world camera transform', () => {
    const a = createRecordingContext();
    const b = createRecordingContext();
    drawSceneryDepth(a, viewport, camera, SCENARIOS.spaceship.sky, 300, 0);
    drawSceneryDepth(b, viewport, camera, SCENARIOS.spaceship.sky, 300, 4000);
    expect(a.calls).not.toEqual(b.calls);
    expect(a.calls.filter((call) => call.name === 'scale')).toEqual([]);
  });
});
