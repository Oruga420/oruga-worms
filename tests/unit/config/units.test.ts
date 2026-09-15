import { describe, expect, it } from 'vitest';
import {
  FRAME_SCALE,
  MAX_SUBSTEPS,
  SIM_HZ,
  SOURCE_HZ,
  SPRITE_SCALE,
  TICK_MS,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  msToTicks,
  pxPerSourceFrameSqToPxPerTickSq,
  pxPerSourceFrameToPxPerSecond,
  pxPerSourceFrameToPxPerTick,
  pxPerTickToPxPerSourceFrame,
  sourceFramesToTicks,
  ticksToMs,
} from '@/config/units.ts';

describe('units: time base', () => {
  it('runs the sim at 60 Hz over a 50 fps source with FRAME_SCALE 50/60', () => {
    expect(SIM_HZ).toBe(60);
    expect(SOURCE_HZ).toBe(50);
    expect(FRAME_SCALE).toBeCloseTo(5 / 6, 12);
    expect(TICK_MS).toBeCloseTo(16.6667, 3);
    expect(MAX_SUBSTEPS).toBe(5);
  });

  it('converts 32 px per source frame to 1600 px per second', () => {
    expect(pxPerSourceFrameToPxPerSecond(32)).toBe(1600);
  });

  it('converts 32 px per source frame to 26.667 px per tick', () => {
    expect(pxPerSourceFrameToPxPerTick(32)).toBeCloseTo(26.667, 3);
  });

  it('turns a 3 s fuse into 180 ticks', () => {
    expect(msToTicks(3000)).toBe(180);
    expect(msToTicks(1000)).toBe(60);
    expect(msToTicks(16.6)).toBe(1);
    expect(ticksToMs(180)).toBeCloseTo(3000, 9);
  });

  it('turns 150 source frames (3 s at 50 fps) into 180 ticks', () => {
    expect(sourceFramesToTicks(150)).toBeCloseTo(180, 9);
    expect(sourceFramesToTicks(50)).toBeCloseTo(60, 9);
  });

  it('round trips a per tick speed back to the source unit', () => {
    expect(pxPerTickToPxPerSourceFrame(pxPerSourceFrameToPxPerTick(8))).toBeCloseTo(8, 12);
  });

  it('scales acceleration by FRAME_SCALE squared', () => {
    expect(pxPerSourceFrameSqToPxPerTickSq(36)).toBeCloseTo(25, 9);
  });
});

describe('units: camera', () => {
  it('exposes the zoom range and the sprite authoring scale', () => {
    expect(ZOOM_MIN).toBe(2);
    expect(ZOOM_MAX).toBe(3);
    expect(ZOOM_DEFAULT).toBe(2.5);
    expect(SPRITE_SCALE).toBe(3);
  });

  it('clamps the zoom to the range', () => {
    expect(clampZoom(1)).toBe(2);
    expect(clampZoom(5)).toBe(3);
    expect(clampZoom(2.25)).toBe(2.25);
  });
});
