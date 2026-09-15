import { describe, expect, it } from 'vitest';
import type { AtlasAnimation } from '@/engine/atlas-schema.ts';
import {
  advanceAnim,
  animDurationMs,
  createAnimator,
  currentFrameId,
  frameIndexAt,
  startAnim,
} from '@/engine/animator.ts';

const walk: AtlasAnimation = Object.freeze({
  frames: Object.freeze(Array.from({ length: 12 }, (_, i) => `walk_${i}`)),
  fps: 18,
  loop: true,
});

const jump: AtlasAnimation = Object.freeze({
  frames: Object.freeze(['jump_0', 'jump_1', 'jump_2', 'jump_3', 'jump_4', 'jump_5']),
  fps: 12,
  loop: false,
});

const source = {
  animation: (name: string) => (name === 'walk' ? walk : name === 'jump' ? jump : undefined),
};

describe('animator: frame resolution', () => {
  it('computes durations from frame count and fps', () => {
    expect(animDurationMs(walk)).toBeCloseTo(666.667, 3);
    expect(animDurationMs(jump)).toBe(500);
  });

  it('indexes frames by elapsed time, wrapping loops and clamping one shots', () => {
    expect(frameIndexAt(0, 18, 12, true)).toBe(0);
    expect(frameIndexAt(56, 18, 12, true)).toBe(1);
    expect(frameIndexAt(700, 18, 12, true)).toBe(0);
    expect(frameIndexAt(1000, 12, 6, false)).toBe(5);
    expect(frameIndexAt(-5, 12, 6, false)).toBe(0);
    expect(frameIndexAt(100, 12, 0, false)).toBe(0);
  });

  it('resolves the frame id of a state', () => {
    expect(currentFrameId(startAnim('walk'), walk)).toBe('walk_0');
    expect(currentFrameId({ name: 'jump', elapsedMs: 250, done: false }, jump)).toBe('jump_3');
  });
});

describe('animator: advance', () => {
  it('loops wrap and never complete', () => {
    let state = startAnim('walk');
    let completed = false;
    for (let i = 0; i < 100; i += 1) {
      const result = advanceAnim(state, 16, walk);
      state = result.state;
      completed = completed || result.completed;
    }
    expect(completed).toBe(false);
    expect(state.done).toBe(false);
    expect(state.elapsedMs).toBeLessThan(animDurationMs(walk));
    expect(state.elapsedMs).toBeCloseTo(1600 % animDurationMs(walk), 6);
  });

  it('one shots clamp on the last frame and complete exactly once', () => {
    let state = startAnim('jump');
    const completions: number[] = [];
    for (let i = 1; i <= 40; i += 1) {
      const result = advanceAnim(state, 16, jump);
      state = result.state;
      if (result.completed) completions.push(i);
    }
    expect(completions).toEqual([32]);
    expect(state.done).toBe(true);
    expect(state.elapsedMs).toBe(500);
    expect(currentFrameId(state, jump)).toBe('jump_5');
  });

  it('returns frozen records and ignores negative dt', () => {
    const state = startAnim('jump');
    const result = advanceAnim(state, -100, jump);
    expect(result.state.elapsedMs).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
  });
});

describe('animator: stateful wrapper', () => {
  it('plays, updates and reports the frame id', () => {
    const animator = createAnimator(source, 'walk');
    expect(animator.frameId()).toBe('walk_0');
    animator.update(120);
    expect(animator.frameId()).toBe('walk_2');
    expect(animator.play('jump')).toBe(true);
    expect(animator.state()).toEqual({ name: 'jump', elapsedMs: 0, done: false });
  });

  it('ignores a repeated play unless restart is set, and unknown names', () => {
    const animator = createAnimator(source, 'jump');
    animator.update(100);
    expect(animator.play('jump')).toBe(false);
    expect(animator.state().elapsedMs).toBe(100);
    expect(animator.play('jump', { restart: true })).toBe(true);
    expect(animator.state().elapsedMs).toBe(0);
    expect(animator.play('nope')).toBe(false);
    expect(animator.state().name).toBe('jump');
  });

  it('emits complete once for a one shot and supports unsubscribe', () => {
    const animator = createAnimator(source, 'jump');
    const names: string[] = [];
    const off = animator.onComplete((e) => names.push(e.name));
    for (let i = 0; i < 60; i += 1) animator.update(16);
    expect(names).toEqual(['jump']);
    off();
    animator.play('jump', { restart: true });
    for (let i = 0; i < 60; i += 1) animator.update(16);
    expect(names).toEqual(['jump']);
  });

  it('does nothing when the initial animation is unknown', () => {
    const animator = createAnimator(source, 'nope');
    animator.update(16);
    expect(animator.frameId()).toBeUndefined();
  });
});
