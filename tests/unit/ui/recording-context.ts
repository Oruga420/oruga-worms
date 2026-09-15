import type { Ctx2D } from '@/engine/canvas-types.ts';

export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface RecordingContext extends Ctx2D {
  readonly calls: RecordedCall[];
}

/**
 * A Ctx2D stand in that records every method call and accepts every property assignment, so a
 * screen or widget can be drawn in a unit test and asserted on ("did it fill a rect, did it write
 * this label") without a canvas. Gradients and measurements return inert objects.
 */
export function createRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const props: Record<string | symbol, unknown> = {};
  const target = { calls };
  return new Proxy(target, {
    get(_t, name) {
      if (name === 'calls') return calls;
      if (name in props) return props[name];
      if (name === 'createLinearGradient' || name === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (name === 'measureText') return (text: string) => ({ width: String(text).length * 7 });
      return (...args: unknown[]) => {
        calls.push({ name: String(name), args });
        return undefined;
      };
    },
    set(_t, name, value) {
      props[name] = value;
      return true;
    },
  }) as unknown as RecordingContext;
}
