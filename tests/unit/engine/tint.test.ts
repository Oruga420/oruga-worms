import { describe, expect, it } from 'vitest';
import type { ImageSource, ReadbackCtx2D } from '@/engine/canvas-types.ts';
import {
  BANDANA_KEY,
  TEAM_HUES,
  bakeTintedImage,
  countKeyPixels,
  hsvToRgb,
  hueDistance,
  isKeyPixel,
  rgbToHsv,
  shiftHue,
  tintPixels,
} from '@/engine/tint.ts';

function pixels(...rgba: readonly (readonly [number, number, number, number])[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length * 4);
  rgba.forEach(([r, g, b, a], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  });
  return out;
}

/**
 * Where a fixture pixel lands after the tint: its own hue rotated by the key to team offset,
 * which is what shiftHue documents. The fixtures do not sit exactly on the 120 degree key
 * (BANDANA is at 127.5, BANDANA_SHADE at 129), so the expected hue carries that offset too.
 */
function expectedHue(rgba: readonly [number, number, number, number], teamHue: number): number {
  return rgbToHsv(rgba[0], rgba[1], rgba[2]).h + (teamHue - BANDANA_KEY.hue);
}

const BANDANA = [40, 200, 60, 255] as const;
const BANDANA_SHADE = [20, 120, 35, 255] as const;
const SKIN = [230, 180, 150, 255] as const;
const OUTLINE = [20, 20, 20, 255] as const;
const TRANSPARENT_GREEN = [40, 200, 60, 0] as const;
const GREY_GREEN = [120, 140, 120, 255] as const;

describe('tint: color math', () => {
  it('converts rgb to hsv and back', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0).h).toBe(120);
    expect(rgbToHsv(0, 0, 255).h).toBe(240);
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb(240, 1, 0.5)).toEqual({ r: 0, g: 0, b: 128 });
    expect(hsvToRgb(-120, 1, 1)).toEqual({ r: 0, g: 0, b: 255 });
    const round = hsvToRgb(rgbToHsv(...([40, 200, 60] as const)).h, rgbToHsv(40, 200, 60).s, rgbToHsv(40, 200, 60).v);
    expect(round).toEqual({ r: 40, g: 200, b: 60 });
  });

  it('measures hue distance on the circle', () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(120, 120)).toBe(0);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(-30, 30)).toBe(60);
  });
});

describe('tint: key detection', () => {
  it('keys the saturated green bandana including its shaded pixels', () => {
    expect(isKeyPixel(...BANDANA)).toBe(true);
    expect(isKeyPixel(...BANDANA_SHADE)).toBe(true);
  });

  it('leaves skin, outlines, transparent and desaturated pixels alone', () => {
    expect(isKeyPixel(...SKIN)).toBe(false);
    expect(isKeyPixel(...OUTLINE)).toBe(false);
    expect(isKeyPixel(...TRANSPARENT_GREEN)).toBe(false);
    expect(isKeyPixel(...GREY_GREEN)).toBe(false);
  });

  it('respects a custom key window', () => {
    const narrow = { ...BANDANA_KEY, hueWindow: 2 };
    expect(isKeyPixel(0, 255, 0, 255, narrow)).toBe(true);
    expect(isKeyPixel(...BANDANA, narrow)).toBe(false);
  });

  it('counts key pixels', () => {
    expect(countKeyPixels(pixels(BANDANA, SKIN, BANDANA_SHADE, OUTLINE))).toBe(2);
  });
});

