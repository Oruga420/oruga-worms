import { describe, expect, it } from 'vitest';
import { MAX_SUBSTEPS, TICK_MS } from '@/config/units.ts';
import { createFrameSampler, createLoop, stepAccumulator, type LoopScheduler } from '@/core/loop.ts';

/** Fake clock and frame queue standing in for requestAnimationFrame. */
function fakeScheduler() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, (nowMs: number) => void>();
  const scheduler: LoopScheduler = {
    now: () => now,
    requestFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      pending.delete(handle);
    },
  };
  return {
    scheduler,
    /** Advances the clock and runs every queued frame callback once. */
    advance: (ms: number) => {
      now += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    },
    /** Lets a frame callback pretend to take this long. */
    spend: (ms: number) => {
      now += ms;
    },
    pendingCount: () => pending.size,
  };
}

describe('loop: stepAccumulator', () => {
  it('runs one tick per 16.667 ms and carries the remainder', () => {
    const step = stepAccumulator(0, 20);
    expect(step.ticks).toBe(1);
    expect(step.accumulatorMs).toBeCloseTo(20 - TICK_MS, 9);
    expect(step.discardedMs).toBe(0);
  });

  it('runs zero ticks on a short frame and keeps accumulating', () => {
    const first = stepAccumulator(0, 10);
    expect(first.ticks).toBe(0);
    expect(first.accumulatorMs).toBe(10);
    const second = stepAccumulator(first.accumulatorMs, 10);
    expect(second.ticks).toBe(1);
    expect(second.accumulatorMs).toBeCloseTo(20 - TICK_MS, 9);
  });

  it('caps at MAX_SUBSTEPS and discards the leftover', () => {
    const step = stepAccumulator(0, 1000);
    expect(step.ticks).toBe(MAX_SUBSTEPS);
    expect(step.accumulatorMs).toBe(0);
    expect(step.discardedMs).toBeCloseTo(1000 - MAX_SUBSTEPS * TICK_MS, 9);
  });

  it('runs exactly the cap without discarding when the frame fits', () => {
    const step = stepAccumulator(0, MAX_SUBSTEPS * TICK_MS + 1);
    expect(step.ticks).toBe(MAX_SUBSTEPS);
    expect(step.accumulatorMs).toBeCloseTo(1, 9);
    expect(step.discardedMs).toBe(0);
  });

  it('ignores negative elapsed time', () => {
    const step = stepAccumulator(5, -50);
    expect(step.ticks).toBe(0);
    expect(step.accumulatorMs).toBe(5);
  });

  it('honours custom tick and cap', () => {
    const step = stepAccumulator(0, 100, 10, 3);
    expect(step.ticks).toBe(3);
    expect(step.discardedMs).toBe(70);
  });

  it('returns a frozen result', () => {
    expect(Object.isFrozen(stepAccumulator(0, 20))).toBe(true);
  });
});

describe('loop: frame sampler', () => {
  it('averages over the window and forgets old samples', () => {
    const sampler = createFrameSampler(3);
    expect(sampler.average()).toBe(0);
    sampler.push(10);
    sampler.push(20);
    expect(sampler.average()).toBe(15);
    sampler.push(30);
    sampler.push(40);
    expect(sampler.average()).toBe(30);
    expect(sampler.last()).toBe(40);
    expect(sampler.count()).toBe(3);
  });

  it('treats bad samples as zero and resets', () => {
    const sampler = createFrameSampler(2);
    sampler.push(Number.NaN);
    sampler.push(-5);
    expect(sampler.average()).toBe(0);
    sampler.push(8);
    sampler.reset();
    expect(sampler.count()).toBe(0);
    expect(sampler.average()).toBe(0);
  });
});

