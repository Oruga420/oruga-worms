/**
 * Dev frame overlay (ultraplan "Simulation units and tuning": the frame time overlay drops the
 * DPR to 1.5 and then 1 when the average frame exceeds 14 ms; judge-charly rev 2 item 31: the
 * frame budget at DPR 2 is load bearing, so the number must be visible while tuning). Shows the
 * rolling frame average against the budget, fps, tick count, DPR and the live particle count.
 *
 * Behind a flag (the overlay query parameter) and refreshed at most every 250 ms: the text lives
 * on the HUD canvas, which only redraws when marked dirty, so the overlay never turns text
 * rasterization back into a per frame cost on the world canvas it is measuring.
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import type { Ctx2D, Size } from './canvas-types.ts';

export const FRAME_BUDGET_MS: number = GAME_CONFIG.dpr.stepDownAtMs;
export const OVERLAY_REFRESH_MS = 250;

const EMPTY: readonly string[] = Object.freeze([]);
const PADDING = 8;
const LINE_HEIGHT = 14;
const BOX_WIDTH = 260;

export interface OverlaySample {
  readonly averageFrameMs: number;
  readonly fps: number;
  readonly tickCount: number;
  readonly dpr: number;
  readonly particleCount: number;
  /** Accumulator time thrown away at the substep cap since boot. */
  readonly discardedMs: number;
}

function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

/** The overlay text for one sample; pure. */
export function formatOverlay(sample: OverlaySample): readonly string[] {
  const over = sample.averageFrameMs > FRAME_BUDGET_MS ? ' OVER' : '';
  return Object.freeze([
    `frame ${fmt(sample.averageFrameMs, 1)} ms avg / ${fmt(FRAME_BUDGET_MS, 0)} budget${over}`,
    `fps ${fmt(sample.fps, 0)}  ticks ${sample.tickCount}`,
    `dpr ${fmt(sample.dpr, 2)}  particles ${sample.particleCount}`,
    `discarded ${fmt(sample.discardedMs, 0)} ms`,
  ]);
}

/** The flag: ?overlay, ?overlay=1 or anything but 0, false and off turns the overlay on. */
export function overlayEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get('overlay');
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off');
}

export interface FrameOverlayOptions {
  readonly enabled: boolean;
  readonly refreshMs?: number;
}

export interface FrameOverlay {
  readonly enabled: boolean;
  /** Feeds a sample; true when the text changed, which is when the HUD needs a redraw. */
  update(sample: OverlaySample, nowMs: number): boolean;
  lines(): readonly string[];
  draw(ctx: Ctx2D, viewport: Size): void;
}

export function createFrameOverlay(options: FrameOverlayOptions): FrameOverlay {
  const refreshMs = options.refreshMs ?? OVERLAY_REFRESH_MS;
  // Overlay state: replaced, never mutated, on each refresh.
  let lines: readonly string[] = EMPTY;
  let lastRefreshMs: number | null = null;

  return {
    enabled: options.enabled,
    update: (sample, nowMs) => {
      if (!options.enabled) return false;
      if (lastRefreshMs !== null && nowMs - lastRefreshMs < refreshMs) return false;
      lastRefreshMs = nowMs;
      lines = formatOverlay(sample);
      return true;
    },
    lines: () => lines,
    draw: (ctx, viewport) => {
      if (!options.enabled || lines.length === 0) return;
      const height = PADDING * 2 + lines.length * LINE_HEIGHT;
      const x = viewport.w - BOX_WIDTH - PADDING;
      const y = PADDING;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x, y, BOX_WIDTH, height);
      ctx.font = '12px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#d8f3dc';
      lines.forEach((line, index) => {
        ctx.fillText(line, x + PADDING, y + PADDING + index * LINE_HEIGHT);
      });
      ctx.restore();
    },
  };
}
