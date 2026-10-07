/**
 * Kame House: a small flat island of sand in a tropical sea, Master Roshi's pink house on it with
 * its red domed roof and the sign on top, palm trees either side (props), and two rocks off shore
 * for whoever is knocked off. The house is hollow inside, so a bazooka opens it. The island's sand
 * is shaped by the seed a little, the house never moves.
 */

import { mixSeed } from '../../core/rng.ts';
import { BORDER_BEDROCK_PX, createMask, markBorderBedrock, AIR } from '../mask.ts';
import { fbm1D } from '../noise.ts';
import type { ScenarioBuild, ScenarioBuildOptions, SceneryProp } from '../scenarios.ts';
import { fillSpans } from '../tiles.ts';
import { fillEllipse, fillRect, rectSpans, solidSpansIn } from './shapes.ts';

export const HOUSE_PINK = '#f2a7c8';
export const HOUSE_PINK_DARK = '#d9879f';
export const ROOF_RED = '#c8352e';
export const ROOF_RED_DARK = '#9e2a24';
export const DOOR = '#4a2a1a';
export const WINDOW = '#8fd7ff';
export const SIGN_TEXT = 'KAME HOUSE';

export function buildKameHouse(options: ScenarioBuildOptions): ScenarioBuild {
  const { width, height, seed, waterY } = options;
  const mask = createMask(width, height);
  const cx = width * 0.5;
  const beach = Math.round(height * 0.805);
  const half = Math.round(width * 0.19);
  const bumps = mixSeed(seed, 7);

  // The island: a flat sandy top with rounded ends, dipping toward the water; a little bumpy by the seed.
  fillEllipse(mask, cx, waterY, half + 80, waterY - beach + 30, undefined, beach);
  for (let x = Math.round(cx - half); x <= cx + half; x += 1) {
    const bump = Math.round((fbm1D(x / 160, bumps, { octaves: 2 }) - 0.5) * 8);
    fillRect(mask, x, beach - 2 + bump, x, height - 1);
  }
  // Two rocks off shore.
  fillEllipse(mask, width * 0.09, waterY + 4, 90, 42);
  fillEllipse(mask, width * 0.91, waterY + 4, 76, 36);

  // The house: a hollow box with a domed roof, standing on the sand right of the middle.
  const houseX0 = Math.round(cx + 80);
  const houseX1 = houseX0 + 160;
  const floor = beach - 2;
  const houseTop = floor - 90;
  const roofTop = houseTop - 34;
  fillRect(mask, houseX0, houseTop, houseX1, floor + 10);
  fillEllipse(mask, (houseX0 + houseX1) / 2, houseTop, 92, 34, undefined, roofTop, houseTop);
  fillRect(mask, houseX0 + 16, houseTop + 16, houseX1 - 16, floor - 12, AIR);
  markBorderBedrock(mask, BORDER_BEDROCK_PX);

  const props: SceneryProp[] = [
    { kind: 'palm', x: Math.round(cx - half + 70), y: beach - 1, h: 86, seed: 1 },
    { kind: 'palm', x: Math.round(cx - 40), y: beach - 1, h: 74, seed: 2 },
    { kind: 'palm', x: Math.round(cx + half - 60), y: beach - 1, h: 92, seed: 3 },
    { kind: 'sign', x: (houseX0 + houseX1) / 2, y: roofTop - 8, w: 96, h: 18, text: SIGN_TEXT, color: ROOF_RED },
  ];

  const paint = (tiles: Parameters<ScenarioBuild['paint']>[0]): void => {
    // Pink walls, a darker course along the bottom, the red dome, the door and two windows.
    fillSpans(tiles, solidSpansIn(mask, houseX0, houseTop, houseX1, floor + 10), HOUSE_PINK);
    fillSpans(tiles, solidSpansIn(mask, houseX0, floor - 10, houseX1, floor + 10), HOUSE_PINK_DARK);
    fillSpans(tiles, solidSpansIn(mask, houseX0 - 2, roofTop, houseX1 + 2, houseTop - 1), ROOF_RED);
    fillSpans(tiles, solidSpansIn(mask, houseX0 - 2, houseTop - 6, houseX1 + 2, houseTop - 1), ROOF_RED_DARK);
    fillSpans(tiles, rectSpans(houseX0 + 64, floor - 44, houseX0 + 96, floor - 11), DOOR);
    fillSpans(tiles, rectSpans(houseX0 + 24, houseTop + 26, houseX0 + 48, houseTop + 48), WINDOW);
    fillSpans(tiles, rectSpans(houseX1 - 48, houseTop + 26, houseX1 - 24, houseTop + 48), WINDOW);
  };

  return { mask, props, paint };
}
