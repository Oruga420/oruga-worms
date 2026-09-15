/**
 * Camera (architecture.md section I, engine/camera.ts): a frozen state record plus pure
 * functions. Zoom bounds come from config/units.ts, the single source of the camera scale
 * (ultraplan design rule). Position is the world point at the viewport center; screen space is
 * CSS pixels with the origin at the top left of the viewport.
 *
 * Follow uses exponential smoothing with a time constant, pan is a smoothstep tween, shake is a
 * deterministic two frequency wobble with exponential decay so replays stay identical.
 */

import { ZOOM_DEFAULT, clampZoom } from '../config/units.ts';
import { clamp, lerp, vec2, type Vec2 } from '../core/math.ts';
import type { Rect, Size } from './canvas-types.ts';

/** Mouse wheel notch in zoom units. */
export const ZOOM_STEP = 0.25;

export interface PanState {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly elapsedMs: number;
  readonly durationMs: number;
}

export interface ShakeState {
  /** Current peak offset in world px. */
  readonly amplitude: number;
  readonly elapsedMs: number;
  /** Fraction of the amplitude that survives each second. */
  readonly decayPerSecond: number;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly target: Vec2 | null;
  /** Time constant of the follow smoothing in ms; 0 snaps. */
  readonly followTauMs: number;
  readonly pan: PanState | null;
  readonly shake: ShakeState;
  /** World size to keep the view inside, null for a free camera. */
  readonly bounds: Size | null;
}

export interface CameraOptions {
  readonly x: number;
  readonly y: number;
  readonly zoom?: number;
  readonly bounds?: Size | null;
  readonly followTauMs?: number;
}

const NO_SHAKE: ShakeState = Object.freeze({ amplitude: 0, elapsedMs: 0, decayPerSecond: 0.02 });
const SHAKE_FLOOR = 0.05;

export function createCamera(options: CameraOptions): Camera {
  return Object.freeze({
    x: options.x,
    y: options.y,
    zoom: clampZoom(options.zoom ?? ZOOM_DEFAULT),
    target: null,
    followTauMs: options.followTauMs ?? 150,
    pan: null,
    shake: NO_SHAKE,
    bounds: options.bounds ?? null,
  });
}

export function setZoom(camera: Camera, zoom: number): Camera {
  const next = clampZoom(zoom);
  return next === camera.zoom ? camera : Object.freeze({ ...camera, zoom: next });
}

/** Wheel notches: positive zooms in. */
export function zoomBy(camera: Camera, notches: number): Camera {
  return setZoom(camera, camera.zoom + notches * ZOOM_STEP);
}

/** Instant move; cancels a running pan. */
export function moveTo(camera: Camera, x: number, y: number): Camera {
  return Object.freeze({ ...camera, x, y, pan: null });
}

export function follow(camera: Camera, target: Vec2 | null, followTauMs?: number): Camera {
  return Object.freeze({ ...camera, target, pan: null, followTauMs: followTauMs ?? camera.followTauMs });
}

/** Tween to a point; releases the follow target and lands exactly on `to`. */
export function panTo(camera: Camera, to: Vec2, durationMs: number): Camera {
  if (durationMs <= 0) return moveTo(Object.freeze({ ...camera, target: null }), to.x, to.y);
  return Object.freeze({
    ...camera,
    target: null,
    pan: Object.freeze({ from: vec2(camera.x, camera.y), to, elapsedMs: 0, durationMs }),
  });
}

