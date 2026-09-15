import { describe, expect, it } from 'vitest';
import { clearShot, estimateBlast, simulateShot, type ShotSpec, type TrajectoryEnv } from '@/ai/trajectory.ts';
import { GRAVITY_PX_PER_S2 } from '@/sim/constants.ts';
import { createMask, setSpan, SOLID } from '@/terrain/mask.ts';

function floor(width = 800, height = 400, floorY = 300): TrajectoryEnv {
  const mask = createMask(width, height);
  for (let y = floorY; y < height; y += 1) setSpan(mask, y, 0, width - 1, SOLID);
  return { mask, waterY: height - 10, wind: 0, gravity: GRAVITY_PX_PER_S2 };
}

const CONTACT: Omit<ShotSpec, 'x0' | 'y0' | 'vx' | 'vy'> = {
  radiusPx: 3,
  bounce: 0,
  friction: 0,
  windAffected: true,
  gravityScale: 1,
  fuseMs: null,
  maxLifetimeMs: 7000,
  water: 'splash',
};

describe('simulateShot', () => {
  it('lands a contact shot on the floor down range', () => {
    const env = floor();
    const impact = simulateShot({ ...CONTACT, x0: 100, y0: 100, vx: 300, vy: -100 }, env);
    expect(impact).not.toBeNull();
    expect(impact?.reason).toBe('contact');
    expect(impact?.y).toBeLessThanOrEqual(300);
    expect(impact?.x).toBeGreaterThan(100);
  });

  it('wind bends the landing point down wind', () => {
    const still = floor();
    const windy: TrajectoryEnv = { ...floor(), wind: 1 };
    const a = simulateShot({ ...CONTACT, x0: 100, y0: 100, vx: 200, vy: -150 }, still);
    const b = simulateShot({ ...CONTACT, x0: 100, y0: 100, vx: 200, vy: -150 }, windy);
    expect(b?.x ?? 0).toBeGreaterThan(a?.x ?? 0);
  });

  it('detonates a fused shot in the air when it does not hit terrain first', () => {
    const env = floor(800, 400, 390);
    const impact = simulateShot({ ...CONTACT, x0: 100, y0: 100, vx: 50, vy: -200, bounce: 0.6, friction: 0.9, fuseMs: 1000 }, env);
    expect(impact?.reason).toBe('fuse');
  });

  it('splashes into the water', () => {
    const env = floor(800, 400, 500);
    env.mask.data.fill(0);
    const impact = simulateShot({ ...CONTACT, x0: 100, y0: 100, vx: 0, vy: 100 }, { ...env, waterY: 200 });
    expect(impact?.reason).toBe('water');
    expect(impact?.y).toBe(200);
  });
});

describe('estimateBlast', () => {
  it('damages nearer worms more and skips the dead', () => {
    const worms = [
      { id: 'a', teamId: 't', x: 100, y: 300, hp: 100, alive: true },
      { id: 'b', teamId: 't', x: 140, y: 300, hp: 100, alive: true },
      { id: 'c', teamId: 't', x: 400, y: 300, hp: 100, alive: true },
      { id: 'd', teamId: 't', x: 100, y: 300, hp: 100, alive: false },
    ];
    const estimate = estimateBlast(100, 292, 50, 50, worms);
    expect(estimate.perWorm.get('a')).toBeGreaterThan(estimate.perWorm.get('b') ?? 0);
    expect(estimate.perWorm.has('c')).toBe(false);
    expect(estimate.perWorm.has('d')).toBe(false);
    expect(estimate.total).toBeGreaterThan(0);
  });

  it('clamps to the worm hp', () => {
    const estimate = estimateBlast(100, 292, 50, 100, [{ id: 'a', teamId: 't', x: 100, y: 300, hp: 20, alive: true }]);
    expect(estimate.perWorm.get('a')).toBe(20);
  });
});

describe('clearShot', () => {
  it('is blocked by a wall between the two points', () => {
    const env = floor();
    for (let y = 0; y < 400; y += 1) setSpan(env.mask, y, 400, 404, SOLID);
    expect(clearShot(env.mask, 100, 100, 700, 100)).toBe(false);
    expect(clearShot(env.mask, 100, 100, 300, 100)).toBe(true);
  });
});
