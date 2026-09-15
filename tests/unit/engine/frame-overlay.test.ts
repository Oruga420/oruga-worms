import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import type { Ctx2D } from '@/engine/canvas-types.ts';
import {
  FRAME_BUDGET_MS,
  OVERLAY_REFRESH_MS,
  createFrameOverlay,
  formatOverlay,
  overlayEnabledFromSearch,
  type OverlaySample,
} from '@/engine/frame-overlay.ts';

const SAMPLE: OverlaySample = { averageFrameMs: 12.34, fps: 59.6, tickCount: 1234, dpr: 1.5, particleCount: 42, discardedMs: 16.7 };

function fakeCtx() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map(String).join(',')})`);
    };
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
    createLinearGradient: () => ({ addColorStop: record('addColorStop') }) as unknown as CanvasGradient,
  } as Ctx2D;
  return { ctx, calls, count: (name: string) => calls.filter((call) => call.startsWith(`${name}(`)).length };
}

describe('frame overlay: formatting', () => {
  it('reads the budget from the DPR policy', () => {
    expect(FRAME_BUDGET_MS).toBe(GAME_CONFIG.dpr.stepDownAtMs);
    expect(FRAME_BUDGET_MS).toBe(14);
    expect(OVERLAY_REFRESH_MS).toBe(250);
  });

  it('formats the four lines', () => {
    expect(formatOverlay(SAMPLE)).toEqual([
      'frame 12.3 ms avg / 14 budget',
      'fps 60  ticks 1234',
      'dpr 1.50  particles 42',
      'discarded 17 ms',
    ]);
    expect(Object.isFrozen(formatOverlay(SAMPLE))).toBe(true);
  });

  it('flags an average over the budget and survives bad numbers', () => {
    expect(formatOverlay({ ...SAMPLE, averageFrameMs: 14.01 })[0]).toBe('frame 14.0 ms avg / 14 budget OVER');
    expect(formatOverlay({ ...SAMPLE, averageFrameMs: 14 })[0]).toBe('frame 14.0 ms avg / 14 budget');
    expect(formatOverlay({ ...SAMPLE, fps: Number.NaN, dpr: Number.POSITIVE_INFINITY })).toEqual([
      'frame 12.3 ms avg / 14 budget',
      'fps n/a  ticks 1234',
      'dpr n/a  particles 42',
      'discarded 17 ms',
    ]);
  });
});

describe('frame overlay: flag', () => {
  it('turns on for ?overlay and any value but 0, false and off', () => {
    expect(overlayEnabledFromSearch('')).toBe(false);
    expect(overlayEnabledFromSearch('?other=1')).toBe(false);
    expect(overlayEnabledFromSearch('?overlay')).toBe(true);
    expect(overlayEnabledFromSearch('?overlay=1')).toBe(true);
    expect(overlayEnabledFromSearch('?overlay=yes&other=2')).toBe(true);
    expect(overlayEnabledFromSearch('?overlay=0')).toBe(false);
    expect(overlayEnabledFromSearch('?overlay=false')).toBe(false);
    expect(overlayEnabledFromSearch('?overlay=OFF')).toBe(false);
  });
});

describe('frame overlay: instance', () => {
  it('stays inert when disabled', () => {
    const overlay = createFrameOverlay({ enabled: false });
    expect(overlay.enabled).toBe(false);
    expect(overlay.update(SAMPLE, 0)).toBe(false);
    expect(overlay.update(SAMPLE, 1000)).toBe(false);
    expect(overlay.lines()).toEqual([]);
    const fake = fakeCtx();
    overlay.draw(fake.ctx, { w: 800, h: 600 });
    expect(fake.calls).toEqual([]);
  });

  it('refreshes at most every refreshMs and reports when the text changed', () => {
    const overlay = createFrameOverlay({ enabled: true });
    expect(overlay.lines()).toEqual([]);
    expect(overlay.update(SAMPLE, 1000)).toBe(true);
    expect(overlay.lines()).toHaveLength(4);
    expect(overlay.update({ ...SAMPLE, tickCount: 1235 }, 1100)).toBe(false);
    expect(overlay.lines()[1]).toBe('fps 60  ticks 1234');
    expect(overlay.update({ ...SAMPLE, tickCount: 1236 }, 1249)).toBe(false);
    expect(overlay.update({ ...SAMPLE, tickCount: 1236 }, 1250)).toBe(true);
    expect(overlay.lines()[1]).toBe('fps 60  ticks 1236');
    const quick = createFrameOverlay({ enabled: true, refreshMs: 10 });
    expect(quick.update(SAMPLE, 0)).toBe(true);
    expect(quick.update(SAMPLE, 10)).toBe(true);
  });

  it('draws a box and one text line per entry on the given context', () => {
    const overlay = createFrameOverlay({ enabled: true });
    const fake = fakeCtx();
    overlay.draw(fake.ctx, { w: 800, h: 600 });
    expect(fake.calls).toEqual([]);
    overlay.update(SAMPLE, 0);
    overlay.draw(fake.ctx, { w: 800, h: 600 });
    expect(fake.count('fillRect')).toBe(1);
    expect(fake.count('fillText')).toBe(4);
    expect(fake.count('save')).toBe(1);
    expect(fake.count('restore')).toBe(1);
    expect(fake.calls[fake.calls.length - 1]).toBe('restore()');
    expect(fake.calls.some((call) => call.startsWith('fillText(frame 12.3 ms avg'))).toBe(true);
  });
});
