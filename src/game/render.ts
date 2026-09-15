/**
 * Draws the live game world (Phase 2 to 3, placeholder art until the sprite pipeline lands after
 * Gate 2): sky, the terrain tiles from the mask, the water band, worms drawn as little characters
 * (tan body, team coloured bandana, eyes, feet, idle bob and a walk cycle), projectiles, mines,
 * crates, the active worm marker and the aim arm. Everything goes through the camera and the Ctx2D
 * interface; no readback. Ctx2D has no ellipse, so round shapes are built from a scaled arc: the
 * path is constructed under a scale transform and the transform is restored before fill and stroke,
 * so the outline width stays uniform.
 */

import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { visibleRect, worldToScreen, type Camera } from '../engine/camera.ts';
import type { Context2DLike } from '../terrain/context.ts';
import { blitTiles } from '../terrain/tiles.ts';
import type { MatchState } from '../match/state.ts';
import { activeWormOf } from '../match/ledger.ts';
import { WORM_HEIGHT } from '../sim/constants.ts';
import type { SimWorld } from '../sim/world.ts';
import { degToRad } from '../core/math.ts';
import type { AimState } from './aim.ts';
import type { Atlas } from '../engine/atlas.ts';
import type { ImageSource } from '../engine/canvas-types.ts';
import { drawSprite } from '../engine/sprite.ts';
import type { WormMotion } from '../sim/types.ts';
import { getWeapon } from '../weapons/registry.ts';
import type { WeaponId } from '../weapons/types.ts';

/** Both Ctx2D and Context2DLike are structural subsets of the real 2D context, which the browser passes as is. */
function asTileContext(ctx: Ctx2D): Context2DLike {
  return ctx as unknown as Context2DLike;
}

/** Rough label width without measureText (absent from Ctx2D), good enough for a placeholder tag. */
function labelWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6;
}

const TEAM_COLORS = ['#e05a4d', '#4d8fe0', '#57b85a', '#d9b23a'] as const;
const WORM_SKIN = '#e7b98a';
const WORM_SKIN_SHADE = '#c98f5f';
const WORM_OUTLINE = '#5a3a22';

export function teamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? '#e05a4d';
}

/** One character's generated sprite set, keyed by the team colour index it belongs to. */
export interface CharacterSprites {
  readonly atlas: Atlas;
  readonly image: ImageSource;
}

export interface RenderModel {
  readonly state: MatchState;
  readonly world: SimWorld;
  readonly aim: AimState;
  readonly timeMs: number;
  /** Team colour index to sprite set. Absent or empty means draw the procedural fallback worm. */
  readonly sprites?: ReadonlyMap<number, CharacterSprites>;
  /** The weapon the active worm holds; drawn in its hand when the weapon atlas has a held layer. */
  readonly weapon?: WeaponId;
  /** The weapon atlas (icons and held layers); null or absent means arms stay empty. */
  readonly weaponSprites?: CharacterSprites | null;
  /** World point under the mouse, drawn as the crosshair while a targeted weapon is selected. */
  readonly pointer?: { readonly x: number; readonly y: number };
  /** True while the human's selected weapon fires where the mouse points (air strike, teleport, girder). */
  readonly targeting?: boolean;
}

/**
 * Frame id for a worm's current state. Walking cycles through the four walk frames on a fixed
 * cadence; everything else is a single pose. The ids match tools/lora/frames.json.
 */
export function wormFrameId(worm: WormVisual, timeMs: number): string {
  if (!worm.alive) return 'death_a';
  if (worm.motion === 'drowning') return 'drown_sink';
  if (worm.motion === 'jumping') return 'jump_air';
  if (worm.motion === 'falling' || worm.motion === 'flying') return worm.vy > 0 ? 'fall' : 'jump_air';
  if (worm.motion === 'parachuting' || worm.motion === 'jetpacking') return 'parachute';
  if (Math.abs(worm.vx) > 5) {
    const cycle = ['walk_1', 'walk_2', 'walk_3', 'walk_4'] as const;
    return cycle[Math.floor(timeMs / 110) % cycle.length] ?? 'walk_1';
  }
  return Math.floor(timeMs / 900) % 2 === 0 ? 'idle_a' : 'idle_b';
}

