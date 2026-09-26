/**
 * On screen controls for touch mode (config/device.ts): DOM buttons laid over the stage that feed
 * the same RawInputEvents the keyboard does, so the controller, the edges and the jetpack all
 * behave exactly as with keys. A button presses the first key bound to its action and releases it
 * when the finger lifts, which keeps rebinding and the Shift+ forms working without a second input
 * path. Each finger captures its own pointer, so walking and charging a shot at once works.
 *
 * Pointer events on the buttons stop here: the stage never sees them, so a tap on Fire is never a
 * click on the map (a targeted weapon) and never a drag of the camera. DOM only, not unit tested;
 * the key resolution it relies on is covered in tests/unit/ui/touch-controls.test.ts.
 */

import { SHIFT_PREFIX, type Action, type Keybinds } from '../config/keybinds.ts';
import type { InputSink } from '../engine/input-dom.ts';
import type { RawInputEvent } from '../engine/input.ts';

export type TouchControlsView = 'hidden' | 'play' | 'end';

export interface TouchControlsOptions {
  /** The stage; the controls layer is appended to it. */
  readonly root: HTMLElement;
  /** Read on every press, because main.ts rebuilds the input controller on a rebind. */
  readonly sink: () => InputSink;
  readonly binds: () => Keybinds;
  readonly onRestart: () => void;
}

export interface TouchControls {
  show(view: TouchControlsView): void;
  destroy(): void;
}

interface ButtonSpec {
  readonly label: string;
  readonly title: string;
  readonly className: string;
  readonly action?: Action;
  /** Zoom buttons send a wheel notch instead of a key. */
  readonly wheel?: number;
}

/** The key event pair for an action's first binding, or null when it has no binding. */
export function keyEventsFor(binds: Keybinds, action: Action): { readonly down: RawInputEvent; readonly up: RawInputEvent } | null {
  const key = binds[action][0];
  if (key === undefined) return null;
  const shift = key.startsWith(SHIFT_PREFIX);
  const code = shift ? key.slice(SHIFT_PREFIX.length) : key;
  return {
    down: { kind: 'key', type: 'down', code, shift },
    up: { kind: 'key', type: 'up', code, shift },
  };
}

const PAD: readonly ButtonSpec[] = [
  { label: '▲', title: 'Aim up', className: 'tc-up', action: 'aimUp' },
  { label: '◀', title: 'Walk left', className: 'tc-left', action: 'moveLeft' },
  { label: '▶', title: 'Walk right', className: 'tc-right', action: 'moveRight' },
  { label: '▼', title: 'Aim down', className: 'tc-down', action: 'aimDown' },
];

const ACTIONS: readonly ButtonSpec[] = [
  { label: 'Jump', title: 'Jump (hold to lift a jetpack)', className: 'tc-jump', action: 'jump' },
  { label: 'Flip', title: 'Backflip', className: 'tc-flip', action: 'backflip' },
  { label: 'FIRE', title: 'Hold to charge, release to fire', className: 'tc-fire', action: 'fire' },
];

const TOP: readonly ButtonSpec[] = [
  { label: 'Weapons', title: 'Open the weapon panel', className: 'tc-weapons', action: 'weaponPanel' },
  { label: '+', title: 'Zoom in', className: 'tc-zoom', wheel: -1 },
  { label: '−', title: 'Zoom out', className: 'tc-zoom', wheel: 1 },
  { label: 'II', title: 'Pause', className: 'tc-pause', action: 'pause' },
];

export function createTouchControls(options: TouchControlsOptions): TouchControls {
  const layer = document.createElement('div');
  layer.className = 'touch-controls';
  layer.hidden = true;

  const cleanups: (() => void)[] = [];
  const releaseAll: (() => void)[] = [];

  const makeButton = (spec: ButtonSpec, parent: HTMLElement): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tc-btn ${spec.className}`;
    button.textContent = spec.label;
    button.title = spec.title;
    button.setAttribute('aria-label', spec.title);
    // The key that was pressed, so the release matches it even if the bindings change mid press.
    let pressed: RawInputEvent | null = null;
    const release = (): void => {
      if (pressed === null) return;
      options.sink().push(pressed);
      pressed = null;
      button.classList.remove('is-down');
    };
    const onDown = (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (spec.wheel !== undefined) {
        options.sink().push({ kind: 'wheel', deltaY: spec.wheel });
        return;
      }
      if (spec.action === undefined || pressed !== null) return;
      const events = keyEventsFor(options.binds(), spec.action);
      if (events === null) return;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // A synthetic or already released pointer cannot be captured; the up still arrives.
      }
      options.sink().push(events.down);
      pressed = events.up;
      button.classList.add('is-down');
    };
    const onUp = (event: PointerEvent): void => {
      event.stopPropagation();
      release();
    };
    const swallow = (event: Event): void => {
      event.stopPropagation();
    };
    const noMenu = (event: Event): void => event.preventDefault();
    button.addEventListener('pointerdown', onDown);
    button.addEventListener('pointerup', onUp);
    button.addEventListener('pointercancel', onUp);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('pointermove', swallow);
    button.addEventListener('contextmenu', noMenu);
    releaseAll.push(release);
    cleanups.push(() => {
      button.removeEventListener('pointerdown', onDown);
      button.removeEventListener('pointerup', onUp);
      button.removeEventListener('pointercancel', onUp);
      button.removeEventListener('lostpointercapture', release);
      button.removeEventListener('pointermove', swallow);
      button.removeEventListener('contextmenu', noMenu);
    });
    parent.append(button);
  };

  const group = (className: string, specs: readonly ButtonSpec[]): HTMLElement => {
    const element = document.createElement('div');
    element.className = `tc-group ${className}`;
    for (const spec of specs) makeButton(spec, element);
    layer.append(element);
    return element;
  };

  const pad = group('tc-pad', PAD);
  const actions = group('tc-actions', ACTIONS);
  const top = group('tc-top', TOP);

  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'tc-btn tc-restart';
  restart.textContent = 'Play again';
  const onRestart = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    options.onRestart();
  };
  restart.addEventListener('pointerdown', onRestart);
  cleanups.push(() => restart.removeEventListener('pointerdown', onRestart));
  layer.append(restart);

  options.root.append(layer);

  let view: TouchControlsView = 'hidden';
  return {
    show: (next) => {
      if (next === view) return;
      view = next;
      // A button hidden under a finger never gets its pointerup: release it now.
      for (const release of releaseAll) release();
      layer.hidden = next === 'hidden';
      pad.hidden = next !== 'play';
      actions.hidden = next !== 'play';
      top.hidden = next !== 'play';
      restart.hidden = next !== 'end';
    },
    destroy: () => {
      for (const release of releaseAll) release();
      for (const cleanup of cleanups) cleanup();
      layer.remove();
    },
  };
}