describe('tint: hue shift', () => {
  it('rotates the hue by the offset to the team hue and keeps saturation and value', () => {
    const before = rgbToHsv(...([40, 200, 60] as const));
    const shifted = shiftHue(40, 200, 60, TEAM_HUES.blue);
    const after = rgbToHsv(shifted.r, shifted.g, shifted.b);
    expect(hueDistance(after.h, before.h + (TEAM_HUES.blue - 120))).toBeLessThan(1.5);
    expect(after.s).toBeCloseTo(before.s, 1);
    expect(after.v).toBeCloseTo(before.v, 1);
  });

  it('tints only key pixels and returns a new buffer', () => {
    const input = pixels(BANDANA, SKIN, BANDANA_SHADE, OUTLINE, TRANSPARENT_GREEN);
    const copy = new Uint8ClampedArray(input);
    const out = tintPixels(input, TEAM_HUES.red);
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
    expect(rgbToHsv(...([40, 200, 60] as const)).h).toBe(127.5);
    const red = rgbToHsv(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0);
    expect(hueDistance(red.h, expectedHue(BANDANA, TEAM_HUES.red))).toBeLessThan(1.5);
    expect(red.s).toBeCloseTo(rgbToHsv(...([40, 200, 60] as const)).s, 1);
    expect(red.v).toBeCloseTo(rgbToHsv(...([40, 200, 60] as const)).v, 1);
    expect(out[3]).toBe(255);
    expect([...out.slice(4, 8)]).toEqual([...SKIN]);
    const shade = rgbToHsv(out[8] ?? 0, out[9] ?? 0, out[10] ?? 0);
    expect(hueDistance(shade.h, expectedHue(BANDANA_SHADE, TEAM_HUES.red))).toBeLessThan(1.5);
    expect([...out.slice(12, 16)]).toEqual([...OUTLINE]);
    expect([...out.slice(16, 20)]).toEqual([...TRANSPARENT_GREEN]);
  });

  it('is a plain copy when the team hue is the key hue', () => {
    const input = pixels(BANDANA, SKIN);
    const out = tintPixels(input, TEAM_HUES.green);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('handles a buffer whose length is not a multiple of 4', () => {
    const odd = new Uint8ClampedArray([40, 200, 60, 255, 40, 200]);
    expect(tintPixels(odd, TEAM_HUES.blue)).toHaveLength(6);
  });
});

describe('tint: load time bake', () => {
  function fakeOffscreen(width: number, height: number, source: Uint8ClampedArray) {
    const calls: string[] = [];
    let stored: Uint8ClampedArray | null = null;
    const ctx = {
      drawImage: () => calls.push('drawImage'),
      getImageData: () => {
        calls.push('getImageData');
        return { data: new Uint8ClampedArray(source), width, height, colorSpace: 'srgb' } as ImageData;
      },
      putImageData: (imageData: ImageData) => {
        calls.push('putImageData');
        stored = imageData.data;
      },
    } as unknown as ReadbackCtx2D;
    const canvas = { width, height } as unknown as ImageSource;
    return { factory: () => ({ canvas, ctx }), canvas, calls, stored: () => stored };
  }

  it('draws, reads back once, tints and writes back', () => {
    const source = pixels(BANDANA, SKIN);
    const fake = fakeOffscreen(2, 1, source);
    const result = bakeTintedImage({} as unknown as ImageSource, { w: 2, h: 1 }, TEAM_HUES.blue, fake.factory);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(fake.canvas);
    expect(fake.calls).toEqual(['drawImage', 'getImageData', 'putImageData']);
    const stored = fake.stored();
    expect(stored).not.toBeNull();
    if (stored !== null) {
      const hsv = rgbToHsv(stored[0] ?? 0, stored[1] ?? 0, stored[2] ?? 0);
      expect(hueDistance(hsv.h, expectedHue(BANDANA, TEAM_HUES.blue))).toBeLessThan(1.5);
      expect([...stored.slice(4, 8)]).toEqual([...SKIN]);
    }
  });

  it('fails cleanly without an offscreen canvas or on a tainted readback', () => {
    const none = bakeTintedImage({} as unknown as ImageSource, { w: 1, h: 1 }, 0, () => null);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe('no_offscreen');
    const tainted = bakeTintedImage({} as unknown as ImageSource, { w: 1, h: 1 }, 0, () => ({
      canvas: {} as unknown as ImageSource,
      ctx: {
        drawImage: () => {},
        getImageData: () => {
          throw new Error('tainted canvas');
        },
      } as unknown as ReadbackCtx2D,
    }));
    expect(tainted.ok).toBe(false);
    if (!tainted.ok) expect(tainted.error).toEqual({ code: 'readback_failed', message: 'tainted canvas' });
  });
});
