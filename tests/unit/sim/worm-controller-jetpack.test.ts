import { describe, expect, it } from 'vitest';
import { addWorm, stepWorld, type SimWorld } from '@/sim/world.ts';
import type { WormBody, WormIntent } from '@/sim/types.ts';
import { flatWorld } from './fixture.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { wormAtRest } from '@/sim/rest.ts';
import { setSpan, SOLID } from '@/terrain/mask.ts';

/**
 * The jetpack used to be a data row with a dead flag: fireUtility set motion 'jetpacking' and a
 * fuel count and nothing in the sim read either, so the worm fell like a stone with the keys
 * ignored (measured: vy exactly gravity times t, x never moved). These pin the thrust, the
 * steering, the fuel drain and the empty tank.
 */

const HOLD: WormIntent = { moveX: 0, jump: false, backflip: false, thrust: true };
const HOLD_RIGHT: WormIntent = { moveX: 1, jump: false, backflip: false, thrust: true };
const COAST: WormIntent = { moveX: 0, jump: false, backflip: false, thrust: false };

function flying(): { world: SimWorld; worm: WormBody } {
  // Explicit height and water: the fixture's defaults (300 high, water at 280) would put a floor
  // at 350 below the map and drown a worm hovering at 320.
  const world = flatWorld({ width: 900, height: 400, floorY: 350, waterY: 390 });
  addWorm(world, { id: 'w', teamId: 'a', x: 300, y: 200, facing: 1 });
  const worm = world.worms.find((b) => b.id === 'w');
  if (worm === undefined) throw new Error('no worm');
  worm.motion = 'jetpacking';
  worm.onGround = false;
  worm.fuelMs = 5000;
  return { world, worm };
}

function step(world: SimWorld, intent: WormIntent, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) stepWorld(world, new Map([['w', intent]]));
}

describe('jetpack flight', () => {
  it('keeps the pack after a ceiling collision and can steer away', () => {
    const { world, worm } = flying();
    setSpan(world.terrain.mask, 150, 250, 350, SOLID);
    step(world, HOLD, 45);
    expect(worm.motion).toBe('jetpacking');
    expect(worm.y).toBeGreaterThan(150);
    step(world, HOLD_RIGHT, 60);
    expect(worm.motion).toBe('jetpacking');
    expect(worm.x).toBeGreaterThan(350);
  });
  it('stays equipped after ground activation so thrust can start later', () => {
    const { world, worm } = flying();
    worm.y = 349;
    worm.motion = 'idle';
    worm.onGround = true;
    fire(world, worm, WEAPONS.jetpack, { angleDeg: 45, power: 1 });
    step(world, COAST, 60);
    expect(worm.motion).toBe('jetpacking');
    expect(worm.fuelMs).toBe(5000);
    expect(wormAtRest(worm)).toBe(true);
    step(world, HOLD_RIGHT, 30);
    expect(worm.y).toBeLessThan(329);
    expect(worm.x).toBeGreaterThan(300);
    expect(worm.onGround).toBe(false);
  });

  it('can land and take off again using the same remaining fuel', () => {
    const { world, worm } = flying();
    step(world, COAST, 120);
    expect(worm.onGround).toBe(true);
    expect(worm.motion).toBe('jetpacking');
    const fuel = worm.fuelMs;
    step(world, HOLD, 30);
    expect(worm.y).toBeLessThan(329);
    expect(worm.fuelMs).toBeLessThan(fuel);
  });
  it('climbs while the thrust key is held and steers on the movement keys', () => {
    const { world, worm } = flying();
    step(world, HOLD_RIGHT, 60);
    expect(worm.motion).toBe('jetpacking');
    expect(worm.y).toBeLessThan(200);
    expect(worm.x).toBeGreaterThan(300);
    expect(worm.facing).toBe(1);
  });

  it('falls when nothing is held, as gravity is the only force left', () => {
    const { world, worm } = flying();
    step(world, COAST, 30);
    expect(worm.y).toBeGreaterThan(200);
  });

  it('burns fuel only while thrusting', () => {
    const { world, worm } = flying();
    // A short coast: long enough to prove no fuel goes, short enough that the worm is still airborne.
    step(world, COAST, 15);
    expect(worm.fuelMs).toBe(5000);
    expect(worm.motion).toBe('jetpacking');
    step(world, HOLD, 60);
    expect(worm.fuelMs).toBeGreaterThan(3900);
    expect(worm.fuelMs).toBeLessThan(4100);
  });

  it('with an empty tank the worm is falling and lands on the floor', () => {
    const { world, worm } = flying();
    // Low over the floor with a sip of fuel: the tank empties in a few ticks, then a soft landing.
    worm.y = 320;
    worm.fuelMs = 100;
    step(world, HOLD, 20);
    expect(worm.fuelMs).toBe(0);
    expect(worm.motion).not.toBe('jetpacking');
    step(world, HOLD, 120);
    expect(worm.motion).toBe('idle');
    expect(worm.y).toBeCloseTo(349, 0);
  });
});
