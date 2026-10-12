/**
 * Kame House, with a pitched red roof and pink gable rather than a dome.
 * Proportions adapt the viewed anime/product references to a side-on game, not
 * measured architecture. All facade details are solid-clipped terrain spans;
 * lettering and windows disappear with the terrain, never floating over a crater.
 */
import { mixSeed } from '../../core/rng.ts';
import { BORDER_BEDROCK_PX, createMask, markBorderBedrock, AIR, type TerrainMask } from '../mask.ts';
import { fbm1D } from '../noise.ts';
import type { ScenarioBuild, ScenarioBuildOptions, SceneryProp } from '../scenarios.ts';
import { fillSpans, paintRaster, type TerrainTiles } from '../tiles.ts';
import { fitRaster, stampRaster } from '../raster.ts';
import { fillEllipse, fillPolygon, fillRect, solidSpansIn, topEdgeSpansIn } from './shapes.ts';

export const HOUSE_PINK = '#f2a7c8';
export const HOUSE_PINK_DARK = '#d9879f';
export const ROOF_RED = '#c8352e';
export const ROOF_RED_DARK = '#9e2a24';
export const DOOR = '#376d70';
export const WINDOW = '#8fd7ff';
export const SIGN_TEXT = 'KAME HOUSE';
const HOUSE_INK = '#593642';
const TRIM = '#fff0dc';
const ROOF_HEIGHT = 60;

/** Tiny facade letters are paint only: glyph counters never cut holes in the mask. */
const LETTERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  K: ['101', '110', '100', '110', '101'],
  A: ['010', '101', '111', '101', '101'],
  M: ['101', '111', '111', '101', '101'],
  E: ['111', '100', '110', '100', '111'],
  H: ['101', '101', '111', '101', '101'],
  O: ['111', '101', '101', '101', '111'],
  U: ['101', '101', '101', '101', '111'],
  S: ['111', '100', '111', '001', '111'],
});
type PaintRect = (x0: number, y0: number, x1: number, y1: number, color: string) => void;

function lettering(paint: PaintRect, text: string, center: number, top: number): void {
  const start = center - (text.length * 8 - 2) / 2;
  [...text].forEach((letter, index) => {
    LETTERS[letter]?.forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        if (pixel === '1') paint(start + index * 8 + x * 2, top + y * 2, start + index * 8 + x * 2 + 1, top + y * 2 + 1, ROOF_RED_DARK);
      });
    });
  });
}

function paintHouse(tiles: TerrainTiles, mask: TerrainMask, x0: number, x1: number, top: number, floor: number): void {
  const apex = top - ROOF_HEIGHT;
  const paint: PaintRect = (left, y0, right, y1, color) => {
    fillSpans(tiles, solidSpansIn(mask, left, y0, right, y1), color);
  };
  paint(x0 - 8, apex, x1 + 10, floor + 10, HOUSE_PINK);
  paint(x0, floor - 10, x1 + 10, floor + 10, HOUSE_PINK_DARK);
  for (let y = apex + 6; y < floor; y += 7) paint(x0 - 8, y, x1 + 10, y, HOUSE_PINK_DARK);
  paint(x0, top, x0 + 2, floor, HOUSE_INK);
  paint(x1 - 2, top, x1, floor, HOUSE_INK);
  fillSpans(tiles, topEdgeSpansIn(mask, x0 - 8, apex, x1 + 8, top, 5), ROOF_RED);
  fillSpans(tiles, topEdgeSpansIn(mask, x0 - 8, apex, x1 + 8, top, 1), TRIM);
  paint(x0 - 8, top - 2, x1 + 8, top, ROOF_RED_DARK);
  // A left window and right door fit within solid jambs, never over room air.
  paint(x0 + 5, top + 25, x0 + 25, top + 51, TRIM);
  paint(x0 + 8, top + 28, x0 + 22, top + 48, WINDOW);
  paint(x0 + 14, top + 28, x0 + 15, top + 48, TRIM);
  paint(x0 + 8, top + 37, x0 + 22, top + 38, TRIM);
  paint(x1 - 26, floor - 52, x1 - 4, floor - 11, TRIM);
  paint(x1 - 23, floor - 49, x1 - 7, floor - 11, DOOR);
  paint(x1 - 11, floor - 29, x1 - 10, floor - 27, '#f7d586');
  paint(x1 - 40, top + 14, x1 + 10, top + 17, ROOF_RED);
  paint(x1 - 40, top + 18, x1 + 10, top + 19, HOUSE_INK);
  paint(x1 + 6, top + 20, x1 + 9, floor, TRIM);
  lettering(paint, 'KAME', (x0 + x1) / 2, apex + 22);
  lettering(paint, 'HOUSE', (x0 + x1) / 2, apex + 36);
}

function palmProps(cx: number, half: number, beach: number): readonly SceneryProp[] {
  return [
    { kind: 'palm', x: Math.round(cx - half + 70), y: beach - 1, h: 86, seed: 1 },
    { kind: 'palm', x: Math.round(cx - 40), y: beach - 1, h: 74, seed: 2 },
    { kind: 'palm', x: Math.round(cx + half - 60), y: beach - 1, h: 92, seed: 3 },
  ];
}

export function buildKameHouse(options: ScenarioBuildOptions): ScenarioBuild {
  const { width, height, seed, waterY } = options;
  const mask = createMask(width, height);
  const cx = width * 0.5;
  const beach = Math.round(height * 0.805);
  const half = Math.round(width * 0.19);
  const bumps = mixSeed(seed, 7);
  fillEllipse(mask, cx, waterY, half + 80, waterY - beach + 30, undefined, beach);
  for (let x = Math.round(cx - half); x <= cx + half; x += 1) {
    const bump = Math.round((fbm1D(x / 160, bumps, { octaves: 2 }) - 0.5) * 8);
    fillRect(mask, x, beach - 2 + bump, x, height - 1);
  }
  fillEllipse(mask, width * 0.09, waterY + 4, 90, 42);
  fillEllipse(mask, width * 0.91, waterY + 4, 76, 36);
  if (options.raster !== undefined) {
    const raster = options.raster;
    const rect = fitRaster(raster, { x: cx + 50, y: beach - 202, w: 220, h: 210 });
    stampRaster(mask, raster, rect);
    markBorderBedrock(mask, BORDER_BEDROCK_PX);
    return { mask, props: palmProps(cx, half, beach), rasterized: true, paint: (tiles) => { paintRaster(tiles, raster, rect); } };
  }
  const x0 = Math.round(cx + 80);
  const x1 = x0 + 160;
  const floor = beach - 2;
  const top = floor - 90;
  fillRect(mask, x0, top, x1, floor + 10);
  fillPolygon(mask, [{ x: x0 - 8, y: top + 1 }, { x: (x0 + x1) / 2, y: top - ROOF_HEIGHT }, { x: x1 + 8, y: top + 1 }]);
  fillRect(mask, x0 + 28, top + 16, x1 - 28, floor - 12, AIR);
  fillRect(mask, x1 - 40, top + 14, x1 + 10, top + 19);
  fillRect(mask, x1 + 6, top + 20, x1 + 9, floor);
  markBorderBedrock(mask, BORDER_BEDROCK_PX);
  return { mask, props: palmProps(cx, half, beach), paint: (tiles) => paintHouse(tiles, mask, x0, x1, top, floor) };
}
