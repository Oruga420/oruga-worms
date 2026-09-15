import { describe, expect, it } from 'vitest';
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '@/config/units.ts';
import { vec2 } from '@/core/math.ts';
import {
  ZOOM_STEP,
  clampToBounds,
  createCamera,
  follow,
  isVisible,
  moveTo,
  panTo,
  screenToWorld,
  setZoom,
  shake,
  shakeOffset,
  updateCamera,
  visibleRect,
  worldToScreen,
  zoomBy,
} from '@/engine/camera.ts';

const viewport = { w: 1280, h: 720 };

describe('camera: zoom', () => {
  it('defaults to ZOOM_DEFAULT and clamps to the units.ts range', () => {
    const camera = createCamera({ x: 0, y: 0 });
    expect(camera.zoom).toBe(ZOOM_DEFAULT);
    expect(setZoom(camera, 10).zoom).toBe(ZOOM_MAX);
    expect(setZoom(camera, 0.1).zoom).toBe(ZOOM_MIN);
    expect(createCamera({ x: 0, y: 0, zoom: 99 }).zoom).toBe(ZOOM_MAX);
  });

  it('zooms by wheel notches and returns the same object when nothing changes', () => {
    const camera = createCamera({ x: 0, y: 0, zoom: 2.5 });
    expect(zoomBy(camera, 1).zoom).toBeCloseTo(2.5 + ZOOM_STEP, 12);
    expect(zoomBy(camera, -2).zoom).toBe(2);
    expect(setZoom(camera, 2.5)).toBe(camera);
    expect(Object.isFrozen(camera)).toBe(true);
  });
});

describe('camera: transforms', () => {
  it('maps the camera position to the viewport center', () => {
    const camera = createCamera({ x: 960, y: 348, zoom: 2 });
    expect(worldToScreen(camera, viewport, vec2(960, 348))).toEqual({ x: 640, y: 360 });
    expect(worldToScreen(camera, viewport, vec2(970, 338))).toEqual({ x: 660, y: 340 });
  });

  it('round trips screen to world through the zoom', () => {
    const camera = createCamera({ x: 100, y: 200, zoom: 2.5 });
    const world = screenToWorld(camera, viewport, vec2(100, 50));
    const back = worldToScreen(camera, viewport, world);
    expect(back.x).toBeCloseTo(100, 9);
    expect(back.y).toBeCloseTo(50, 9);
    expect(screenToWorld(camera, viewport, vec2(640, 360))).toEqual({ x: 100, y: 200 });
  });

  it('reports the visible world rect for culling', () => {
    const camera = createCamera({ x: 500, y: 300, zoom: 2 });
    const rect = visibleRect(camera, viewport);
    expect(rect).toEqual({ x: 500 - 320, y: 300 - 180, w: 640, h: 360 });
    expect(isVisible({ x: 400, y: 200, w: 10, h: 10 }, camera, viewport)).toBe(true);
    expect(isVisible({ x: 2000, y: 200, w: 10, h: 10 }, camera, viewport)).toBe(false);
    expect(isVisible({ x: 830, y: 200, w: 10, h: 10 }, camera, viewport, 20)).toBe(true);
  });
});

