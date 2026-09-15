/**
 * Animation clock (architecture.md section G, worm animation states). Pure functions resolve
 * an elapsed time to a frame given fps and the loop flag; one shot animations clamp on their
 * last frame and report completion exactly once, on the update that crosses the end. The
 * Animator wrapper holds one state record and publishes completion through the event bus so
 * the worm controller can chain land into idle or die into a gravestone.
 */

import { createEventBus, type Unsubscribe } from '../core/events.ts';
import type { AtlasAnimation } from './atlas-schema.ts';

export interface AnimState {
  readonly name: string;
  readonly elapsedMs: number;
  /** True once a one shot animation has reached its end; loops never finish. */
  readonly done: boolean;
}

export interface AdvanceResult {
  readonly state: AnimState;
  /** True only on the advance that finished a one shot animation. */
  readonly completed: boolean;
}

export function startAnim(name: string): AnimState {
  return Object.freeze({ name, elapsedMs: 0, done: false });
}

export function animDurationMs(def: AtlasAnimation): number {
  return (def.frames.length / def.fps) * 1000;
}

/** Frame index for an elapsed time; loops wrap, one shots clamp on the last frame. */
export function frameIndexAt(elapsedMs: number, fps: number, frameCount: number, loop: boolean): number {
  if (frameCount <= 0) return 0;
  const raw = Math.floor((Math.max(0, elapsedMs) * fps) / 1000);
  return loop ? raw % frameCount : Math.min(raw, frameCount - 1);
}

export function advanceAnim(state: AnimState, dtMs: number, def: AtlasAnimation): AdvanceResult {
  const duration = animDurationMs(def);
  const elapsed = state.elapsedMs + Math.max(0, dtMs);
  if (def.loop) {
    const wrapped = duration > 0 ? elapsed % duration : 0;
    return Object.freeze({ state: Object.freeze({ ...state, elapsedMs: wrapped }), completed: false });
  }
  const done = elapsed >= duration;
  return Object.freeze({
    state: Object.freeze({ ...state, elapsedMs: Math.min(elapsed, duration), done }),
    completed: done && !state.done,
  });
}

export function currentFrameId(state: AnimState, def: AtlasAnimation): string | undefined {
  return def.frames[frameIndexAt(state.elapsedMs, def.fps, def.frames.length, def.loop)];
}

export interface AnimationSource {
  animation(name: string): AtlasAnimation | undefined;
}

export interface PlayOptions {
  /** Restart even when this animation is already playing. */
  readonly restart?: boolean;
}

interface AnimatorEvents extends Record<string, unknown> {
  readonly complete: { readonly name: string };
}

export interface Animator {
  state(): AnimState;
  /** Switches animation; a repeated name is ignored unless restart is set. Unknown names are ignored. */
  play(name: string, options?: PlayOptions): boolean;
  update(dtMs: number): void;
  frameId(): string | undefined;
  onComplete(listener: (event: { readonly name: string }) => void): Unsubscribe;
}

export function createAnimator(source: AnimationSource, initial: string): Animator {
  const bus = createEventBus<AnimatorEvents>();
  // The one mutable cell: replaced (never mutated) on every update.
  let state = startAnim(initial);

  return {
    state: () => state,
    play: (name, options = {}) => {
      if (source.animation(name) === undefined) return false;
      if (state.name === name && !(options.restart ?? false)) return false;
      state = startAnim(name);
      return true;
    },
    update: (dtMs) => {
      const def = source.animation(state.name);
      if (def === undefined) return;
      const result = advanceAnim(state, dtMs, def);
      state = result.state;
      if (result.completed) bus.emit('complete', { name: state.name });
    },
    frameId: () => {
      const def = source.animation(state.name);
      return def === undefined ? undefined : currentFrameId(state, def);
    },
    onComplete: (listener) => bus.on('complete', listener),
  };
}
