import { describe, expect, it } from 'vitest';
import { AIR, BEDROCK, SOLID, countValue, get } from '@/terrain/mask.ts';
import { SOLID_ALPHA_THRESHOLD, loadPngLevel } from '@/terrain/png-level.ts';
import { alphaImage, createReadbackFactory } from './fakes.ts';

const WIDTH = 12;
const HEIGHT = 10;

/** Bottom half solid, plus one pixel exactly at the threshold and one just above it. */
function levelAlpha(x: number, y: number): number {
  if (x === 4 && y === 3) return 128;
  if (x === 5 && y === 3) return 129;
  return y >= 5 ? 255 : 0;
}

describe('png-level: loadPngLevel', () => {
  it('reads the alpha channel once and marks alpha above 128 as SOLID', () => {
    expect(SOLID_ALPHA_THRESHOLD).toBe(128);
    const readback = createReadbackFactory(alphaImage(WIDTH, HEIGHT, levelAlpha));
    const image = { width: WIDTH, height: HEIGHT };

    const result = loadPngLevel(image, { width: WIDTH, height: HEIGHT }, readback.factory);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mask = result.value;
    expect(mask.width).toBe(WIDTH);
    expect(mask.height).toBe(HEIGHT);
    expect(readback.created.length).toBe(1);
    expect(readback.created[0]?.canvas).toEqual({ width: WIDTH, height: HEIGHT });
    expect(readback.created[0]?.readbacks).toBe(1);
    expect(readback.created[0]?.draws).toEqual([
      { image, sx: 0, sy: 0, sw: WIDTH, sh: HEIGHT, dx: 0, dy: 0, dw: WIDTH, dh: HEIGHT },
    ]);

    for (let y = 2; y < HEIGHT - 2; y += 1) {
      for (let x = 2; x < WIDTH - 2; x += 1) {
        const expected = x === 5 && y === 3 ? SOLID : y >= 5 ? SOLID : AIR;
        expect(get(mask, x, y)).toBe(expected);
      }
    }
    expect(get(mask, 4, 3)).toBe(AIR);
    expect(get(mask, 5, 3)).toBe(SOLID);
  });

  it('marks the outer 2 px border as bedrock', () => {
    const readback = createReadbackFactory(alphaImage(WIDTH, HEIGHT, levelAlpha));
    const result = loadPngLevel({ width: WIDTH, height: HEIGHT }, { width: WIDTH, height: HEIGHT }, readback.factory);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mask = result.value;
    expect(mask.hasBedrock).toBe(true);
    expect(countValue(mask, BEDROCK)).toBe(2 * WIDTH * 2 + (HEIGHT - 4) * 4);
    expect(get(mask, 0, 0)).toBe(BEDROCK);
    expect(get(mask, WIDTH - 1, HEIGHT - 1)).toBe(BEDROCK);
    expect(get(mask, 1, 5)).toBe(BEDROCK);
    expect(get(mask, 2, 5)).toBe(SOLID);
  });

  it('rejects an image whose size differs from the manifest entry without reading pixels', () => {
    const readback = createReadbackFactory(alphaImage(WIDTH, HEIGHT + 1, levelAlpha));
    const result = loadPngLevel({ width: WIDTH, height: HEIGHT + 1 }, { width: WIDTH, height: HEIGHT }, readback.factory);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'size_mismatch',
      message: 'level mask size mismatch',
      expected: { width: WIDTH, height: HEIGHT },
      actual: { width: WIDTH, height: HEIGHT + 1 },
    });
    expect(readback.created.length).toBe(0);
  });

  it('rejects a manifest entry with a non positive or non integer size', () => {
    const readback = createReadbackFactory(alphaImage(WIDTH, HEIGHT, levelAlpha));
    for (const expected of [
      { width: 0, height: HEIGHT },
      { width: WIDTH, height: -3 },
      { width: 2.5, height: HEIGHT },
    ]) {
      const result = loadPngLevel({ width: WIDTH, height: HEIGHT }, expected, readback.factory);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_size');
    }
    expect(readback.created.length).toBe(0);
  });

  it('turns a throwing readback (tainted canvas) into an Err instead of throwing', () => {
    const readback = createReadbackFactory(alphaImage(WIDTH, HEIGHT, levelAlpha), { throwOnRead: true });
    const result = loadPngLevel({ width: WIDTH, height: HEIGHT }, { width: WIDTH, height: HEIGHT }, readback.factory);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('readback_failed');
    expect(result.error.message).toContain('tainted');
  });

  it('rejects a readback whose buffer does not cover the image', () => {
    const readback = createReadbackFactory(alphaImage(WIDTH, HEIGHT, levelAlpha), { truncate: true });
    const result = loadPngLevel({ width: WIDTH, height: HEIGHT }, { width: WIDTH, height: HEIGHT }, readback.factory);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('readback_failed');
  });
});