/** Starts or intensifies a shake; a new shake never weakens one already running. */
export function shake(camera: Camera, amplitude: number, decayPerSecond = 0.02): Camera {
  if (amplitude <= camera.shake.amplitude) return camera;
  return Object.freeze({ ...camera, shake: Object.freeze({ amplitude, elapsedMs: 0, decayPerSecond }) });
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function advancePan(camera: Camera, dtMs: number): Camera {
  if (camera.pan === null) return camera;
  const elapsedMs = camera.pan.elapsedMs + dtMs;
  if (elapsedMs >= camera.pan.durationMs) {
    return Object.freeze({ ...camera, x: camera.pan.to.x, y: camera.pan.to.y, pan: null });
  }
  const t = smoothstep(elapsedMs / camera.pan.durationMs);
  return Object.freeze({
    ...camera,
    x: lerp(camera.pan.from.x, camera.pan.to.x, t),
    y: lerp(camera.pan.from.y, camera.pan.to.y, t),
    pan: Object.freeze({ ...camera.pan, elapsedMs }),
  });
}

function advanceFollow(camera: Camera, dtMs: number): Camera {
  if (camera.target === null || camera.pan !== null) return camera;
  const factor = camera.followTauMs <= 0 ? 1 : 1 - Math.exp(-dtMs / camera.followTauMs);
  return Object.freeze({
    ...camera,
    x: lerp(camera.x, camera.target.x, factor),
    y: lerp(camera.y, camera.target.y, factor),
  });
}

function advanceShake(camera: Camera, dtMs: number): Camera {
  if (camera.shake.amplitude === 0) return camera;
  const amplitude = camera.shake.amplitude * Math.pow(camera.shake.decayPerSecond, dtMs / 1000);
  if (amplitude < SHAKE_FLOOR) return Object.freeze({ ...camera, shake: NO_SHAKE });
  return Object.freeze({
    ...camera,
    shake: Object.freeze({ ...camera.shake, amplitude, elapsedMs: camera.shake.elapsedMs + dtMs }),
  });
}

/** Deterministic wobble: two incommensurate frequencies, magnitude never above the amplitude. */
export function shakeOffset(state: ShakeState): Vec2 {
  if (state.amplitude === 0) return vec2(0, 0);
  const t = state.elapsedMs / 1000;
  const scale = state.amplitude / Math.SQRT2;
  return vec2(scale * Math.sin(t * 2 * Math.PI * 17), scale * Math.cos(t * 2 * Math.PI * 23));
}

/** Keeps the view inside the world bounds; centers an axis the world does not fill. */
export function clampToBounds(camera: Camera, viewport: Size): Camera {
  if (camera.bounds === null) return camera;
  const halfW = viewport.w / camera.zoom / 2;
  const halfH = viewport.h / camera.zoom / 2;
  const x = halfW * 2 >= camera.bounds.w ? camera.bounds.w / 2 : clamp(camera.x, halfW, camera.bounds.w - halfW);
  const y = halfH * 2 >= camera.bounds.h ? camera.bounds.h / 2 : clamp(camera.y, halfH, camera.bounds.h - halfH);
  return x === camera.x && y === camera.y ? camera : Object.freeze({ ...camera, x, y });
}

/** One simulation step of camera motion. */
export function updateCamera(camera: Camera, dtMs: number, viewport: Size): Camera {
  return clampToBounds(advanceShake(advanceFollow(advancePan(camera, dtMs), dtMs), dtMs), viewport);
}

export function worldToScreen(camera: Camera, viewport: Size, point: Vec2): Vec2 {
  const offset = shakeOffset(camera.shake);
  return vec2(
    (point.x - camera.x - offset.x) * camera.zoom + viewport.w / 2,
    (point.y - camera.y - offset.y) * camera.zoom + viewport.h / 2,
  );
}

export function screenToWorld(camera: Camera, viewport: Size, point: Vec2): Vec2 {
  const offset = shakeOffset(camera.shake);
  return vec2(
    (point.x - viewport.w / 2) / camera.zoom + camera.x + offset.x,
    (point.y - viewport.h / 2) / camera.zoom + camera.y + offset.y,
  );
}

/** World rect on screen, padded so shaking never reveals unculled edges. */
export function visibleRect(camera: Camera, viewport: Size, marginPx = 0): Rect {
  const pad = marginPx + camera.shake.amplitude;
  const w = viewport.w / camera.zoom + pad * 2;
  const h = viewport.h / camera.zoom + pad * 2;
  return Object.freeze({ x: camera.x - w / 2, y: camera.y - h / 2, w, h });
}

export function isVisible(rect: Rect, camera: Camera, viewport: Size, marginPx = 0): boolean {
  const view = visibleRect(camera, viewport, marginPx);
  return rect.x < view.x + view.w && rect.x + rect.w > view.x && rect.y < view.y + view.h && rect.y + rect.h > view.y;
}
