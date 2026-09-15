import { describe, expect, it } from 'vitest';
import { addWorm, stepWorld, type SimWorld } from '@/sim/world.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

/**
 * A sheep covers about 2000 px in its 20 s life, so on any real map it used to walk off the edge,
 * fall past the mask and drown in silence with no explosion. The map edge is a wall now.
 */

function release(x: number, facing: 1 | -1): SimWorld {
  const world = flatWorld({ width: 900, floorY: 200 });
  addWorm(world, { id: 'shooter', teamId: 'a', x, y: 199, facing });
  const shooter = world.worms.find((b) => b.id === 'shooter');
  if (shooter === undefined) throw new Error('no shooter');
  fire(world, shooter, WEAPONS.sheep, { angleDeg: 45, power: 1 });
  return world;
}

describe('sheep at the map edge', () => {
  it('turns around at the right edge and keeps living instead of drowning', () => {
    const world = release(860, 1);
    let splashed = false;
    for (let i = 0; i < 300; i += 1) {
      const events = stepWorld(world, new Map());
      if (events.some((e) => e.type === 'sound' && e.id === 'exp_water_splash')) splashed = true;
    }
    const sheep = world.sheep[0];
    expect(sheep).toBeDefined();
    expect(sheep?.alive).toBe(true);
    expect(sheep?.facing).toBe(-1);
    expect(sheep?.x ?? 0).toBeLessThan(900);
    expect(splashed).toBe(false);
  });

  it('turns around at the left edge too', () => {
    const world = release(40, -1);
    for (let i = 0; i < 300; i += 1) stepWorld(world, new Map());
    const sheep = world.sheep[0];
    expect(sheep?.alive).toBe(true);
    expect(sheep?.facing).toBe(1);
    expect(sheep?.x ?? -1).toBeGreaterThan(0);
  });

  it('detonates on the flag the second fire press sets, with a sound that exists', () => {
    const world = release(400, 1);
    const sheep = world.sheep[0];
    if (sheep === undefined) throw new Error('no sheep');
    sheep.detonateRequested = true;
    const events = stepWorld(world, new Map());
    expect(sheep.alive).toBe(false);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(events.some((e) => e.type === 'sound' && e.id === 'exp_medium_1')).toBe(true);
  });

  it('runs more than it flies: on flat ground it is on its feet most of the time', () => {
    const world = release(200, 1);
    const sheep = world.sheep[0];
    if (sheep === undefined) throw new Error('no sheep');
    let grounded = 0;
    const ticks = 600;
    for (let i = 0; i < ticks; i += 1) {
      stepWorld(world, new Map());
      if (sheep.onGround) grounded += 1;
    }
    // Before the cadence change the sheep spent about half its life mid arc.
    expect(grounded / ticks).toBeGreaterThan(0.6);
    expect(sheep.alive).toBe(true);
  });
});
