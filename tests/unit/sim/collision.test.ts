import { describe, expect, it } from 'vitest';
import { discBlocked, groundBelow, sweep } from '@/sim/collision.ts';
import { flatTerrain } from './fixture.ts';

describe('sweep against the mask', () => {
  const terrain = flatTerrain({ floorY: 200 });

  it('moves freely through air', () => {
    const r = sweep(terrain.mask, 10, 10, 60, 40);
    expect(r.hit).toBeNull();
    expect(r.x).toBe(60);
    expect(r.y).toBe(40);
  });

  it('stops at the last free pixel above the floor with an upward normal', () => {
    const r = sweep(terrain.mask, 100, 150, 100, 250);
    expect(r.hit).not.toBeNull();
    expect(r.y).toBeLessThan(200);
    expect(r.y).toBeGreaterThanOrEqual(198);
    expect(r.hit?.normal.y).toBeLessThan(-0.5);
  });

  it('never tunnels through a thin ledge at 60 px per tick', () => {
    const ledge = flatTerrain({ floorY: 290, wall: { x: 0, height: 0 } });
    // A 2 px thick ledge at y 100..101 across the map.
    for (let x = 0; x < ledge.width; x += 1) {
      ledge.mask.data[100 * ledge.width + x] = 1;
      ledge.mask.data[101 * ledge.width + x] = 1;
    }
    const r = sweep(ledge.mask, 200, 60, 200, 120);
    expect(r.hit).not.toBeNull();
    expect(r.y).toBeLessThan(100);
  });

  it('reports a sideways normal on a wall', () => {
    const walled = flatTerrain({ floorY: 200, wall: { x: 150, height: 40 } });
    const r = sweep(walled.mask, 120, 190, 180, 190);
    expect(r.hit).not.toBeNull();
    expect(r.x).toBeLessThan(150);
    expect(r.hit?.normal.x).toBeLessThan(-0.5);
  });

  it('checks discs and ground', () => {
    expect(discBlocked(terrain.mask, 50, 190, 3)).toBe(false);
    expect(discBlocked(terrain.mask, 50, 198, 3)).toBe(true);
    expect(groundBelow(terrain.mask, 50, 199)).toBe(true);
    expect(groundBelow(terrain.mask, 50, 150)).toBe(false);
  });
});
