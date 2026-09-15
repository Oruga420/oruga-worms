import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import {
  DEFAULT_WATER_MARGIN,
  WATER_FRONT_ALPHA,
  createWater,
  initialWaterY,
  isDrowned,
  rise,
  waterBandOffsets,
} from '@/terrain/water.ts';

describe('water: state', () => {
  it('starts a margin above the bottom of the map', () => {
    expect(DEFAULT_WATER_MARGIN).toBe(40);
    expect(initialWaterY(696)).toBe(656);
    expect(initialWaterY(696, 10)).toBe(686);
    expect(createWater(600)).toEqual({ y: 600 });
    expect(Object.isFrozen(createWater(600))).toBe(true);
  });

  it('rises by the sudden death constant per turn without mutating the previous state', () => {
    const perTurn = GAME_CONFIG.suddenDeath.waterRisePxPerTurn;
    expect(perTurn).toBe(20);
    const water = createWater(600);
    const once = rise(water);
    expect(once.y).toBe(600 - perTurn);
    expect(water.y).toBe(600);
    expect(rise(water, 3).y).toBe(600 - 3 * perTurn);
    expect(rise(water, 0)).toEqual(water);
  });

  it('never rises above the top of the map', () => {
    expect(rise(createWater(10)).y).toBe(0);
    expect(rise(createWater(0), 5).y).toBe(0);
  });

  it('drowns anything whose lowest point is below the surface', () => {
    const water = createWater(600);
    expect(isDrowned(water, 601)).toBe(true);
    expect(isDrowned(water, 600)).toBe(false);
    expect(isDrowned(water, 599.5)).toBe(false);
    expect(isDrowned(water, 590, 16)).toBe(true);
    expect(isDrowned(water, 580, 16)).toBe(false);
  });
});

describe('water: render bands', () => {
  it('is a pure function of time with the front band at alpha 0.45', () => {
    expect(WATER_FRONT_ALPHA).toBe(0.45);
    const a = waterBandOffsets(1234.5, 512);
    const b = waterBandOffsets(1234.5, 512);
    expect(a).toEqual(b);
    expect(a.front.alpha).toBe(0.45);
    expect(a.behind.alpha).toBe(1);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('starts at rest and keeps the scroll offset inside one tile', () => {
    const start = waterBandOffsets(0, 512);
    expect(start.behind.dx).toBe(0);
    expect(start.behind.dy).toBe(0);
    expect(start.front.dx).toBe(0);
    expect(start.front.dy).toBe(0);
    for (let t = 0; t < 120_000; t += 333) {
      const bands = waterBandOffsets(t, 512);
      for (const band of [bands.behind, bands.front]) {
        expect(band.dx).toBeGreaterThanOrEqual(0);
        expect(band.dx).toBeLessThan(512);
        expect(Math.abs(band.dy)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('scrolls the two bands in opposite directions so they read as depth', () => {
    const early = waterBandOffsets(100, 512);
    const later = waterBandOffsets(200, 512);
    expect(later.behind.dx).toBeGreaterThan(early.behind.dx);
    expect(later.front.dx).toBeLessThan(early.front.dx);
  });
});
