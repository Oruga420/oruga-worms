/**
 * The scenery round the land: the sky, the water and the props of the scenario in play
 * (terrain/scenarios.ts). The renderer paints the sky before the terrain tiles, and the props and
 * the water after them. The sky is screen space: a gradient, stars, the sun (or the moon, or a
 * ringed planet), clouds that drift and ridges with parallax. The props and the water are world
 * space and follow the camera like the tiles do; the props animate on the clock (engines burn,
 * flags wave, palms sway, beacons pulse) and nothing in the sim knows they are there. A terrain
 * built without a scenery (a PNG level, a test fixture) gets the island's.
 *
 * Everything here keeps to Ctx2D (engine/canvas-types.ts): no curves, clips or radial gradients,
 * so the unit tests' recording contexts run it as the browser does.
 */

import { hash01 } from '../core/rng.ts';
import { visibleRect, worldToScreen, type Camera } from '../engine/camera.ts';
import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { bareScenery, type Scenery, type SceneryProp, type SkyLight, type SkyPlanet, type SkyTheme, type WaterLook } from '../terrain/scenarios.ts';

/** What a terrain without a scenery of its own is drawn with. */
export const ISLAND_SCENERY: Scenery = bareScenery('island');

/** The scenery of a terrain, the island's when it carries none. */
export function sceneryOf(terrain: { readonly scenery?: Scenery }): Scenery {
  return terrain.scenery ?? ISLAND_SCENERY;
}

/** Builds an ellipse path centred at (cx, cy) with radii (rx, ry); leaves it current for fill or stroke. */
function ellipse(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.restore();
}

/** Cloud blobs in world x, drawn with parallax and wrapped so some are always in view. */
const CLOUDS: readonly { readonly x: number; readonly y: number; readonly s: number }[] = Object.freeze([
  { x: 120, y: 74, s: 1.0 },
  { x: 560, y: 46, s: 1.4 },
  { x: 980, y: 104, s: 0.8 },
  { x: 1420, y: 66, s: 1.2 },
  { x: 1840, y: 96, s: 0.9 },
]);

/** The two ridges behind the playfield: the far one hazier and slower, the near one lower and darker. */
const RIDGE_LAYERS: readonly { readonly lift: number; readonly parallax: number; readonly amp: number; readonly wavelength: number }[] = Object.freeze([
  { lift: 26, parallax: 0.22, amp: 58, wavelength: 260 },
  { lift: 48, parallax: 0.42, amp: 44, wavelength: 170 },
]);

const STAR_SEED = 0x57a5;
const STAR_COUNT = 110;

/** A soft light (the sun, or the moon): concentric arcs of falling alpha, since Ctx2D has no radial gradient. */
function drawSun(ctx: Ctx2D, viewport: Size, light: SkyLight): void {
  const cx = viewport.w * light.x;
  const cy = viewport.h * light.y;
  for (let i = 6; i >= 1; i -= 1) {
    ctx.globalAlpha = 0.05 + (6 - i) * 0.012;
    ctx.fillStyle = light.color;
    ctx.beginPath();
    ctx.arc(cx, cy, light.radius * (i / 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = light.color;
  ctx.beginPath();
  ctx.arc(cx, cy, light.radius * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** Stars that twinkle, fixed to the sky with the faintest parallax. */
function drawStars(ctx: Ctx2D, viewport: Size, camera: Camera, timeMs: number): void {
  const span = viewport.w + 120;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const sx = ((((hash01(STAR_SEED, i) * span - camera.x * 0.03) % span) + span) % span) - 60;
    const sy = hash01(STAR_SEED, i + STAR_COUNT) * viewport.h * 0.85;
    const size = 1 + Math.floor(hash01(STAR_SEED, i + STAR_COUNT * 2) * 2.2);
    const period = 700 + hash01(STAR_SEED, i + STAR_COUNT * 3) * 1600;
    ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(timeMs / period + i));
    ctx.fillRect(Math.round(sx), Math.round(sy), size, size);
  }
  ctx.globalAlpha = 1;
}

/** A banded planet with a tilted ring: the far half of the ring, the planet over it, the near half on top. */
function drawPlanet(ctx: Ctx2D, viewport: Size, planet: SkyPlanet): void {
  const cx = viewport.w * planet.x;
  const cy = viewport.h * planet.y;
  const r = planet.radius;
  const ring = (from: number, to: number, color: string): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.38);
    ctx.scale(1, 0.3);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.75, from, to);
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ctx.globalAlpha = 1;
  if (planet.ring !== null) ring(Math.PI, Math.PI * 2, planet.ring);
  ctx.fillStyle = planet.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Bands across the face, rows inside the disc, and the night side shading its far edge.
  ctx.fillStyle = planet.shade;
  const bands = 7;
  for (let k = 0; k < bands; k += 1) {
    const y = cy - r + (k + 0.5) * ((2 * r) / bands);
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    ctx.globalAlpha = 0.16 + 0.2 * (k % 2);
    ctx.fillRect(cx - half, y - r / 9, half * 2, r / 4.5);
  }
  ctx.globalAlpha = 0.38;
  for (let y = cy - r; y <= cy + r; y += 2) {
    const half = Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy)));
    ctx.fillRect(cx + half * 0.35, y, half * 0.65, 2);
  }
  ctx.globalAlpha = 1;
  if (planet.ring !== null) ring(0, Math.PI, planet.ring);
}

