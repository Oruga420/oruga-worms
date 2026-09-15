import { describe, expect, it } from 'vitest';
import {
  AIR,
  BEDROCK,
  BORDER_BEDROCK_PX,
  SOLID,
  cloneMask,
  countSolid,
  countValue,
  createMask,
  get,
  inBounds,
  index,
  isSolid,
  markBorderBedrock,
  set,
  setSpan,
} from '@/terrain/mask.ts';

describe('terrain mask: creation and indexing', () => {
  it('creates a width x height byte mask filled with the given value', () => {
    const mask = createMask(10, 8);
    expect(mask.width).toBe(10);
    expect(mask.height).toBe(8);
    expect(mask.data).toBeInstanceOf(Uint8Array);
    expect(mask.data.length).toBe(80);
    expect(mask.data.every((v) => v === AIR)).toBe(true);
    expect(mask.hasBedrock).toBe(false);

    const solid = createMask(4, 4, SOLID);
    expect(countSolid(solid)).toBe(16);
    expect(createMask(3, 3, BEDROCK).hasBedrock).toBe(true);
  });

  it('rejects non positive or non integer dimensions', () => {
    expect(() => createMask(0, 10)).toThrow(RangeError);
    expect(() => createMask(10, -1)).toThrow(RangeError);
    expect(() => createMask(2.5, 10)).toThrow(RangeError);
    expect(() => createMask(Number.NaN, 10)).toThrow(RangeError);
  });

  it('indexes row major', () => {
    const mask = createMask(10, 8);
    expect(index(mask, 0, 0)).toBe(0);
    expect(index(mask, 3, 2)).toBe(23);
    expect(index(mask, 9, 7)).toBe(79);
  });

  it('reports bounds', () => {
    const mask = createMask(10, 8);
    expect(inBounds(mask, 0, 0)).toBe(true);
    expect(inBounds(mask, 9, 7)).toBe(true);
    expect(inBounds(mask, 10, 0)).toBe(false);
    expect(inBounds(mask, 0, 8)).toBe(false);
    expect(inBounds(mask, -1, 0)).toBe(false);
  });
});

describe('terrain mask: reads and writes', () => {
  it('get returns AIR outside the mask and set refuses to write there', () => {
    const mask = createMask(5, 5, SOLID);
    expect(get(mask, -1, 0)).toBe(AIR);
    expect(get(mask, 5, 0)).toBe(AIR);
    expect(get(mask, 0, 5)).toBe(AIR);
    expect(set(mask, 5, 5, AIR)).toBe(false);
    expect(countSolid(mask)).toBe(25);
  });

  it('writes and reads single pixels', () => {
    const mask = createMask(5, 5);
    expect(set(mask, 2, 3, SOLID)).toBe(true);
    expect(get(mask, 2, 3)).toBe(SOLID);
    expect(mask.data[index(mask, 2, 3)]).toBe(SOLID);
    expect(get(mask, 3, 2)).toBe(AIR);
  });

  it('isSolid treats SOLID and BEDROCK as solid and the outside as air', () => {
    const mask = createMask(5, 5);
    set(mask, 1, 1, SOLID);
    set(mask, 2, 2, BEDROCK);
    expect(isSolid(mask, 1, 1)).toBe(true);
    expect(isSolid(mask, 2, 2)).toBe(true);
    expect(isSolid(mask, 3, 3)).toBe(false);
    expect(isSolid(mask, -1, 1)).toBe(false);
    expect(isSolid(mask, 1, 5)).toBe(false);
  });

  it('flags hasBedrock once bedrock is written and keeps it conservatively', () => {
    const mask = createMask(5, 5);
    set(mask, 1, 1, SOLID);
    expect(mask.hasBedrock).toBe(false);
    set(mask, 1, 1, BEDROCK);
    expect(mask.hasBedrock).toBe(true);
    set(mask, 1, 1, AIR);
    expect(mask.hasBedrock).toBe(true);
  });

  it('setSpan writes an inclusive span, clamps it to the row and returns what it wrote', () => {
    const mask = createMask(10, 3);
    expect(setSpan(mask, 1, 2, 5, SOLID)).toEqual({ y: 1, x0: 2, x1: 5 });
    expect(countSolid(mask)).toBe(4);
    expect(get(mask, 1, 1)).toBe(AIR);
    expect(get(mask, 6, 1)).toBe(AIR);

    expect(setSpan(mask, 0, -5, 3, SOLID)).toEqual({ y: 0, x0: 0, x1: 3 });
    expect(setSpan(mask, 2, 8, 20, BEDROCK)).toEqual({ y: 2, x0: 8, x1: 9 });
    expect(mask.hasBedrock).toBe(true);
    expect(countValue(mask, BEDROCK)).toBe(2);
  });

  it('setSpan returns null for rows outside the mask, reversed or fully outside spans', () => {
    const mask = createMask(10, 3);
    expect(setSpan(mask, -1, 0, 5, SOLID)).toBeNull();
    expect(setSpan(mask, 3, 0, 5, SOLID)).toBeNull();
    expect(setSpan(mask, 1, 5, 2, SOLID)).toBeNull();
    expect(setSpan(mask, 1, 20, 30, SOLID)).toBeNull();
    expect(setSpan(mask, 1, -30, -20, SOLID)).toBeNull();
    expect(countSolid(mask)).toBe(0);
  });
});

