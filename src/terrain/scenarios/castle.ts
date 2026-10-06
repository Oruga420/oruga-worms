/**
 * The castle: a hill from the island generator, gentler than the island's and with no caves, and
 * on it a keep between two towers, joined by walls, every top crowned with battlements. The stone
 * is painted grey over the hill's green, with mortar lines, arrow slits and a gate. Flags fly from
 * the towers and the keep (props). The sky is dusk with the moon up.
 */

import { buildMask, resolveGenerateOptions, surfaceProfile } from '../generate.ts';
import { AIR } from '../mask.ts';
import { topmostSolid } from '../queries.ts';
import type { ScenarioBuild, ScenarioBuildOptions, SceneryProp } from '../scenarios.ts';
import { fillSpans } from '../tiles.ts';
import { fillMerlons, fillRect, rectSpans, solidSpansIn, topEdgeSpansIn } from './shapes.ts';

export const STONE = '#8d8f98';
export const STONE_LIGHT = '#b6b9c3';
export const MORTAR = '#6c6e76';
export const SLIT = '#1a1726';
export const GATE = '#2a1d18';

export function buildCastle(options: ScenarioBuildOptions): ScenarioBuild {
  const { width, height, seed, waterY } = options;
  const resolved = resolveGenerateOptions({
    width,
    height,
    seed,
    waterY,
    surface: { level: 0.62, amplitude: 0.045, wavelength: 520, octaves: 3 },
    caves: { threshold: 0 },
    islandFalloff: 0.12,
  });
  const mask = buildMask(resolved, surfaceProfile(resolved));

  // The castle stands on the hill's crown: its base is the highest ground across its footprint, sunk into the hill.
  const cx = Math.round(width * 0.5);
  const footLeft = cx - 360;
  const footRight = cx + 360;
  let base = height;
  for (let x = footLeft; x <= footRight; x += 1) {
    const top = topmostSolid(mask, x, 3);
    if (top >= 0 && top < base) base = top;
  }
  base = Math.max(base, Math.round(height * 0.5));
  const sink = base + 60;

  // The keep in the middle, the towers at the ends, the walls between.
  const keep = { x0: cx - 100, x1: cx + 100, top: base - 230 };
  const towerL = { x0: footLeft, x1: footLeft + 100, top: base - 300 };
  const towerR = { x0: footRight - 100, x1: footRight, top: base - 300 };
  const wallTop = base - 130;
  fillRect(mask, keep.x0, keep.top, keep.x1, sink);
  fillRect(mask, towerL.x0, towerL.top, towerL.x1, sink);
  fillRect(mask, towerR.x0, towerR.top, towerR.x1, sink);
  fillRect(mask, towerL.x1, wallTop, keep.x0, sink);
  fillRect(mask, keep.x1, wallTop, towerR.x0, sink);
  // Battlements on every top, their gaps wide enough for a worm to stand in (spawn.ts wants a flat footprint).
  fillMerlons(mask, keep.x0, keep.x1, keep.top, 14, 14, 26);
  fillMerlons(mask, towerL.x0, towerL.x1, towerL.top, 12, 12, 24);
  fillMerlons(mask, towerR.x0, towerR.x1, towerR.top, 12, 12, 24);
  fillMerlons(mask, towerL.x1 + 8, keep.x0 - 8, wallTop, 10, 10, 22);
  fillMerlons(mask, keep.x1 + 8, towerR.x0 - 8, wallTop, 10, 10, 22);
  // The gatehouse: a hall sealed inside the keep's foot, which a bazooka opens; its arch is painted below.
  fillRect(mask, cx - 22, base - 64, cx + 22, base - 1, AIR);

  const props: SceneryProp[] = [
    { kind: 'flag', x: towerL.x0 + 50, y: towerL.top - 12, h: 46, color: '#d23b3b' },
    { kind: 'flag', x: cx, y: keep.top - 14, h: 56, color: '#f2c14e' },
    { kind: 'flag', x: towerR.x0 + 50, y: towerR.top - 12, h: 46, color: '#d23b3b' },
  ];

  const paint = (tiles: Parameters<ScenarioBuild['paint']>[0]): void => {
    const x0 = footLeft - 2;
    const x1 = footRight + 2;
    // Stone over the hill's green for everything above the base, lit along its top edges.
    fillSpans(tiles, solidSpansIn(mask, x0, towerL.top - 20, x1, base - 1), STONE);
    fillSpans(tiles, topEdgeSpansIn(mask, x0, towerL.top - 20, x1, base - 1, 3), STONE_LIGHT);
    // Mortar lines every so many rows.
    for (let y = towerL.top; y < base; y += 22) fillSpans(tiles, solidSpansIn(mask, x0, y, x1, y), MORTAR);
    // Arrow slits on the towers and the keep, and the gate's dark arch.
    for (const tower of [towerL, towerR]) {
      for (let y = tower.top + 50; y < base - 40; y += 70) fillSpans(tiles, rectSpans(tower.x0 + 46, y, tower.x0 + 53, y + 26), SLIT);
    }
    for (let y = keep.top + 50; y < base - 100; y += 60) {
      fillSpans(tiles, rectSpans(keep.x0 + 40, y, keep.x0 + 47, y + 24), SLIT);
      fillSpans(tiles, rectSpans(keep.x1 - 47, y, keep.x1 - 40, y + 24), SLIT);
    }
    fillSpans(tiles, rectSpans(cx - 30, base - 70, cx + 30, base - 65), GATE);
  };

  return { mask, props, paint };
}
