import { describe, expect, it } from 'vitest';
import { aimAtWorm } from '@/ai/aim-at.ts';
import { shotFor } from '@/ai/heuristic.ts';
import { simulateShot } from '@/ai/trajectory.ts';
import { GRAVITY_PX_PER_S2 } from '@/sim/constants.ts';
import { createMask, setSpan, SOLID } from '@/terrain/mask.ts';
import { WEAPONS } from '@/weapons/registry.ts';

function flatMask(width = 1000, height = 400, floorY = 300) {
  const mask = createMask(width, height);
  for (let y = floorY; y < height; y += 1) setSpan(mask, y, 0, width - 1, SOLID);
  return mask;
}

const env = { mask: flatMask(), waterY: 390, wind: 0, gravity: GRAVITY_PX_PER_S2 };
const me = { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true };
const enemy = { id: 'b1', teamId: 'blue', x: 520, y: 299, hp: 100, alive: true };

describe('aimAtWorm', () => {
  it('puts a bazooka shell on the worm it is aimed at, facing it', () => {
    const solution = aimAtWorm({ def: WEAPONS.bazooka, from: me, target: enemy, worms: [me, enemy], env });
    expect(solution.facing).toBe(1);
    expect(solution.safe).toBe(true);
    expect(solution.missPx).toBeLessThan(WEAPONS.bazooka.blast!.radiusPx * 0.6);
  });

  it('aims the other way at a worm on the left', () => {
    const left = { ...enemy, x: 20 };
    expect(aimAtWorm({ def: WEAPONS.bazooka, from: me, target: left, worms: [me, left], env }).facing).toBe(-1);
  });

  it('never lands a shell at the shooter\'s feet when a safe shot exists', () => {
    const near = { ...enemy, x: 330 };
    const solution = aimAtWorm({ def: WEAPONS.bazooka, from: me, target: near, worms: [me, near], env });
    expect(solution.safe).toBe(true);
  });

  it('does not fire through a friend standing in the way', () => {
    const friend = { id: 'r2', teamId: 'red', x: 260, y: 299, hp: 100, alive: true };
    const solution = aimAtWorm({ def: WEAPONS.bazooka, from: me, target: enemy, worms: [me, friend, enemy], env });
    expect(solution.safe).toBe(true);
    // The chosen shell clears the friend: replay it with the bodies and check where it goes off.
    const shot = shotFor(WEAPONS.bazooka, me, solution.angleDeg, solution.power, solution.facing);
    const impact = simulateShot(shot!, { ...env, bodies: [{ x: friend.x, y: friend.y, halfWidth: 5, height: 16 }] });
    expect(Math.abs(impact!.x - friend.x)).toBeGreaterThan(WEAPONS.bazooka.blast!.radiusPx);
  });

  it('aims a gun or a beam straight at the worm, and sends a strike onto it', () => {
    expect(aimAtWorm({ def: WEAPONS.kamehameha, from: me, target: enemy, worms: [me, enemy], env }).angleDeg).toBeCloseTo(0, 0);
    expect(aimAtWorm({ def: WEAPONS.air_strike, from: me, target: enemy, worms: [me, enemy], env }).targetPoint).toEqual({ x: 520, y: 299 });
  });
});
