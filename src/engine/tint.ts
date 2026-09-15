/**
 * Team tint (ultraplan design rule: "team tint by hue shift on the key green bandana mask, not a
 * source-atop fill"). The worm sheet is authored once with a saturated green bandana (hue 120).
 * At load, every pixel inside the hue window with enough saturation and value is rotated to the
 * team hue while keeping its saturation and value, so shading survives; skin, eyes and outlines
 * are untouched because they fall outside the window.
 *
 * getImageData NOTE: bakeTintedImage is the ONE place in the engine allowed to read pixels back
 * from a canvas. It runs once per team at load time on an offscreen canvas (about 10 ms for the
 * whole sheet). It must never be called during play: a readback stalls the GPU pipeline and
 * would destroy frame time (architecture.md, the load bearing rule).
 */

import { err, ok, type Result } from '../core/result.ts';
import type { ImageSource, ReadbackCtx2D, Size } from './canvas-types.ts';

export interface Hsv {
  /** Degrees in [0, 360). */
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface TintKey {
  /** Hue of the authored key color. */
  readonly hue: number;
  /** Half width of the hue window in degrees. */
  readonly hueWindow: number;
  readonly minSaturation: number;
  readonly minValue: number;
}

export const BANDANA_KEY: TintKey = Object.freeze({ hue: 120, hueWindow: 35, minSaturation: 0.35, minValue: 0.2 });

/** Team hues in degrees; green keeps the authored bandana untouched. */
export const TEAM_HUES = Object.freeze({
  red: 0,
  orange: 30,
  yellow: 52,
  green: 120,
  blue: 215,
  purple: 280,
} as const);

export type TeamColor = keyof typeof TEAM_HUES;

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return Object.freeze({ h, s: max === 0 ? 0 : delta / max, v: max });
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = v - c;
  const sector = Math.floor(hue) % 6;
  const table: readonly (readonly [number, number, number])[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sector] ?? [0, 0, 0];
  return Object.freeze({ r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) });
}

/** Shortest distance between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function isKeyPixel(r: number, g: number, b: number, a: number, key: TintKey = BANDANA_KEY): boolean {
  if (a === 0) return false;
  const hsv = rgbToHsv(r, g, b);
  return hsv.s >= key.minSaturation && hsv.v >= key.minValue && hueDistance(hsv.h, key.hue) <= key.hueWindow;
}

/** Rotates the hue of one color by the offset from the key hue to the team hue. */
export function shiftHue(r: number, g: number, b: number, teamHue: number, key: TintKey = BANDANA_KEY): Rgb {
  const hsv = rgbToHsv(r, g, b);
  return hsvToRgb(hsv.h + (teamHue - key.hue), hsv.s, hsv.v);
}

/** Returns a NEW pixel buffer with key pixels rotated to the team hue; the input is untouched. */
export function tintPixels(data: Uint8ClampedArray, teamHue: number, key: TintKey = BANDANA_KEY): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  if (hueDistance(teamHue, key.hue) === 0) return out;
  for (let i = 0; i + 3 < out.length; i += 4) {
    const r = out[i] ?? 0;
    const g = out[i + 1] ?? 0;
    const b = out[i + 2] ?? 0;
    const a = out[i + 3] ?? 0;
    if (!isKeyPixel(r, g, b, a, key)) continue;
    const shifted = shiftHue(r, g, b, teamHue, key);
    out[i] = shifted.r;
    out[i + 1] = shifted.g;
    out[i + 2] = shifted.b;
  }
  return out;
}

export function countKeyPixels(data: Uint8ClampedArray, key: TintKey = BANDANA_KEY): number {
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (isKeyPixel(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0, key)) count += 1;
  }
  return count;
}

export interface Offscreen {
  readonly canvas: ImageSource;
  readonly ctx: ReadbackCtx2D;
}

/** Creates an offscreen canvas of this size; null when the platform cannot. */
export type OffscreenFactory = (size: Size) => Offscreen | null;

export interface TintError {
  readonly code: 'no_offscreen' | 'readback_failed';
  readonly message: string;
}

/**
 * Bakes one tinted copy of a sheet at LOAD TIME. This is the only getImageData in the engine;
 * see the file comment. Never call it from a tick or a render.
 */
export function bakeTintedImage(
  image: ImageSource,
  size: Size,
  teamHue: number,
  createOffscreen: OffscreenFactory,
  key: TintKey = BANDANA_KEY,
): Result<ImageSource, TintError> {
  const offscreen = createOffscreen(size);
  if (offscreen === null) return err(Object.freeze({ code: 'no_offscreen' as const, message: 'offscreen canvas unavailable' }));
  const { ctx, canvas } = offscreen;
  try {
    ctx.drawImage(image, 0, 0, size.w, size.h, 0, 0, size.w, size.h);
    const pixels = ctx.getImageData(0, 0, size.w, size.h);
    const tinted = tintPixels(pixels.data, teamHue, key);
    pixels.data.set(tinted);
    ctx.putImageData(pixels, 0, 0);
    return ok(canvas);
  } catch (thrown: unknown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return err(Object.freeze({ code: 'readback_failed' as const, message }));
  }
}