/** Builds an ellipse path centred at (cx, cy) with radii (rx, ry); leaves it current for fill or stroke. */
function ellipsePath(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
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

/** A soft sun: concentric arcs of falling alpha, since Ctx2D has no radial gradient. */
function drawSun(ctx: Ctx2D, cx: number, cy: number, radius: number): void {
  for (let i = 6; i >= 1; i -= 1) {
    ctx.globalAlpha = 0.05 + (6 - i) * 0.012;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (i / 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
  ctx.fill();
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

function drawClouds(ctx: Ctx2D, viewport: Size, camera: Camera, timeMs: number): void {
  const span = viewport.w + 400;
  const drift = timeMs * 0.004;
  ctx.fillStyle = '#ffffff';
  for (const cloud of CLOUDS) {
    let sx = ((cloud.x + drift - camera.x * 0.14 + 200) % span + span) % span - 200;
    if (!Number.isFinite(sx)) continue;
    sx = Math.round(sx);
    const r = 22 * cloud.s;
    ctx.globalAlpha = 0.82;
    ellipsePath(ctx, sx, cloud.y, r * 1.6, r * 0.7);
    ctx.fill();
    ellipsePath(ctx, sx - r * 0.9, cloud.y + r * 0.22, r * 1.0, r * 0.52);
    ctx.fill();
    ellipsePath(ctx, sx + r * 0.95, cloud.y + r * 0.26, r * 0.9, r * 0.46);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSky(ctx: Ctx2D, viewport: Size, camera: Camera, horizonY: number, timeMs: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, viewport.h);
  sky.addColorStop(0, '#2d6ea6');
  sky.addColorStop(0.34, '#6aa6cf');
  sky.addColorStop(0.66, '#a9d0e5');
  sky.addColorStop(1, '#e7dcbc');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  drawSun(ctx, viewport.w * 0.8, viewport.h * 0.17, 34);
  drawClouds(ctx, viewport, camera, timeMs);

  // Two ridges behind the playfield: the far one hazier and slower, the near one darker.
  drawRidge(ctx, viewport, camera, horizonY + 26, 0.22, 58, 260, '#7ea6b8', 0.55);
  drawRidge(ctx, viewport, camera, horizonY + 48, 0.42, 44, 170, '#4f7a6a', 0.7);
}

function drawWater(ctx: Ctx2D, viewport: Size, camera: Camera, waterY: number, timeMs: number): void {
  const surface = worldToScreen(camera, viewport, { x: camera.x, y: waterY }).y;
  if (surface > viewport.h) return;
  const wave = (x: number): number => {
    const wx = x + camera.x;
    return surface + Math.sin(wx / 44 + timeMs / 800) * 2.5 + Math.sin(wx / 19 - timeMs / 430) * 1.2;
  };

  const body = ctx.createLinearGradient(0, surface, 0, viewport.h);
  body.addColorStop(0, 'rgba(86, 166, 214, 0.58)');
  body.addColorStop(1, 'rgba(16, 54, 102, 0.88)');
  ctx.beginPath();
  ctx.moveTo(0, wave(0));
  for (let x = 6; x <= viewport.w; x += 6) ctx.lineTo(x, wave(x));
  ctx.lineTo(viewport.w, viewport.h);
  ctx.lineTo(0, viewport.h);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  // Foam line on the crest.
  ctx.beginPath();
  ctx.moveTo(0, wave(0));
  for (let x = 6; x <= viewport.w; x += 6) ctx.lineTo(x, wave(x));
  ctx.strokeStyle = 'rgba(233, 247, 255, 0.72)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export interface WormVisual {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly color: string;
  readonly name: string;
  readonly hp: number;
  readonly active: boolean;
  readonly motion: WormMotion;
  readonly alive: boolean;
  /** Team colour index, used to pick this worm's character sprite set. */
  readonly colorIndex: number;
}

function drawWorm(
  ctx: Ctx2D,
  viewport: Size,
  camera: Camera,
  worm: WormVisual,
  timeMs: number,
  sprites?: ReadonlyMap<number, CharacterSprites>,
): void {
  const z = camera.zoom;
  const feet = worldToScreen(camera, viewport, { x: worm.x, y: worm.y });
  const speed = Math.abs(worm.vx);
  const walking = speed > 5;
  const airborne = Math.abs(worm.vy) > 25;

  // Ground shadow stays on the ground; the body bobs and squashes above it.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ellipsePath(ctx, feet.x, feet.y - 1 * z, 8 * z, 2.4 * z);
  ctx.fill();

  // Generated character sprite when its atlas is loaded; the procedural worm below is the fallback.
  const set = sprites?.get(worm.colorIndex);
  if (set !== undefined) {
    const frame = set.atlas.frame(wormFrameId(worm, timeMs));
    if (frame !== undefined) {
      // No extra scale: frameUnit already divides by SPRITE_SCALE, the engine's 3x authoring
      // convention, so a 48 px worm inside a 96 px frame lands at 48*z/3 = WORM_HEIGHT*z on screen.
      // Passing 1/3 here as well shrank every worm to a third of its size.
      drawSprite(ctx, set.image, frame, set.atlas.pivotOf(frame), {
        x: feet.x,
        y: feet.y,
        zoom: z,
        flipX: worm.facing === -1,
      });
      drawWormTag(ctx, feet.x, feet.y - WORM_HEIGHT * z - 20, worm, timeMs);
      return;
    }
  }

  const phase = worm.x * 0.13;
  const bob = airborne ? 0 : Math.sin(timeMs / 360 + phase) * 1.1 * z;
  const stretch = airborne ? Math.max(-0.18, Math.min(0.18, worm.vy / 900)) : 0;
  const bodyH = WORM_HEIGHT * z * (1 + stretch);
  const bodyRx = 6.2 * z * (1 - stretch * 0.6);
  const cx = feet.x;
  const cy = feet.y - bodyH * 0.5 - bob;
  const lean = walking ? worm.facing * 0.06 : 0;

  ctx.save();
  ctx.translate(cx, cy);
  if (lean !== 0) ctx.rotate(lean);

  // Feet: two nubs, alternating on the walk cycle.
  const step = walking ? Math.sin(timeMs / 90 + phase) * 2 * z : 0;
  ctx.fillStyle = WORM_OUTLINE;
  ellipsePath(ctx, -2.6 * z, bodyH * 0.5 - 0.5 * z + step, 2.6 * z, 1.5 * z);
  ctx.fill();
  ellipsePath(ctx, 2.6 * z, bodyH * 0.5 - 0.5 * z - step, 2.6 * z, 1.5 * z);
  ctx.fill();

  // Body with a dark outline, a lit belly and a shaded back.
  ellipsePath(ctx, 0, 0, bodyRx, bodyH * 0.5);
  ctx.fillStyle = WORM_SKIN;
  ctx.fill();
  ctx.strokeStyle = WORM_OUTLINE;
  ctx.lineWidth = Math.max(1, 1.1 * z);
  ctx.stroke();
  ctx.fillStyle = WORM_SKIN_SHADE;
  ellipsePath(ctx, -worm.facing * 2.4 * z, 1.5 * z, 3.0 * z, bodyH * 0.32);
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Bandana across the forehead in the team colour, with a knot tail on the back side.
  const browY = -bodyH * 0.22;
  ctx.fillStyle = worm.color;
  ellipsePath(ctx, 0, browY, bodyRx * 0.98, 1.9 * z);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-worm.facing * bodyRx * 0.7, browY);
  ctx.lineTo(-worm.facing * (bodyRx + 3.2 * z), browY - 1.6 * z);
  ctx.lineTo(-worm.facing * (bodyRx + 3.2 * z), browY + 2.4 * z);
  ctx.closePath();
  ctx.fill();

  // Eyes look toward the facing direction; a pupil and a highlight give it life.
  const eyeY = -bodyH * 0.06;
  const eyeDx = 2.1 * z;
  const look = worm.facing * 0.7 * z;
  for (const ex of [-eyeDx, eyeDx]) {
    ellipsePath(ctx, ex + worm.facing * 0.6 * z, eyeY, 1.7 * z, 2.0 * z);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(0.6, 0.5 * z);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex + look, eyeY + 0.3 * z, 0.9 * z, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
  }
  ctx.restore();

  drawWormTag(ctx, feet.x, cy - bodyH * 0.5 - 20, worm, timeMs);
}

/** Name and health tag, plus the bobbing turn arrow. Shared by the sprite and fallback paths. */
function drawWormTag(ctx: Ctx2D, cx: number, tagY: number, worm: WormVisual, timeMs: number): void {
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = `${worm.name} ${Math.max(0, Math.round(worm.hp))}`;
  const tw = labelWidth(label, 11) + 10;
  ctx.fillStyle = worm.active ? 'rgba(255,255,255,0.94)' : 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - tw / 2, tagY, tw, 15);
  ctx.fillStyle = worm.active ? '#111' : '#f2f2f2';
  ctx.fillText(label, cx, tagY + 12);

  if (worm.active) {
    const ay = tagY - 6 - Math.abs(Math.sin(timeMs / 240)) * 4;
    ctx.fillStyle = worm.color;
    ctx.beginPath();
    ctx.moveTo(cx - 5, ay - 8);
    ctx.lineTo(cx + 5, ay - 8);
    ctx.lineTo(cx, ay);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawAim(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, angleDeg: number, facing: number, power: number): void {
  const shoulder = worldToScreen(camera, viewport, { x, y: y - WORM_HEIGHT * 0.55 });
  const a = degToRad(angleDeg);
  const dir = { x: Math.cos(a) * facing, y: -Math.sin(a) };

  // The arm: a short thick stub from the shoulder in the aim direction.
  const armLen = 10 * camera.zoom;
  const hand = { x: shoulder.x + dir.x * armLen, y: shoulder.y + dir.y * armLen };
  ctx.strokeStyle = WORM_SKIN;
  ctx.lineWidth = Math.max(2, 3 * camera.zoom);
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hand.x, hand.y);
  ctx.stroke();

  // A dashed guide whose length grows with the charged power, faked with short segments.
  const guideLen = (26 + power * 60) * camera.zoom;
  ctx.strokeStyle = 'rgba(255, 204, 0, 0.9)';
  ctx.lineWidth = 2;
  const segments = 9;
  for (let i = 0; i < segments; i += 1) {
    if (i % 2 === 1) continue;
    const t0 = (i / segments) * guideLen;
    const t1 = ((i + 1) / segments) * guideLen;
    ctx.beginPath();
    ctx.moveTo(hand.x + dir.x * t0, hand.y + dir.y * t0);
    ctx.lineTo(hand.x + dir.x * t1, hand.y + dir.y * t1);
    ctx.stroke();
  }
  const tip = { x: hand.x + dir.x * guideLen, y: hand.y + dir.y * guideLen };
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawGame(ctx: Ctx2D, viewport: Size, camera: Camera, model: RenderModel): void {
  // The ridges sit just under the land surface line so they read as distant hills behind it.
  const horizonY = worldToScreen(camera, viewport, { x: camera.x, y: model.world.terrain.height * 0.45 }).y;
  drawSky(ctx, viewport, camera, horizonY, model.timeMs);
  const view = visibleRect(camera, viewport);
  const origin = worldToScreen(camera, viewport, { x: view.x, y: view.y });
  ctx.save();
  ctx.translate(origin.x, origin.y);
  blitTiles(model.world.terrain.tiles, asTileContext(ctx), view, camera.zoom);
  ctx.restore();
  drawWater(ctx, viewport, camera, model.state.waterY, model.timeMs);

  const activeId = activeWormOf(model.state)?.id;
  const infoById = new Map<string, { hp: number; color: string; name: string; colorIndex: number }>();
  for (const team of model.state.teams) for (const worm of team.worms) infoById.set(worm.id, { hp: worm.hp, color: teamColor(team.colorIndex), name: worm.name, colorIndex: team.colorIndex });

  for (const body of model.world.worms) {
    if (!body.alive) continue;
    const info = infoById.get(body.id);
    if (info === undefined || info.hp <= 0) continue;
    drawWorm(
      ctx,
      viewport,
      camera,
      { x: body.x, y: body.y, vx: body.vx, vy: body.vy, facing: body.facing, color: info.color, name: info.name, hp: info.hp, active: body.id === activeId, motion: body.motion, alive: body.alive, colorIndex: info.colorIndex },
      model.timeMs,
      model.sprites,
    );
  }
  for (const crate of model.world.crates) {
    if (!crate.alive) continue;
    drawCrate(ctx, viewport, camera, crate.x, crate.y, crate.kind, crate.landed, model);
  }
  for (const mine of model.world.mines) {
    const p = worldToScreen(camera, viewport, { x: mine.x, y: mine.y });
    ctx.fillStyle = mine.armed ? '#ff3b30' : '#555';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const projectile of model.world.projectiles) {
    const p = worldToScreen(camera, viewport, { x: projectile.x, y: projectile.y });
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, projectile.spec.radiusPx) * camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const sheep of model.world.sheep) {
    if (!sheep.alive) continue;
    drawSheep(ctx, viewport, camera, sheep.x, sheep.y, sheep.facing, model);
  }

  const activeBody = activeId === undefined ? undefined : model.world.worms.find((b) => b.id === activeId);
  if (activeBody !== undefined && (model.state.phase === 'Active' || model.state.phase === 'Firing')) {
    drawAim(ctx, viewport, camera, activeBody.x, activeBody.y, model.aim.angleDeg, activeBody.facing, model.aim.power);
    drawHeldWeapon(ctx, viewport, camera, activeBody.x, activeBody.y, model.aim.angleDeg, activeBody.facing, model);
  }
  if (model.targeting === true && model.pointer !== undefined && model.state.phase === 'Active') {
    drawCrosshair(ctx, viewport, camera, model.pointer, model.timeMs);
  }
}

/**
 * The crosshair of a targeted weapon: where the air strike's bombs come down, where the teleport
 * lands, where the girder goes. Nothing marked the point before, so the player aimed blind at the
 * mouse and the strike seemed to "fire into the sky". A slow pulse keeps it readable over terrain.
 */
function drawCrosshair(ctx: Ctx2D, viewport: Size, camera: Camera, pointer: { readonly x: number; readonly y: number }, timeMs: number): void {
  const p = worldToScreen(camera, viewport, pointer);
  const r = 12 + Math.sin(timeMs / 180) * 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - r - 6, p.y);
  ctx.lineTo(p.x - r + 4, p.y);
  ctx.moveTo(p.x + r - 4, p.y);
  ctx.lineTo(p.x + r + 6, p.y);
  ctx.moveTo(p.x, p.y - r - 6);
  ctx.lineTo(p.x, p.y - r + 4);
  ctx.moveTo(p.x, p.y + r - 4);
  ctx.lineTo(p.x, p.y + r + 6);
  ctx.stroke();
  ctx.restore();
}

/**
 * A supply crate: the weapon atlas's crate icon when it has loaded (health or weapon; the utility
 * crate borrows the weapon icon), otherwise a boxed primitive, both about a worm wide so the
 * player can see it. While it falls a canopy hangs over it. Before this a crate was a 12 px
 * rectangle with no parachute, which is why "crates never fall" was the report.
 */
function drawCrate(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, kind: 'weapon' | 'health' | 'utility', landed: boolean, model: RenderModel): void {
  const p = worldToScreen(camera, viewport, { x, y });
  const z = camera.zoom;
  const size = 14 * z;
  const sprites = model.weaponSprites;
  const frameId = kind === 'health' ? 'weapon_icon_crate_health' : 'weapon_icon_crate_weapon';
  const frame = sprites === undefined || sprites === null ? undefined : sprites.atlas.frame(frameId);
  if (frame !== undefined && sprites !== undefined && sprites !== null) {
    // The icon is a 64 px cell; frameUnit divides the zoom by SPRITE_SCALE, so this lands at about
    // 14 world px, and the pivot sits on the bottom edge so the crate rests on its feet position.
    drawSprite(ctx, sprites.image, frame, { x: 0.5, y: 0.92 }, { x: p.x, y: p.y, zoom: z, scale: 0.75 });
  } else {
    ctx.fillStyle = kind === 'health' ? '#3ecf5a' : kind === 'utility' ? '#5aa7e6' : '#c9a13a';
    ctx.fillRect(p.x - size / 2, p.y - size, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - size / 2, p.y - size, size, size);
  }
  if (!landed) {
    // Canopy and lines: a half disc above the crate, three strings down to its corners.
    const top = p.y - size - 22 * z;
    ctx.fillStyle = 'rgba(255, 140, 60, 0.95)';
    ctx.beginPath();
    ctx.arc(p.x, top, 16 * z, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const dx of [-16, 0, 16]) {
      ctx.moveTo(p.x + dx * z, top);
      ctx.lineTo(p.x + (dx / 3) * z, p.y - size);
    }
    ctx.stroke();
  }
}

/**
 * A live sheep: the weapon atlas's held layer of the sheep when it has loaded (it is the only sheep
 * art there is), otherwise a primitive body. Feet at (x, y), facing flips the drawing. Until this
 * existed the sheep ran its whole 20 s life invisible, which read as "the sheep does nothing".
 */
function drawSheep(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, facing: 1 | -1, model: RenderModel): void {
  const p = worldToScreen(camera, viewport, { x, y });
  const sprites = model.weaponSprites;
  const frame = sprites === undefined || sprites === null ? undefined : sprites.atlas.frame('weapon_held_sheep');
  if (frame !== undefined && sprites !== undefined && sprites !== null) {
    // The held layer is authored 60 px wide for a 48 px worm; the sheep is about a worm tall.
    drawSprite(ctx, sprites.image, frame, { x: 0.5, y: 0.95 }, { x: p.x, y: p.y, zoom: camera.zoom, flipX: facing === -1, scale: 0.6 });
    return;
  }
  const z = camera.zoom;
  ctx.fillStyle = '#f4f1e8';
  ctx.beginPath();
  ctx.arc(p.x - 2.5 * z, p.y - 5 * z, 4 * z, 0, Math.PI * 2);
  ctx.arc(p.x + 2.5 * z, p.y - 5 * z, 4 * z, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.arc(p.x + facing * 5 * z, p.y - 6 * z, 2.2 * z, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(p.x - 4 * z, p.y - 2 * z, 1.5 * z, 2 * z);
  ctx.fillRect(p.x + 2 * z, p.y - 2 * z, 1.5 * z, 2 * z);
}

/**
 * The selected weapon in the active worm's hand: the atlas's held layer (business end drawn
 * pointing right, pivot on the grip) pinned to the hand at the end of the aim arm and rotated to
 * the aim. rotation is clockwise radians on screen; a worm facing left flips the sprite, and since
 * drawSprite flips after rotating, the flipped sprite's base direction is pi, so the sign of the
 * angle flips with it. Nothing is drawn when the atlas is missing or the weapon has no held layer.
 */
function drawHeldWeapon(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, angleDeg: number, facing: number, model: RenderModel): void {
  const sprites = model.weaponSprites;
  if (sprites === undefined || sprites === null || model.weapon === undefined) return;
  const frameId = getWeapon(model.weapon).heldSprite;
  if (frameId === null) return;
  const frame = sprites.atlas.frame(frameId);
  if (frame === undefined) return;
  const shoulder = worldToScreen(camera, viewport, { x, y: y - WORM_HEIGHT * 0.55 });
  const a = degToRad(angleDeg);
  const armLen = 10 * camera.zoom;
  const hand = { x: shoulder.x + Math.cos(a) * facing * armLen, y: shoulder.y - Math.sin(a) * armLen };
  const flipX = facing === -1;
  drawSprite(ctx, sprites.image, frame, sprites.atlas.pivotOf(frame), {
    x: hand.x,
    y: hand.y,
    zoom: camera.zoom,
    flipX,
    rotation: flipX ? a : -a,
  });
}