describe('loop: createLoop with a fake clock', () => {
  it('ticks at 60 Hz regardless of the frame cadence', () => {
    const clock = fakeScheduler();
    const ticks: number[] = [];
    const renders: number[] = [];
    const loop = createLoop(
      { tick: (n) => ticks.push(n), render: (n) => renders.push(n) },
      clock.scheduler,
    );
    loop.start();
    expect(loop.isRunning()).toBe(true);
    clock.advance(0);
    // Irregular frame deltas (all under the cap) that add up to 1010 ms of wall clock.
    const deltas = [7, 33, 16, 20, 12, 41, 16, 16, 9, 30, 16, 60, 16, 16, 24, 16, 50, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16];
    for (const delta of deltas) clock.advance(delta);
    const total = deltas.reduce((sum, d) => sum + d, 0);
    // The invariant: ticks run equals wall clock elapsed over the tick length, whatever the cadence.
    const expected = Math.floor(total / TICK_MS);
    expect(Math.abs(total / TICK_MS - Math.round(total / TICK_MS))).toBeGreaterThan(0.05);
    expect(loop.tickCount()).toBe(expected);
    expect(ticks).toEqual(Array.from({ length: expected }, (_, i) => i + 1));
    expect(renders).toHaveLength(deltas.length + 1);
  });

  it('passes dt in seconds and renders after the ticks of the frame', () => {
    const clock = fakeScheduler();
    const order: string[] = [];
    const loop = createLoop(
      {
        tick: (n, dt) => {
          expect(dt).toBeCloseTo(1 / 60, 12);
          order.push(`tick${n}`);
        },
        render: (n) => order.push(`render${n}`),
      },
      clock.scheduler,
    );
    loop.start();
    clock.advance(0);
    clock.advance(40);
    expect(order).toEqual(['render0', 'tick1', 'tick2', 'render2']);
  });

  it('never runs more than MAX_SUBSTEPS ticks in a frame and discards the rest', () => {
    const clock = fakeScheduler();
    let ticksThisFrame = 0;
    let maxInFrame = 0;
    const loop = createLoop(
      {
        tick: () => {
          ticksThisFrame += 1;
        },
        render: () => {
          maxInFrame = Math.max(maxInFrame, ticksThisFrame);
          ticksThisFrame = 0;
        },
      },
      clock.scheduler,
    );
    loop.start();
    clock.advance(0);
    clock.advance(3000);
    expect(maxInFrame).toBe(MAX_SUBSTEPS);
    expect(loop.tickCount()).toBe(MAX_SUBSTEPS);
    expect(loop.stats().discardedMs).toBeCloseTo(3000 - MAX_SUBSTEPS * TICK_MS, 6);
    clock.advance(17);
    expect(loop.tickCount()).toBe(MAX_SUBSTEPS + 1);
  });

  it('samples the work per frame for the DPR policy', () => {
    const clock = fakeScheduler();
    const loop = createLoop(
      {
        tick: () => {},
        render: () => {
          clock.spend(12);
        },
      },
      clock.scheduler,
      { sampleWindow: 4 },
    );
    loop.start();
    clock.advance(0);
    clock.advance(16);
    clock.advance(16);
    const stats = loop.stats();
    expect(stats.lastFrameMs).toBe(12);
    expect(stats.averageFrameMs).toBe(12);
    expect(stats.averageDeltaMs).toBeGreaterThan(0);
    expect(stats.fps).toBeGreaterThan(0);
  });

  it('bills only the work inside the callback, never the scheduling latency before it', () => {
    // requestAnimationFrame hands over the display frame's start time, but the callback runs
    // some milliseconds later. That gap is not render work: with the old measurement it made a
    // 2 ms frame read as 8 to 10 ms at every DPR and froze the ladder below stepUpBelowMs.
    const clock = fakeScheduler();
    const loop = createLoop(
      {
        tick: () => {},
        render: () => {
          clock.spend(2);
        },
      },
      clock.scheduler,
      { sampleWindow: 4 },
    );
    clock.spend(100);
    // The frame timestamp is 8 ms behind the clock when the callback starts.
    loop.frame(92);
    expect(loop.stats().lastFrameMs).toBe(2);
    clock.spend(12);
    // Next display frame 16 ms later; the callback is now 6 ms late.
    loop.frame(108);
    expect(loop.stats().lastFrameMs).toBe(2);
    expect(loop.stats().averageFrameMs).toBe(2);
    // The wall clock delta still follows the frame timestamps, not the callback times.
    expect(loop.stats().averageDeltaMs).toBe(8);
  });

  it('stops cleanly and cancels the pending frame', () => {
    const clock = fakeScheduler();
    const loop = createLoop({ tick: () => {}, render: () => {} }, clock.scheduler);
    loop.start();
    expect(clock.pendingCount()).toBe(1);
    loop.stop();
    expect(clock.pendingCount()).toBe(0);
    expect(loop.isRunning()).toBe(false);
    clock.advance(100);
    expect(loop.tickCount()).toBe(0);
  });

  it('start is idempotent and restarting does not replay the gap', () => {
    const clock = fakeScheduler();
    const loop = createLoop({ tick: () => {}, render: () => {} }, clock.scheduler);
    loop.start();
    loop.start();
    expect(clock.pendingCount()).toBe(1);
    clock.advance(0);
    clock.advance(1000 / 60);
    loop.stop();
    clock.spend(10_000);
    loop.start();
    clock.advance(0);
    expect(loop.tickCount()).toBe(1);
  });

  it('frame can be driven by hand', () => {
    const clock = fakeScheduler();
    const loop = createLoop({ tick: () => {}, render: () => {} }, clock.scheduler);
    loop.frame(0);
    const step = loop.frame(51);
    expect(step.ticks).toBe(3);
    expect(loop.tickCount()).toBe(3);
  });
});
