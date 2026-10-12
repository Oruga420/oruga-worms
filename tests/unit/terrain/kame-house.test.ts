import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_DEFAULT } from '@/config/constants.ts';
import { carveCircle } from '@/terrain/carve.ts';
import { AIR, SOLID, get } from '@/terrain/mask.ts';
import { buildKameHouse } from '@/terrain/scenarios/kame-house.ts';
import { createTiles } from '@/terrain/tiles.ts';
import { initialWaterY } from '@/terrain/water.ts';
import { createFakeFactory } from './fakes.ts';

const { w: width, h: height } = WORLD_SIZE_DEFAULT;
const options = { width, height, seed: 3, waterY: initialWaterY(height) };
const centerX = Math.round(width / 2 + 160);
const wallTop = Math.round(height * 0.805) - 92;

function paintRecords(build: ReturnType<typeof buildKameHouse>) {
  const fake = createFakeFactory();
  const tiles = createTiles(width, height, fake.factory, { tileSize: width, scale: 1 });
  build.paint(tiles);
  return fake.created.flatMap((ctx) => ctx.rects);
}

describe('reference-based Kame House', () => {
  it('has a tall pitched gable with straight slopes, not the former shallow dome', () => {
    const { mask } = buildKameHouse(options);
    expect(get(mask, centerX, wallTop - 58)).toBe(SOLID);
    expect(get(mask, centerX - 30, wallTop - 30)).toBe(SOLID);
    expect(get(mask, centerX + 30, wallTop - 30)).toBe(SOLID);
    expect(get(mask, centerX - 70, wallTop - 30)).toBe(AIR);
    expect(get(mask, centerX + 70, wallTop - 30)).toBe(AIR);
    expect(get(mask, centerX, wallTop - 62)).toBe(AIR);
  });

  it('never paints the room or sky as if it were collision terrain', () => {
    const build = buildKameHouse(options);
    const records = paintRecords(build);
    expect(records.length).toBeGreaterThan(0);
    const airPaint = records.flatMap((rect) => {
      const invalid: string[] = [];
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        for (let x = rect.x; x < rect.x + rect.w; x += 1) {
          if (get(build.mask, x, y) !== SOLID) invalid.push(`${x},${y}`);
        }
      }
      return invalid;
    });
    expect(airPaint.length, airPaint.slice(0, 4).join('; ')).toBe(0);
    expect(get(build.mask, centerX, wallTop + 45)).toBe(AIR);
  });

  it('keeps lettering in destructible tiles instead of an indestructible billboard prop', () => {
    const build = buildKameHouse(options);
    expect(build.props.some((prop) => prop.kind === 'sign')).toBe(false);
    const before = paintRecords(build);
    expect(before.some((rect) => rect.y < wallTop && rect.w <= 2)).toBe(true);
    const roofY = wallTop - 28;
    expect(get(build.mask, centerX, roofY)).toBe(SOLID);
    const result = carveCircle(build.mask, centerX, roofY, 24);
    expect(result.spans.length).toBeGreaterThan(0);
    expect(get(build.mask, centerX, roofY)).toBe(AIR);
    const after = paintRecords(build);
    expect(after.some((rect) => centerX >= rect.x && centerX < rect.x + rect.w && roofY >= rect.y && roofY < rect.y + rect.h)).toBe(false);
  });
});