describe('camera: follow and pan', () => {
  it('moves toward the target with exponential smoothing and converges', () => {
    let camera = follow(createCamera({ x: 0, y: 0, followTauMs: 100 }), vec2(100, 0));
    camera = updateCamera(camera, 100, viewport);
    expect(camera.x).toBeCloseTo(100 * (1 - Math.exp(-1)), 9);
    for (let i = 0; i < 100; i += 1) camera = updateCamera(camera, 100, viewport);
    expect(camera.x).toBeCloseTo(100, 6);
    expect(camera.y).toBe(0);
  });

  it('snaps with a zero time constant', () => {
    const camera = updateCamera(follow(createCamera({ x: 0, y: 0 }), vec2(50, 60), 0), 16, viewport);
    expect(camera.x).toBe(50);
    expect(camera.y).toBe(60);
  });

  it('pans with an ease and lands exactly at the destination', () => {
    let camera = panTo(createCamera({ x: 0, y: 0 }), vec2(200, 100), 1000);
    camera = updateCamera(camera, 500, viewport);
    expect(camera.x).toBeCloseTo(100, 9);
    expect(camera.y).toBeCloseTo(50, 9);
    expect(camera.pan).not.toBeNull();
    camera = updateCamera(camera, 250, viewport);
    expect(camera.x).toBeGreaterThan(100);
    camera = updateCamera(camera, 250, viewport);
    expect(camera.x).toBe(200);
    expect(camera.y).toBe(100);
    expect(camera.pan).toBeNull();
  });

  it('pan releases the follow target and moveTo cancels the pan', () => {
    const following = follow(createCamera({ x: 0, y: 0 }), vec2(1, 1));
    const panning = panTo(following, vec2(9, 9), 500);
    expect(panning.target).toBeNull();
    const moved = moveTo(panning, 3, 4);
    expect(moved.pan).toBeNull();
    expect(moved.x).toBe(3);
    expect(panTo(following, vec2(7, 8), 0)).toMatchObject({ x: 7, y: 8, pan: null, target: null });
  });
});

describe('camera: shake', () => {
  it('offsets within the amplitude and decays to zero', () => {
    let camera = shake(createCamera({ x: 0, y: 0 }), 10);
    const first = shakeOffset(camera.shake);
    expect(Math.hypot(first.x, first.y)).toBeLessThanOrEqual(10 + 1e-9);
    camera = updateCamera(camera, 16, viewport);
    expect(camera.shake.amplitude).toBeLessThan(10);
    expect(camera.shake.amplitude).toBeGreaterThan(0);
    for (let i = 0; i < 200; i += 1) camera = updateCamera(camera, 16, viewport);
    expect(camera.shake.amplitude).toBe(0);
    expect(shakeOffset(camera.shake)).toEqual({ x: 0, y: 0 });
  });

  it('never weakens a running shake and is deterministic', () => {
    const strong = shake(createCamera({ x: 0, y: 0 }), 10);
    expect(shake(strong, 3)).toBe(strong);
    const a = updateCamera(strong, 33, viewport);
    const b = updateCamera(strong, 33, viewport);
    expect(shakeOffset(a.shake)).toEqual(shakeOffset(b.shake));
  });

  it('shifts world to screen mapping by the offset', () => {
    const camera = updateCamera(shake(createCamera({ x: 0, y: 0, zoom: 2 }), 8), 7, viewport);
    const offset = shakeOffset(camera.shake);
    const screen = worldToScreen(camera, viewport, vec2(0, 0));
    expect(screen.x).toBeCloseTo(640 - offset.x * 2, 9);
    expect(screen.y).toBeCloseTo(360 - offset.y * 2, 9);
    expect(visibleRect(camera, viewport).w).toBeGreaterThan(640);
  });
});

describe('camera: bounds', () => {
  const bounds = { w: 1920, h: 696 };

  it('keeps the view inside the world', () => {
    const camera = createCamera({ x: 0, y: 0, zoom: 2, bounds });
    const clamped = clampToBounds(camera, viewport);
    expect(clamped.x).toBe(320);
    expect(clamped.y).toBe(180);
    const far = clampToBounds(moveTo(camera, 5000, 5000), viewport);
    expect(far.x).toBe(1920 - 320);
    expect(far.y).toBe(696 - 180);
  });

  it('centers an axis the world does not fill', () => {
    const camera = createCamera({ x: 0, y: 0, zoom: 2, bounds: { w: 400, h: 200 } });
    const clamped = clampToBounds(camera, viewport);
    expect(clamped.x).toBe(200);
    expect(clamped.y).toBe(100);
  });

  it('leaves a free camera alone and applies bounds inside update', () => {
    const free = createCamera({ x: -500, y: -500, zoom: 2 });
    expect(clampToBounds(free, viewport)).toBe(free);
    const bounded = updateCamera(createCamera({ x: -500, y: -500, zoom: 2, bounds }), 16, viewport);
    expect(bounded.x).toBe(320);
  });
});
