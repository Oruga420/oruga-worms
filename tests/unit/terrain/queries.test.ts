import { describe, expect, it } from 'vitest';
import { SOLID, createMask, setSpan, type TerrainMask } from '@/terrain/mask.ts';
import {
  firstAirAbove,
  firstSolidBelow,
  isSolid,
  lineOfSight,
  sampleProfile,
  surfaceNormal,
} from '@/terrain/queries.ts';

/**
 * 40 x 40 fixture: a flat floor from row 30 down, a 3 px wide wall at x 20..22 from row 10 down,
 * and a floating ledge 2 px thick (rows 18..19) spanning x 5..12.
 */
function fixture(): TerrainMask {
  const mask = createMask(40, 40);
  for (let y = 30; y < 40; y += 1) setSpan(mask, y, 0, 39, SOLID);
  for (let y = 10; y < 30; y += 1) setSpan(mask, y, 20, 22, SOLID);
  for (let y = 18; y <= 19; y += 1) setSpan(mask, y, 5, 12, SOLID);
  return mask;
}

/** 30 x 30 half plane: solid where x + y >= 20, a 45 degree slope facing up and left. */
function slope(): TerrainMask {
  const mask = createMask(30, 30);
  for (let y = 0; y < 30; y += 1) {
    const x0 = Math.max(0, 20 - y);
    if (x0 < 30) setSpan(mask, y, x0, 29, SOLID);
  }
  return mask;
}

describe('queries: isSolid', () => {
  it('reads the mask and treats the outside as air', () => {
    const mask = fixture();
    expect(isSolid(mask, 0, 30)).toBe(true);
    expect(isSolid(mask, 0, 29)).toBe(false);
    expect(isSolid(mask, 21, 15)).toBe(true);
    expect(isSolid(mask, 8, 18)).toBe(true);
    expect(isSolid(mask, -1, 35)).toBe(false);
    expect(isSolid(mask, 5, 40)).toBe(false);
  });
});

describe('queries: vertical probes', () => {
  it('firstSolidBelow finds the ledge, then the floor under it, within maxDepth inclusive', () => {
    const mask = fixture();
    expect(firstSolidBelow(mask, 8, 0, 40)).toBe(18);
    expect(firstSolidBelow(mask, 8, 20, 40)).toBe(30);
    expect(firstSolidBelow(mask, 8, 18, 40)).toBe(18);
    expect(firstSolidBelow(mask, 30, 0, 5)).toBeNull();
    expect(firstSolidBelow(mask, 30, 0, 30)).toBe(30);
    expect(firstSolidBelow(mask, 30, 38, 10)).toBe(38);
  });

  it('firstSolidBelow stops at the bottom of the map and on invalid columns', () => {
    const mask = fixture();
    const air = createMask(10, 10);
    expect(firstSolidBelow(air, 5, 0, 100)).toBeNull();
    expect(firstSolidBelow(mask, 45, 0, 100)).toBeNull();
    expect(firstSolidBelow(mask, 5, -3, 100)).toBe(18);
  });

  it('firstAirAbove climbs out of the ledge and the floor within maxRise inclusive', () => {
    const mask = fixture();
    expect(firstAirAbove(mask, 8, 19, 5)).toBe(17);
    expect(firstAirAbove(mask, 8, 19, 1)).toBeNull();
    expect(firstAirAbove(mask, 8, 19, 2)).toBe(17);
    expect(firstAirAbove(mask, 30, 25, 3)).toBe(25);
    expect(firstAirAbove(mask, 30, 39, 20)).toBe(29);
    expect(firstAirAbove(mask, 30, 39, 9)).toBeNull();
  });

  it('firstAirAbove stops at the top of the map', () => {
    const solid = createMask(10, 10, SOLID);
    expect(firstAirAbove(solid, 5, 9, 100)).toBeNull();
    expect(firstAirAbove(solid, 20, 9, 100)).toBeNull();
  });
});

