/**
 * Fixed timestep loop (architecture.md section C, ultraplan "Simulation units and tuning").
 * dt = 1 / SIM_HZ, accumulator pattern, at most MAX_SUBSTEPS ticks per animation frame, and the
 * leftover accumulated time is DISCARDED once the cap is hit so fuses never drift from the wall
 * clock after a stall (design rule from the bug hunt). Render snaps to the latest tick; alpha is
 * exposed for a later interpolation upgrade.
 *
 * stepAccumulator is pure and carries the whole timing decision. createLoop wraps it with a
 * scheduler interface (requestAnimationFrame in the browser, a fake clock in tests) and a
 * rolling frame time sampler read by the DPR policy and the dev overlay.
 */

import { MAX_SUBSTEPS, TICK_MS } from '../config/units.ts';

export interface AccumulatorStep {
  /** Ticks to run this frame, 0..maxSubsteps. */
  readonly ticks: number;
  /** Time carried into the next frame; 0 whenever the cap was hit. */
  readonly accumulatorMs: number;
  /** Time thrown away because the cap was hit. */
  readonly discardedMs: number;
}

export function stepAccumulator(
  accumulatorMs: number,
  elapsedMs: number,
  tickMs: number = TICK_MS,
  maxSubsteps: number = MAX_SUBSTEPS,
): AccumulatorStep {
  const total = accumulatorMs + Math.max(0, elapsedMs);
  const wanted = Math.floor(total / tickMs);
  if (wanted > maxSubsteps) {
    return Object.freeze({ ticks: maxSubsteps, accumulatorMs: 0, discardedMs: total - maxSubsteps * tickMs });
  }
  return Object.freeze({ ticks: wanted, accumulatorMs: total - wanted * tickMs, discardedMs: 0 });
}

export interface FrameSampler {
  push(ms: number): void;
  /** Mean of the last windowSize samples; 0 before the first sample. */
  average(): number;
  last(): number;
  count(): number;
  reset(): void;
}

/** Rolling average over a fixed window. Ring buffer, mutated per frame: this is a hot path. */
export function createFrameSampler(windowSize = 60): FrameSampler {
  const size = Math.max(1, Math.floor(windowSize));
  const samples = new Float64Array(size);
  let head = 0;
  let filled = 0;
  let sum = 0;
  let lastValue = 0;
  return {
    push: (ms) => {
      const value = Number.isFinite(ms) && ms >= 0 ? ms : 0;
      sum -= samples[head] ?? 0;
      samples[head] = value;
      sum += value;
      head = (head + 1) % size;
      filled = Math.min(size, filled + 1);
      lastValue = value;
    },
    average: () => (filled === 0 ? 0 : sum / filled),
    last: () => lastValue,
    count: () => filled,
    reset: () => {
      samples.fill(0);
      head = 0;
      filled = 0;
      sum = 0;
      lastValue = 0;
    },
  };
}

export interface LoopHooks {
  /** Runs once per simulation tick with the tick number (1 based) and dt in seconds. */
  readonly tick: (tick: number, dtSeconds: number) => void;
  /** Runs once per frame after the ticks; alpha is the unconsumed fraction of a tick. */
  readonly render: (tick: number, alpha: number) => void;
}

export interface LoopScheduler {
  /** Monotonic milliseconds. */
  now(): number;
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
}

export interface LoopOptions {
  readonly tickMs?: number;
  readonly maxSubsteps?: number;
  readonly sampleWindow?: number;
}

export interface LoopStats {
  /** Rolling average of the work done per frame (ticks plus render), the DPR policy input. */
  readonly averageFrameMs: number;
  readonly lastFrameMs: number;
  /** Rolling average of the wall time between frames. */
  readonly averageDeltaMs: number;
  readonly fps: number;
  readonly tickCount: number;
  readonly discardedMs: number;
}

export interface Loop {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  tickCount(): number;
  /** Advances one frame at the given time. Public so tests and tools can step by hand. */
  frame(nowMs: number): AccumulatorStep;
  stats(): LoopStats;
}

export function createLoop(hooks: LoopHooks, scheduler: LoopScheduler, options: LoopOptions = {}): Loop {
  const tickMs = options.tickMs ?? TICK_MS;
  const maxSubsteps = options.maxSubsteps ?? MAX_SUBSTEPS;
  const dtSeconds = tickMs / 1000;
  const work = createFrameSampler(options.sampleWindow ?? 60);
  const delta = createFrameSampler(options.sampleWindow ?? 60);

  // Per frame mutable loop state; this is the hot path and it does not allocate.
  let running = false;
  let handle: number | null = null;
  let lastNow: number | null = null;
  let accumulatorMs = 0;
  let tickCount = 0;
  let discardedTotalMs = 0;

  const frame = (nowMs: number): AccumulatorStep => {
    // nowMs is the frame timestamp the scheduler hands over (requestAnimationFrame's argument,
    // the start of the display frame). It drives the accumulator and the wall clock delta, but it
    // is NOT when this callback started running: in a browser several milliseconds of scheduling
    // latency sit between the two, constant and independent of what the frame draws. Measuring
    // work from nowMs billed that latency as render cost (about 10 ms at every DPR on the dev
    // laptop, with the game's JS at under one percent of a CPU profile) and pinned the DPR ladder
    // below stepUpBelowMs forever. Work is timed from the moment the callback actually begins.
    const startedAt = scheduler.now();
    const elapsed = lastNow === null ? 0 : nowMs - lastNow;
    lastNow = nowMs;
    const step = stepAccumulator(accumulatorMs, elapsed, tickMs, maxSubsteps);
    accumulatorMs = step.accumulatorMs;
    discardedTotalMs += step.discardedMs;
    for (let i = 0; i < step.ticks; i += 1) {
      tickCount += 1;
      hooks.tick(tickCount, dtSeconds);
    }
    hooks.render(tickCount, accumulatorMs / tickMs);
    work.push(scheduler.now() - startedAt);
    delta.push(elapsed);
    return step;
  };

  const onFrame = (nowMs: number): void => {
    if (!running) return;
    frame(nowMs);
    if (running) handle = scheduler.requestFrame(onFrame);
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      lastNow = null;
      handle = scheduler.requestFrame(onFrame);
    },
    stop: () => {
      running = false;
      if (handle !== null) scheduler.cancelFrame(handle);
      handle = null;
    },
    isRunning: () => running,
    tickCount: () => tickCount,
    frame,
    stats: () => {
      const averageDeltaMs = delta.average();
      return Object.freeze({
        averageFrameMs: work.average(),
        lastFrameMs: work.last(),
        averageDeltaMs,
        fps: averageDeltaMs > 0 ? 1000 / averageDeltaMs : 0,
        tickCount,
        discardedMs: discardedTotalMs,
      });
    },
  };
}

/** Browser scheduler: requestAnimationFrame plus performance.now. Only touches window when called. */
export function createRafScheduler(): LoopScheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}
