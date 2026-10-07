/**
 * The spaceship: a long hull adrift mid screen over the void, the worms fighting on its deck. A
 * pointed nose on the right, the engines on the left with three nozzles that burn (props), a
 * bridge of two storeys with a mast and a dish, a fin on top and one below, two hatches sunk into
 * the deck, and a cargo pod hung under the hull on struts. Portholes and a red stripe are painted
 * along the side. Whatever falls off the ship is lost in the void below, which is the water.
 */

import { BORDER_BEDROCK_PX, createMask, markBorderBedrock } from '../mask.ts';
import type { ScenarioBuild, ScenarioBuildOptions, SceneryProp } from '../scenarios.ts';
import { fillSpans } from '../tiles.ts';
import { discSpans, fillPolygon, fillRect, fillSuperellipse, rectSpans } from './shapes.ts';

export const PORTHOLE = '#2f4e7a';
export const PORTHOLE_LIGHT = '#8fd0ff';
export const HULL_STRIPE = '#c8463f';

export function buildSpaceship(options: ScenarioBuildOptions): ScenarioBuild {
  const { width, height } = options;
  const mask = createMask(width, height);
  const cx = width * 0.5;
  const cy = Math.round(height * 0.52);
  const rx = Math.round(width * 0.365);
  const ry = Math.round(height * 0.12);
  const deck = cy - ry;
  const keel = cy + ry;
  const rear = Math.round(cx - rx);
  const front = Math.round(cx + rx);

  // The hull, boxy with rounded ends, and the nose cone off its front.
  fillSuperellipse(mask, cx, cy, rx, ry, 2.6);
  fillPolygon(mask, [{ x: front - 30, y: cy - ry * 0.75 }, { x: front + width * 0.1, y: cy }, { x: front - 30, y: cy + ry * 0.75 }]);
  // The engines: a block at the rear with three nozzles sticking out behind.
  fillRect(mask, rear - 10, cy - ry * 0.7, rear + 120, cy + ry * 0.7);
  const nozzleYs = [cy - ry * 0.45, cy, cy + ry * 0.45].map(Math.round);
  for (const ny of nozzleYs) fillRect(mask, rear - 60, ny - 14, rear - 8, ny + 14);
  // The bridge: two storeys on the deck toward the front, a mast on top.
  const bridgeX = Math.round(cx + rx * 0.3);
  fillRect(mask, bridgeX, deck - 64, bridgeX + 180, deck + 8);
  fillRect(mask, bridgeX + 40, deck - 104, bridgeX + 140, deck - 64);
  fillRect(mask, bridgeX + 88, deck - 160, bridgeX + 92, deck - 104);
  // Fins: a tall one on top near the rear, a shorter one under the keel.
  const finX = Math.round(cx - rx * 0.72);
  fillPolygon(mask, [{ x: finX, y: deck + 2 }, { x: finX + 50, y: deck - 130 }, { x: finX + 140, y: deck + 2 }]);
  fillPolygon(mask, [{ x: finX + 60, y: keel - 2 }, { x: finX + 100, y: keel + 90 }, { x: finX + 180, y: keel - 2 }]);
  // Two hatches sunk into the deck, so it is not one flat plate.
  fillRect(mask, Math.round(cx - rx * 0.4), deck - 1, Math.round(cx - rx * 0.4) + 80, deck + 30, 0);
  fillRect(mask, Math.round(cx + rx * 0.02), deck - 1, Math.round(cx + rx * 0.02) + 80, deck + 30, 0);
  // The cargo pod under the hull, on two struts.
  const podX0 = Math.round(cx - rx * 0.28);
  const podX1 = Math.round(cx + rx * 0.2);
  fillRect(mask, podX0 + 90, keel - 4, podX0 + 98, keel + 34);
  fillRect(mask, podX1 - 98, keel - 4, podX1 - 90, keel + 34);
  fillRect(mask, podX0, keel + 34, podX1, keel + 60);
  markBorderBedrock(mask, BORDER_BEDROCK_PX);

  const props: SceneryProp[] = [
    ...nozzleYs.map((ny): SceneryProp => ({ kind: 'engine', x: rear - 60, y: ny, w: 90, h: 24, seed: ny })),
    { kind: 'beacon', x: bridgeX + 90, y: deck - 164, color: '#ff3b3b' },
    { kind: 'dish', x: bridgeX + 160, y: deck - 66, w: 26 },
    { kind: 'beacon', x: front + width * 0.1 - 6, y: cy, color: '#7fd1ff' },
  ];

  const paint = (tiles: Parameters<ScenarioBuild['paint']>[0]): void => {
    // A red stripe along the side, and a row of portholes over it.
    fillSpans(tiles, rectSpans(rear + 130, cy + 12, front - 40, cy + 22), HULL_STRIPE);
    for (let x = rear + 160; x < front - 60; x += 64) {
      fillSpans(tiles, discSpans(x, cy - 14, 9), PORTHOLE);
      fillSpans(tiles, discSpans(x - 2, cy - 16, 4), PORTHOLE_LIGHT);
    }
    // Lit windows on the bridge.
    for (let x = bridgeX + 14; x < bridgeX + 170; x += 28) fillSpans(tiles, rectSpans(x, deck - 52, x + 14, deck - 36), PORTHOLE_LIGHT);
    for (let x = bridgeX + 52; x < bridgeX + 130; x += 28) fillSpans(tiles, rectSpans(x, deck - 94, x + 14, deck - 80), PORTHOLE_LIGHT);
  };

  return { mask, props, paint };
}
