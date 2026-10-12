/**
 * Distant scenery only. These low-contrast layers stay behind the destructible tiles;
 * they never load a texture, touch the terrain mask or imitate foreground platforms.
 * Canvas paths intentionally use only the small, recording-testable Ctx2D contract.
 */
import { hash01 } from '../core/rng.ts';
import type { Camera } from '../engine/camera.ts';
import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import type { SkyTheme } from '../terrain/scenarios.ts';

type Point = readonly [number, number];
const SPACE_INK = '#11172c';
const CASTLE_INK = '#29253e';
const TAU = Math.PI * 2;

function polygon(ctx: Ctx2D, points: readonly Point[], fill: string, stroke?: string): void {
  const first = points[0];
  if (first === undefined) return;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  points.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke !== undefined) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

function wrappedX(x: number, cameraX: number, depth: number, width: number): number {
  const span = width + 300;
  return ((x - cameraX * depth) % span + span) % span - 150;
}

function orbitalHaze(ctx: Ctx2D, viewport: Size, camera: Camera): void {
  // Quiet translucent ribbons, rather than a second bright foreground landscape.
  for (let layer = 0; layer < 3; layer += 1) {
    const points: Point[] = Array.from({ length: 19 }, (_, index) => {
      const x = index * viewport.w / 18;
      const y = viewport.h * (0.36 + layer * 0.07) + Math.sin((x + camera.x * 0.025) / 170 + layer) * 35;
      return [x, y];
    });
    ctx.globalAlpha = 0.055;
    polygon(ctx, [...points, ...[...points].reverse().map(([x, y]): Point => [x, y + 38])], layer % 2 === 0 ? '#8f71d9' : '#3fa8bd');
  }
}

function asteroidField(ctx: Ctx2D, viewport: Size, camera: Camera, timeMs: number): void {
  for (let layer = 0; layer < 2; layer += 1) {
    for (let i = 0; i < 9; i += 1) {
      const seed = i + layer * 19;
      const x = wrappedX(hash01(927, seed) * (viewport.w + 300) + timeMs * 0.0015, camera.x, 0.05 + layer * 0.08, viewport.w);
      const y = viewport.h * (0.27 + hash01(928, seed) * 0.48);
      const r = (5 + hash01(929, seed) * 11) * (1 + layer * 0.5);
      const turn = timeMs / (22000 + seed * 900);
      const points: Point[] = Array.from({ length: 7 }, (_, k) => {
        const angle = k / 7 * TAU + turn;
        const radius = r * (0.66 + hash01(seed + 8, k) * 0.34);
        return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.7];
      });
      ctx.globalAlpha = 0.26 + layer * 0.15;
      polygon(ctx, points, layer === 0 ? '#3c3a64' : '#444d69', SPACE_INK);
      ctx.strokeStyle = '#85a7b4';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.22);
      ctx.lineTo(x, y - r * 0.5);
      ctx.lineTo(x + r * 0.45, y - r * 0.22);
      ctx.stroke();
    }
  }
}

function orbitalRelays(ctx: Ctx2D, viewport: Size, camera: Camera): void {
  for (let i = 0; i < 3; i += 1) {
    const x = wrappedX(280 + i * 490, camera.x, 0.09, viewport.w);
    const y = viewport.h * (0.18 + i * 0.12);
    ctx.globalAlpha = 0.35;
    polygon(ctx, [[x - 26, y - 7], [x - 8, y - 4], [x - 8, y + 6], [x - 26, y + 3]], '#516084', SPACE_INK);
    polygon(ctx, [[x + 8, y - 4], [x + 26, y - 7], [x + 26, y + 3], [x + 8, y + 6]], '#516084', SPACE_INK);
    polygon(ctx, [[x, y - 9], [x + 7, y], [x, y + 10], [x - 7, y]], '#8b8697', SPACE_INK);
    ctx.fillStyle = '#94dee7';
    ctx.fillRect(x - 1, y - 2, 2, 2);
  }
}

function distantSpires(ctx: Ctx2D, viewport: Size, camera: Camera, horizonY: number): void {
  for (let i = 0; i < 7; i += 1) {
    const x = wrappedX(i * 273 + 77, camera.x, 0.18, viewport.w);
    const base = horizonY + 92;
    const h = 38 + hash01(371, i) * 52;
    const w = 10 + hash01(372, i) * 8;
    ctx.globalAlpha = 0.48;
    polygon(ctx, [[x - w, base], [x - w, base - h], [x, base - h - 24], [x + w, base - h], [x + w, base]], '#49405f');
    polygon(ctx, [[x, base - h - 24], [x + w, base - h], [x, base - h]], '#6e5978');
    ctx.fillStyle = '#dba980';
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x - 1.5, base - h + 10, 3, 7);
  }
}

function firLine(ctx: Ctx2D, viewport: Size, camera: Camera, horizonY: number): void {
  for (let layer = 0; layer < 2; layer += 1) {
    for (let i = 0; i < 18; i += 1) {
      const x = wrappedX(i * 107 + layer * 43, camera.x, 0.27 + layer * 0.12, viewport.w);
      const y = horizonY + 122 + layer * 26;
      const h = 26 + hash01(727 + layer, i) * 49;
      const w = h * 0.24;
      ctx.globalAlpha = 0.5 + layer * 0.14;
      polygon(ctx, [[x - w, y], [x - w * 0.4, y - h * 0.36], [x - w * 0.7, y - h * 0.36], [x, y - h], [x + w * 0.7, y - h * 0.36], [x + w * 0.4, y - h * 0.36], [x + w, y]], layer === 0 ? '#453951' : CASTLE_INK);
    }
  }
}

function valleyMist(ctx: Ctx2D, viewport: Size, horizonY: number, timeMs: number): void {
  ctx.globalAlpha = 0.1;
  const drift = Math.sin(timeMs / 7500) * 6;
  for (let i = 0; i < 3; i += 1) {
    const y = horizonY + 100 + i * 21 + drift;
    polygon(ctx, [[0, y], [viewport.w * 0.35, y - 12], [viewport.w, y + 3], [viewport.w, y + 14], [0, y + 7]], '#dfb8b1');
  }
}

/** Infer existing sky families; no new renderer API or terrain metadata is required. */
export function drawSceneryDepth(ctx: Ctx2D, viewport: Size, camera: Camera, sky: SkyTheme, horizonY: number, timeMs: number): void {
  const space = sky.planet !== null;
  const castle = sky.stars && sky.ridges.length > 0;
  if (!space && !castle) return;
  ctx.save();
  if (space) {
    orbitalHaze(ctx, viewport, camera);
    asteroidField(ctx, viewport, camera, timeMs);
    orbitalRelays(ctx, viewport, camera);
  } else {
    distantSpires(ctx, viewport, camera, horizonY);
    firLine(ctx, viewport, camera, horizonY);
    valleyMist(ctx, viewport, horizonY, timeMs);
  }
  ctx.restore();
}