/** One rolling silhouette ridge, sampled from two sines so it does not read as a pure wave. */
function drawRidge(ctx: Ctx2D, viewport: Size, camera: Camera, baseY: number, parallax: number, amp: number, wavelength: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, viewport.h);
  for (let x = 0; x <= viewport.w; x += 8) {
    const wx = x + camera.x * parallax;
    const y = baseY - amp * (0.55 + 0.45 * Math.sin(wx / wavelength) * Math.cos(wx / (wavelength * 2.3)));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(viewport.w, viewport.h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawClouds(ctx: Ctx2D, viewport: Size, camera: Camera, timeMs: number, color: string): void {
  const span = viewport.w + 400;
  const drift = timeMs * 0.004;
  ctx.fillStyle = color;
  for (const cloud of CLOUDS) {
    let sx = ((((cloud.x + drift - camera.x * 0.14 + 200) % span) + span) % span) - 200;
    if (!Number.isFinite(sx)) continue;
    sx = Math.round(sx);
    const r = 22 * cloud.s;
    ctx.globalAlpha = 0.82;
    ellipse(ctx, sx, cloud.y, r * 1.6, r * 0.7);
    ctx.fill();
    ellipse(ctx, sx - r * 0.9, cloud.y + r * 0.22, r * 1.0, r * 0.52);
    ctx.fill();
    ellipse(ctx, sx + r * 0.95, cloud.y + r * 0.26, r * 0.9, r * 0.46);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The sky of a scenario over the whole viewport; horizonY is the screen y the ridges sit under. */
export function drawSkyTheme(ctx: Ctx2D, viewport: Size, camera: Camera, sky: SkyTheme, horizonY: number, timeMs: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, viewport.h);
  gradient.addColorStop(0, sky.gradient[0]);
  gradient.addColorStop(0.34, sky.gradient[1]);
  gradient.addColorStop(0.66, sky.gradient[2]);
  gradient.addColorStop(1, sky.gradient[3]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  if (sky.stars) drawStars(ctx, viewport, camera, timeMs);
  if (sky.planet !== null) drawPlanet(ctx, viewport, sky.planet);
  if (sky.sun !== null) drawSun(ctx, viewport, sky.sun);
  if (sky.clouds) drawClouds(ctx, viewport, camera, timeMs, sky.cloudColor);
  sky.ridges.forEach((ridge, index) => {
    const layer = RIDGE_LAYERS[index];
    if (layer !== undefined) drawRidge(ctx, viewport, camera, horizonY + layer.lift, layer.parallax, layer.amp, layer.wavelength, ridge.color, ridge.alpha);
  });
}

/** The water from its surface down, in the scenario's colours, with a foam line on the crest. */
export function drawWaterTheme(ctx: Ctx2D, viewport: Size, camera: Camera, look: WaterLook, waterY: number, timeMs: number): void {
  const surface = worldToScreen(camera, viewport, { x: camera.x, y: waterY }).y;
  if (surface > viewport.h) return;
  const wave = (x: number): number => {
    const wx = x + camera.x;
    return surface + Math.sin(wx / 44 + timeMs / 800) * 2.5 + Math.sin(wx / 19 - timeMs / 430) * 1.2;
  };

  const body = ctx.createLinearGradient(0, surface, 0, viewport.h);
  body.addColorStop(0, look.top);
  body.addColorStop(1, look.bottom);
  ctx.beginPath();
  ctx.moveTo(0, wave(0));
  for (let x = 6; x <= viewport.w; x += 6) ctx.lineTo(x, wave(x));
  ctx.lineTo(viewport.w, viewport.h);
  ctx.lineTo(0, viewport.h);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, wave(0));
  for (let x = 6; x <= viewport.w; x += 6) ctx.lineTo(x, wave(x));
  ctx.strokeStyle = look.foam;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Props within this many world px of the view are drawn: a palm's crown or an engine's flame reaches that far. */
const PROP_REACH_PX = 220;

const PALM_TRUNK = '#8a5a2b';
const PALM_TRUNK_DARK = '#5e3b18';
const PALM_LEAF = '#3f9a3a';
const PALM_LEAF_DARK = '#2c7a2a';
const COCONUT = '#5a3a1a';

/** A palm: a bent trunk that sways, fronds drooping all round its top, coconuts under them. */
function drawPalm(ctx: Ctx2D, prop: SceneryProp, timeMs: number): void {
  const h = prop.h ?? 80;
  const seed = prop.seed ?? 0;
  const lean = (hash01(seed, 1) - 0.5) * 36;
  const sway = Math.sin(timeMs / 1500 + seed) * 3;
  const segments = 8;
  const at = (k: number): { readonly x: number; readonly y: number } => {
    const t = k / segments;
    return { x: prop.x + (lean + sway) * t * t, y: prop.y - h * t };
  };
  const trunk = (): void => {
    ctx.beginPath();
    ctx.moveTo(prop.x, prop.y + 2);
    for (let k = 1; k <= segments; k += 1) ctx.lineTo(at(k).x, at(k).y);
    ctx.stroke();
  };
  ctx.strokeStyle = PALM_TRUNK_DARK;
  ctx.lineWidth = 9;
  trunk();
  ctx.strokeStyle = PALM_TRUNK;
  ctx.lineWidth = 5;
  trunk();
  ctx.fillStyle = PALM_TRUNK_DARK;
  for (let k = 1; k < segments; k += 1) ctx.fillRect(at(k).x - 4, at(k).y, 8, 1.5);

  const top = at(segments);
  const fronds = 7;
  for (let i = 0; i < fronds; i += 1) {
    const angle = -Math.PI * 0.95 + (i / (fronds - 1)) * Math.PI * 0.9 + Math.sin(timeMs / 1100 + i + seed) * 0.05;
    const len = 30 + hash01(seed, 10 + i) * 14;
    const droop = len * 0.45;
    const mid = { x: top.x + Math.cos(angle) * len * 0.55, y: top.y + Math.sin(angle) * len * 0.55 + droop * 0.25 };
    const tip = { x: top.x + Math.cos(angle) * len, y: top.y + Math.sin(angle) * len + droop };
    const px = -Math.sin(angle) * 6;
    const py = Math.cos(angle) * 6;
    ctx.fillStyle = i % 2 === 0 ? PALM_LEAF : PALM_LEAF_DARK;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(mid.x + px, mid.y + py);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(mid.x - px, mid.y - py);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = COCONUT;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(top.x - 4 + i * 4, top.y + 5 + (i % 2) * 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A flag on a pole, its cloth waving in strips that each ride the wave a little further along. */
function drawFlag(ctx: Ctx2D, prop: SceneryProp, timeMs: number): void {
  const h = prop.h ?? 46;
  const w = prop.w ?? 30;
  const cloth = Math.round(w * 0.6);
  const seed = prop.seed ?? 0;
  ctx.fillStyle = '#d9d9e0';
  ctx.fillRect(prop.x - 1, prop.y - h, 3, h);
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(prop.x + 0.5, prop.y - h - 2, 3, 0, Math.PI * 2);
  ctx.fill();
  const strips = 6;
  const stripW = w / strips;
  ctx.fillStyle = prop.color ?? '#d23b3b';
  for (let k = 0; k < strips; k += 1) {
    const x0 = prop.x + 2 + k * stripW;
    const y0 = prop.y - h + Math.sin(timeMs / 170 + k * 0.9 + seed) * 2.5 * (k / strips + 0.2);
    const y1 = prop.y - h + Math.sin(timeMs / 170 + (k + 1) * 0.9 + seed) * 2.5 * ((k + 1) / strips + 0.2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + stripW + 0.5, y1);
    ctx.lineTo(x0 + stripW + 0.5, y1 + cloth);
    ctx.lineTo(x0, y0 + cloth);
    ctx.closePath();
    ctx.fill();
  }
}

/** An engine's flame, burning to the left of the nozzle in three layers that flicker. */
function drawEngine(ctx: Ctx2D, prop: SceneryProp, timeMs: number): void {
  const w = prop.w ?? 80;
  const h = prop.h ?? 24;
  const seed = prop.seed ?? 0;
  const flicker = 0.78 + 0.22 * hash01(seed, Math.floor(timeMs / 45));
  const wobble = (hash01(seed + 1, Math.floor(timeMs / 60)) - 0.5) * h * 0.5;
  const layers = [
    { len: w * flicker, half: h / 2, color: '#ff6a1f', alpha: 0.55 },
    { len: w * 0.7 * flicker, half: h * 0.36, color: '#ffc43a', alpha: 0.8 },
    { len: w * 0.4, half: h * 0.2, color: '#ffffff', alpha: 0.95 },
  ];
  for (const layer of layers) {
    ctx.globalAlpha = layer.alpha;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(prop.x, prop.y - layer.half);
    ctx.lineTo(prop.x - layer.len, prop.y + wobble);
    ctx.lineTo(prop.x, prop.y + layer.half);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A small light that pulses, with a glow round it. */
function drawBeacon(ctx: Ctx2D, prop: SceneryProp, timeMs: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 260 + (prop.seed ?? 0));
  ctx.fillStyle = prop.color ?? '#ff3b3b';
  ctx.globalAlpha = 0.12 + 0.25 * pulse;
  ctx.beginPath();
  ctx.arc(prop.x, prop.y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.5 + 0.5 * pulse;
  ctx.beginPath();
  ctx.arc(prop.x, prop.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A dish on a mast, its bowl turned toward the sky and nodding slowly. */
function drawDish(ctx: Ctx2D, prop: SceneryProp, timeMs: number): void {
  const r = (prop.w ?? 24) / 2;
  const tilt = Math.sin(timeMs / 2600) * 0.25;
  ctx.fillStyle = '#9aa3b2';
  ctx.fillRect(prop.x - 1.5, prop.y - 16, 3, 16);
  ctx.save();
  ctx.translate(prop.x, prop.y - 16);
  ctx.rotate(-0.6 + tilt);
  ctx.fillStyle = '#dde3ec';
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#6f7786';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#6f7786';
  ctx.fillRect(-1, -r * 0.9, 2, r * 0.9);
  ctx.restore();
}

/** A board on two posts with its text across it. */
function drawSign(ctx: Ctx2D, prop: SceneryProp): void {
  const w = prop.w ?? 90;
  const h = prop.h ?? 18;
  const x0 = prop.x - w / 2;
  const y0 = prop.y - h / 2;
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(x0 + 6, prop.y, 3, 14);
  ctx.fillRect(x0 + w - 9, prop.y, 3, 14);
  ctx.fillStyle = '#fff6e5';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = prop.color ?? '#c8352e';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
  ctx.fillStyle = prop.color ?? '#c8352e';
  ctx.font = `700 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(prop.text ?? '', prop.x, prop.y + 0.5, w - 8);
}

function drawProp(ctx: Ctx2D, prop: SceneryProp, timeMs: number): void {
  switch (prop.kind) {
    case 'palm':
      drawPalm(ctx, prop, timeMs);
      return;
    case 'flag':
      drawFlag(ctx, prop, timeMs);
      return;
    case 'engine':
      drawEngine(ctx, prop, timeMs);
      return;
    case 'beacon':
      drawBeacon(ctx, prop, timeMs);
      return;
    case 'dish':
      drawDish(ctx, prop, timeMs);
      return;
    case 'sign':
      drawSign(ctx, prop);
      return;
  }
}

/** The props of a scenario in world space, through the same transform the tiles are blitted with. */
export function drawProps(ctx: Ctx2D, viewport: Size, camera: Camera, props: readonly SceneryProp[], timeMs: number): void {
  if (props.length === 0) return;
  const view = visibleRect(camera, viewport);
  const origin = worldToScreen(camera, viewport, { x: view.x, y: view.y });
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-view.x, -view.y);
  for (const prop of props) {
    if (prop.x < view.x - PROP_REACH_PX || prop.x > view.x + view.w + PROP_REACH_PX) continue;
    drawProp(ctx, prop, timeMs);
  }
  ctx.restore();
}
