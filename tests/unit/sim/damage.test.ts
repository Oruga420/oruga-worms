import { describe, expect, it } from 'vitest';
import { SOURCE_HZ } from '@/config/units.ts';
import { blastDamage, fallDamage, falloff, knockbackVelocity } from '@/sim/damage.ts';

describe('blast damage', () => {
  it('falls off linearly to zero at the radius', () => {
    expect(falloff(0, 50)).toBe(1);
    expect(falloff(25, 50)).toBeCloseTo(0.5, 6);
    expect(falloff(50, 50)).toBe(0);
    expect(falloff(80, 50)).toBe(0);
    expect(blastDamage(50, 0, 48.5)).toBe(50);
    expect(blastDamage(50, 24.25, 48.5)).toBe(25);
    expect(blastDamage(50, 60, 48.5)).toBe(0);
  });

  it('knocks away from the center, straight up when on top of it', () => {
    const away = knockbackVelocity({ x: 0, y: 0 }, { x: 10, y: 0 }, 500, 50);
    expect(away.x).toBeCloseTo(400, 6);
    expect(away.y).toBe(0);
    const up = knockbackVelocity({ x: 0, y: 0 }, { x: 0, y: 0 }, 500, 50);
    expect(up.y).toBeCloseTo(-500, 6);
    expect(knockbackVelocity({ x: 0, y: 0 }, { x: 100, y: 0 }, 500, 50)).toEqual({ x: 0, y: 0 });
  });
});

describe('fall damage', () => {
  const perFrame = (px: number): number => px * SOURCE_HZ;

  it('is zero up to the 8 px per frame threshold', () => {
    expect(fallDamage(perFrame(8))).toBe(0);
    expect(fallDamage(perFrame(3))).toBe(0);
  });

  it('follows the canonical formula and caps at 67 at the terminal speed', () => {
    expect(fallDamage(perFrame(20))).toBe(Math.floor(((20 - 8 + 1 / 65536) * 50 + 18) / 18));
    expect(fallDamage(perFrame(32))).toBe(67);
    expect(fallDamage(perFrame(90))).toBe(67);
  });
});
