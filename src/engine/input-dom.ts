/**
 * DOM binder for engine/input.ts: the only file in the input path that touches browser events.
 * It translates keyboard, pointer, wheel and blur events into RawInputEvents and pushes them
 * into the controller. Bound keys have their default action prevented so Tab never leaves the
 * canvas, Space never scrolls and F keys never open browser tools. Not unit tested (DOM only);
 * kept thin on purpose.
 */

import { bareKeyCode, type Keybinds } from '../config/keybinds.ts';
import type { RawInputEvent } from './input.ts';

export interface InputSink {
  push(event: RawInputEvent): void;
}

export interface DomInputOptions {
  /** Element whose bounding box is the pointer origin, normally the stage. */
  readonly pointerTarget: HTMLElement;
  /** Receives keyboard and blur events, normally window. */
  readonly keyTarget: Window;
  readonly binds: Keybinds;
}

/**
 * The physical codes the game consumes. Modifier prefixes are stripped, because this set is
 * matched against KeyboardEvent.code to decide preventDefault: "Shift+KeyQ" must claim the Q key.
 */
export function boundKeyCodes(binds: Keybinds): ReadonlySet<string> {
  return new Set(Object.values(binds).flat().map(bareKeyCode));
}

/** Attaches listeners and returns the function that detaches them. */
export function bindDomInput(sink: InputSink, options: DomInputOptions): () => void {
  const { pointerTarget, keyTarget } = options;
  const bound = boundKeyCodes(options.binds);

  const onKey = (type: 'down' | 'up') => (event: KeyboardEvent): void => {
    if (!bound.has(event.code)) return;
    event.preventDefault();
    sink.push({ kind: 'key', type, code: event.code, shift: event.shiftKey });
  };
  const onKeyDown = onKey('down');
  const onKeyUp = onKey('up');

  const onPointer = (type: 'move' | 'down' | 'up') => (event: PointerEvent): void => {
    const rect = pointerTarget.getBoundingClientRect();
    sink.push({ kind: 'pointer', type, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const onPointerMove = onPointer('move');
  const onPointerDown = onPointer('down');
  const onPointerUp = onPointer('up');

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    sink.push({ kind: 'wheel', deltaY: event.deltaY });
  };
  const onBlur = (): void => sink.push({ kind: 'blur' });
  const onContextMenu = (event: Event): void => event.preventDefault();

  keyTarget.addEventListener('keydown', onKeyDown);
  keyTarget.addEventListener('keyup', onKeyUp);
  keyTarget.addEventListener('blur', onBlur);
  pointerTarget.addEventListener('pointermove', onPointerMove);
  pointerTarget.addEventListener('pointerdown', onPointerDown);
  pointerTarget.addEventListener('pointerup', onPointerUp);
  pointerTarget.addEventListener('wheel', onWheel, { passive: false });
  pointerTarget.addEventListener('contextmenu', onContextMenu);

  return () => {
    keyTarget.removeEventListener('keydown', onKeyDown);
    keyTarget.removeEventListener('keyup', onKeyUp);
    keyTarget.removeEventListener('blur', onBlur);
    pointerTarget.removeEventListener('pointermove', onPointerMove);
    pointerTarget.removeEventListener('pointerdown', onPointerDown);
    pointerTarget.removeEventListener('pointerup', onPointerUp);
    pointerTarget.removeEventListener('wheel', onWheel);
    pointerTarget.removeEventListener('contextmenu', onContextMenu);
  };
}