describe('terrain mask: counting, cloning and the bedrock border', () => {
  it('countSolid counts SOLID plus BEDROCK, countValue counts one value', () => {
    const mask = createMask(4, 4);
    setSpan(mask, 0, 0, 3, SOLID);
    setSpan(mask, 1, 0, 1, BEDROCK);
    expect(countSolid(mask)).toBe(6);
    expect(countValue(mask, SOLID)).toBe(4);
    expect(countValue(mask, BEDROCK)).toBe(2);
    expect(countValue(mask, AIR)).toBe(10);
  });

  it('cloneMask copies the bytes and the flag into an independent buffer', () => {
    const mask = createMask(6, 6);
    setSpan(mask, 2, 1, 4, SOLID);
    set(mask, 0, 0, BEDROCK);
    const copy = cloneMask(mask);
    expect(copy.width).toBe(6);
    expect(copy.height).toBe(6);
    expect(copy.hasBedrock).toBe(true);
    expect(Array.from(copy.data)).toEqual(Array.from(mask.data));
    set(copy, 1, 2, AIR);
    expect(get(mask, 1, 2)).toBe(SOLID);
    expect(get(copy, 1, 2)).toBe(AIR);
  });

  it('markBorderBedrock turns the outer 2 px ring into BEDROCK and leaves the interior alone', () => {
    expect(BORDER_BEDROCK_PX).toBe(2);
    const mask = createMask(10, 8, SOLID);
    set(mask, 5, 4, AIR);
    markBorderBedrock(mask);
    expect(mask.hasBedrock).toBe(true);
    // 2 rows top and bottom (2 x 10 each) plus the 4 middle rows contribute 4 px each.
    expect(countValue(mask, BEDROCK)).toBe(20 + 20 + 4 * 4);
    expect(get(mask, 0, 0)).toBe(BEDROCK);
    expect(get(mask, 1, 7)).toBe(BEDROCK);
    expect(get(mask, 9, 3)).toBe(BEDROCK);
    expect(get(mask, 2, 2)).toBe(SOLID);
    expect(get(mask, 5, 4)).toBe(AIR);
  });

  it('markBorderBedrock accepts a custom thickness and never exceeds the mask', () => {
    const mask = createMask(3, 3);
    markBorderBedrock(mask, 5);
    expect(countValue(mask, BEDROCK)).toBe(9);
    const thin = createMask(6, 6);
    markBorderBedrock(thin, 1);
    expect(countValue(thin, BEDROCK)).toBe(20);
  });
});
