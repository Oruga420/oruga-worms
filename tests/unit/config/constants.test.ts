import { describe, expect, it } from 'vitest';
import {
  CANVAS_IDS,
  FIRST_HUD_LAYER,
  LAYER,
  LAYER_ORDER,
  MASK,
  TICK_RATE,
  WORLD_SIZE_DEFAULT,
  WORLD_SIZE_MAX,
  isHudLayer,
  isMaskValue,
  isValidWorldSize,
} from '@/config/constants.ts';
import { SIM_HZ } from '@/config/units.ts';

describe('constants: tick rate', () => {
  it('aliases units.ts SIM_HZ', () => {
    expect(TICK_RATE).toBe(SIM_HZ);
    expect(TICK_RATE).toBe(60);
  });
});

describe('constants: render layers', () => {
  it('follows the architecture.md section A order from sky to screen HUD', () => {
    expect(LAYER.SKY).toBe(0);
    expect(LAYER.TERRAIN).toBe(4);
    expect(LAYER.WORMS).toBe(6);
    expect(LAYER.PARTICLES).toBe(8);
    expect(LAYER.WATER_FRONT).toBe(9);
    expect(LAYER.HUD_WORLD).toBe(10);
    expect(LAYER.HUD_SCREEN).toBe(11);
  });

  it('has twelve distinct consecutive indices', () => {
    const values = Object.values(LAYER).sort((a, b) => a - b);
    expect(values).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('puts only the two HUD layers on the HUD canvas', () => {
    expect(FIRST_HUD_LAYER).toBe(10);
    expect(isHudLayer(LAYER.WATER_FRONT)).toBe(false);
    expect(isHudLayer(LAYER.HUD_WORLD)).toBe(true);
    expect(isHudLayer(LAYER.HUD_SCREEN)).toBe(true);
  });

  it('lists layer names in draw order', () => {
    expect(LAYER_ORDER[0]).toBe('SKY');
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe('HUD_SCREEN');
    expect(LAYER_ORDER).toHaveLength(12);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(LAYER)).toBe(true);
    expect(Object.isFrozen(MASK)).toBe(true);
    expect(Object.isFrozen(CANVAS_IDS)).toBe(true);
  });
});

describe('constants: terrain mask values', () => {
  it('uses AIR 0, SOLID 1, BEDROCK 2', () => {
    expect(MASK.AIR).toBe(0);
    expect(MASK.SOLID).toBe(1);
    expect(MASK.BEDROCK).toBe(2);
  });

  it('recognizes only the three values', () => {
    expect(isMaskValue(0)).toBe(true);
    expect(isMaskValue(2)).toBe(true);
    expect(isMaskValue(3)).toBe(false);
    expect(isMaskValue(-1)).toBe(false);
  });
});

describe('constants: world size', () => {
  it('defaults to the 1920 x 696 standard map with a 3840 x 1392 ceiling', () => {
    expect(WORLD_SIZE_DEFAULT).toEqual({ w: 1920, h: 696 });
    expect(WORLD_SIZE_MAX).toEqual({ w: 3840, h: 1392 });
  });

  it('validates sizes against the ceiling', () => {
    expect(isValidWorldSize(WORLD_SIZE_DEFAULT)).toBe(true);
    expect(isValidWorldSize(WORLD_SIZE_MAX)).toBe(true);
    expect(isValidWorldSize({ w: 3841, h: 100 })).toBe(false);
    expect(isValidWorldSize({ w: 100, h: 1393 })).toBe(false);
    expect(isValidWorldSize({ w: 0, h: 100 })).toBe(false);
    expect(isValidWorldSize({ w: 100.5, h: 100 })).toBe(false);
  });
});

describe('constants: canvas ids', () => {
  it('matches the ids in index.html', () => {
    expect(CANVAS_IDS.world).toBe('world');
    expect(CANVAS_IDS.hud).toBe('hud');
  });
});
