import { describe, expect, it } from 'vitest';
import { GRAVITY_PX_PER_S2, TICK_S } from '@/sim/constants.ts';
import { applyForces, bounce, sweepMove, windAcceleration } from '@/sim/integrator.ts';
import { flatTerrain } from './fixture.ts';

describe('integrator', () => {
  it('applies gravity scaled per body and wind only on flagged bodies', () => {
    const shell = { x: 0, y: 0, vx: 0, vy: 0 };
    applyForces(shell, 1, 1, 0.5, true);
    expect(shell.vy).toBeCloseTo(GRAVITY_PX_PER_S2, 6);
    expect(shell.vx).toBeCloseTo(windAcceleration(0.5), 6);
    const grenade = { x: 0, y: 0, vx: 0, vy: 0 };
    applyForces(grenade, 1, 0.5, 0.5, false);
    expect(grenade.vy).toBeCloseTo(GRAVITY_PX_PER_S2 / 2, 6);
    expect(grenade.vx).toBe(0);
  });

  it('reaches a known apex under gravity', () => {
    const body = { x: 0, y: 100, vx: 0, vy: -250 };
    let top = body.y;
    for (let i = 0; i < 120; i += 1) {
      applyForces(body, TICK_S, 1, 0, false);
      body.y += body.vy * TICK_S;
      top = Math.min(top, body.y);
    }
    const expected = 100 - (250 * 250) / (2 * GRAVITY_PX_PER_S2);
    expect(top).toBeCloseTo(expected, -1);
  });

  it('sweeps and stops at the floor', () => {
    const terrain = flatTerrain({ floorY: 200 });
    const body = { x: 50, y: 190, vx: 0, vy: 600 };
    const hit = sweepMove(terrain.mask, body, TICK_S * 3);
    expect(hit).not.toBeNull();
    expect(body.y).toBeLessThan(200);
  });

  it('bounces with restitution and friction, or stops when too slow', () => {
    const fast = { x: 0, y: 0, vx: 100, vy: 200 };
    const hit = { x: 0, y: 0, solidX: 0, solidY: 1, normal: { x: 0, y: -1 }, t: 0.5 };
    expect(bounce(fast, hit, 0.6, 0.96)).toBe(true);
    expect(fast.vy).toBeCloseTo(-120, 6);
    expect(fast.vx).toBeCloseTo(96, 6);
    expect(fast.y).toBe(-1);
    const slow = { x: 0, y: 0, vx: 2, vy: 10 };
    expect(bounce(slow, hit, 0.6, 0.96)).toBe(false);
    expect(slow.vx).toBe(0);
    expect(slow.vy).toBe(0);
  });
});