describe('queries: line of sight', () => {
  it('is clear through air and blocked by the wall, with early exit', () => {
    const mask = fixture();
    expect(lineOfSight(mask, 2, 5, 38, 5)).toBe(true);
    expect(lineOfSight(mask, 2, 15, 38, 15)).toBe(false);
    expect(lineOfSight(mask, 38, 15, 2, 15)).toBe(false);
    expect(lineOfSight(mask, 2, 5, 38, 8)).toBe(true);
    expect(lineOfSight(mask, 2, 25, 38, 25)).toBe(false);
  });

  it('checks both endpoints and handles vertical, degenerate and fractional segments', () => {
    const mask = fixture();
    expect(lineOfSight(mask, 8, 0, 8, 17)).toBe(true);
    expect(lineOfSight(mask, 8, 0, 8, 25)).toBe(false);
    expect(lineOfSight(mask, 3, 3, 3, 3)).toBe(true);
    expect(lineOfSight(mask, 21, 15, 21, 15)).toBe(false);
    expect(lineOfSight(mask, 2.4, 5.4, 37.6, 5.2)).toBe(true);
    expect(lineOfSight(mask, 2, 5, 2, 31)).toBe(false);
  });

  it('treats the outside of the map as air', () => {
    const mask = fixture();
    expect(lineOfSight(mask, -5, 5, 45, 5)).toBe(true);
    expect(lineOfSight(mask, -5, 35, 45, 35)).toBe(false);
  });
});

describe('queries: profile sampling', () => {
  it('returns the topmost solid row every step px, -1 where the column is all air', () => {
    const mask = fixture();
    const profile = sampleProfile(mask, 10);
    expect(profile.length).toBe(4);
    expect(Array.from(profile)).toEqual([30, 18, 10, 30]);
    const air = createMask(20, 10);
    expect(Array.from(sampleProfile(air, 5))).toEqual([-1, -1, -1, -1]);
  });

  it('gives about 64 samples across a 1920 px map at step 30', () => {
    const mask = createMask(1920, 40);
    setSpan(mask, 20, 0, 1919, SOLID);
    const profile = sampleProfile(mask, 30);
    expect(profile.length).toBe(64);
    expect(profile.every((y) => y === 20)).toBe(true);
    expect(() => sampleProfile(mask, 0)).toThrow(RangeError);
  });
});

describe('queries: surface normal', () => {
  it('points up on a flat floor and sideways on the wall faces', () => {
    const mask = fixture();
    const floor = surfaceNormal(mask, 30, 30);
    expect(floor.x).toBeCloseTo(0, 12);
    expect(floor.y).toBeCloseTo(-1, 12);
    const left = surfaceNormal(mask, 20, 15);
    expect(left.x).toBeCloseTo(-1, 12);
    expect(left.y).toBeCloseTo(0, 12);
    const right = surfaceNormal(mask, 22, 15);
    expect(right.x).toBeCloseTo(1, 12);
    expect(right.y).toBeCloseTo(0, 12);
  });

  it('is the unit diagonal on a 45 degree slope and has unit length everywhere it is defined', () => {
    const mask = slope();
    const n = surfaceNormal(mask, 10, 10);
    expect(n.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(n.y).toBeCloseTo(-Math.SQRT1_2, 9);
    for (let i = 0; i < 20; i += 1) {
      const m = surfaceNormal(mask, 20 - i, i);
      expect(Math.hypot(m.x, m.y)).toBeCloseTo(1, 9);
    }
  });

  it('falls back to straight up where the gradient vanishes', () => {
    const solid = createMask(10, 10, SOLID);
    expect(surfaceNormal(solid, 5, 5)).toEqual({ x: 0, y: -1 });
    const air = createMask(10, 10);
    expect(surfaceNormal(air, 5, 5)).toEqual({ x: 0, y: -1 });
  });
});
