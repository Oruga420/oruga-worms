/**
 * Input (architecture.md section I, engine/input.ts): raw keyboard, pointer and wheel events
 * reduce into an immutable InputState, and once per simulation tick the state is sampled into
 * an Intent the worm controller and the weapon system read. Nothing here touches the DOM; the
 * thin binder in input-dom.ts feeds RawInputEvents in, so the whole reducer is unit tested.
 *
 * Edge semantics: jump, backflip, slot, fuse, panel and pause fire on the tick of the key press;
 * move and aim are held; fire reports held and the release edge (the power bar charges while
 * held and the shot leaves on release).
 *
 * Modifiers: a raw key event carries a shift flag, and a bind may name the shifted form of a code
 * ("Shift+KeyQ" opens the weapon panel). Press resolves the shifted bind first and falls back to
 * the bare code; release drops both, because shift is usually let go before the key.
 */

import { fuseIndex, keyToActionMap, shiftedKeyCode, slotIndex, type Action, type Keybinds } from '../config/keybinds.ts';
import { vec2, type Vec2 } from '../core/math.ts';

export type RawInputEvent =
  | { readonly kind: 'key'; readonly type: 'down' | 'up'; readonly code: string; readonly shift?: boolean }
  | { readonly kind: 'pointer'; readonly type: 'move' | 'down' | 'up'; readonly x: number; readonly y: number }
  | { readonly kind: 'wheel'; readonly deltaY: number }
  | { readonly kind: 'blur' };

export interface InputState {
  readonly held: ReadonlySet<Action>;
  readonly pressed: ReadonlySet<Action>;
  readonly released: ReadonlySet<Action>;
  /** Pointer in CSS px relative to the stage. */
  readonly pointerScreen: Vec2;
  readonly pointerDown: boolean;
  readonly pointerClicked: boolean;
  /** Wheel notches this tick, positive means zoom in. */
  readonly wheelNotches: number;
}

const EMPTY: ReadonlySet<Action> = Object.freeze(new Set<Action>());

export const INITIAL_INPUT_STATE: InputState = Object.freeze({
  held: EMPTY,
  pressed: EMPTY,
  released: EMPTY,
  pointerScreen: vec2(0, 0),
  pointerDown: false,
  pointerClicked: false,
  wheelNotches: 0,
});

export interface Intent {
  readonly moveX: -1 | 0 | 1;
  readonly jump: boolean;
  readonly backflip: boolean;
  readonly aimDelta: -1 | 0 | 1;
  readonly fireHeld: boolean;
  /** Jump key held this tick: thrust for a worm on a jetpack. */
  readonly thrust: boolean;
  readonly fireReleased: boolean;
  /** Weapon slot 1..9 pressed this tick, else null. */
  readonly selectedSlot: number | null;
  /** Fuse 1..5 pressed this tick, else null. */
  readonly fuse: number | null;
  readonly panelToggle: boolean;
  readonly pause: boolean;
  /** Pointer in world px through the camera. */
  readonly pointer: Vec2;
  readonly pointerScreen: Vec2;
  readonly pointerDown: boolean;
  readonly pointerClicked: boolean;
  readonly zoomNotches: number;
}

export const IDLE_INTENT: Intent = Object.freeze({
  moveX: 0,
  jump: false,
  backflip: false,
  aimDelta: 0,
  fireHeld: false,
  thrust: false,
  fireReleased: false,
  selectedSlot: null,
  fuse: null,
  panelToggle: false,
  pause: false,
  pointer: vec2(0, 0),
  pointerScreen: vec2(0, 0),
  pointerDown: false,
  pointerClicked: false,
  zoomNotches: 0,
});

function withAdded(set: ReadonlySet<Action>, action: Action): ReadonlySet<Action> {
  if (set.has(action)) return set;
  const next = new Set(set);
  next.add(action);
  return Object.freeze(next);
}

function withRemoved(set: ReadonlySet<Action>, action: Action): ReadonlySet<Action> {
  if (!set.has(action)) return set;
  const next = new Set(set);
  next.delete(action);
  return Object.freeze(next);
}

function reduceKey(state: InputState, type: 'down' | 'up', action: Action): InputState {
  if (type === 'down') {
    // Browser auto repeat re sends keydown while held; only the first one is a press.
    if (state.held.has(action)) return state;
    return Object.freeze({ ...state, held: withAdded(state.held, action), pressed: withAdded(state.pressed, action) });
  }
  if (!state.held.has(action)) return state;
  return Object.freeze({ ...state, held: withRemoved(state.held, action), released: withAdded(state.released, action) });
}

/** Pure reducer from one raw event to the next state; unknown keys leave the state untouched. */
export function reduceInput(state: InputState, event: RawInputEvent, keyMap: ReadonlyMap<string, Action>): InputState {
  switch (event.kind) {
    case 'key': {
      const shifted = keyMap.get(shiftedKeyCode(event.code));
      const bare = keyMap.get(event.code);
      if (event.type === 'down') {
        // The shifted binding wins when shift is down, so Shift+Q opens the panel; without shift,
        // or when nothing is bound to the shifted form, the bare code applies and Shift plus an
        // arrow key still walks.
        const action = (event.shift === true ? shifted : undefined) ?? bare;
        return action === undefined ? state : reduceKey(state, 'down', action);
      }
      // On release, drop BOTH resolutions regardless of the modifier state: shift is often let go
      // before the key itself, and a held action that never gets released can never be pressed again.
      let next = state;
      if (shifted !== undefined) next = reduceKey(next, 'up', shifted);
      if (bare !== undefined && bare !== shifted) next = reduceKey(next, 'up', bare);
      return next;
    }
    case 'pointer': {
      const pointerScreen = vec2(event.x, event.y);
      if (event.type === 'move') return Object.freeze({ ...state, pointerScreen });
      if (event.type === 'down') return Object.freeze({ ...state, pointerScreen, pointerDown: true });
      return Object.freeze({ ...state, pointerScreen, pointerDown: false, pointerClicked: state.pointerDown || state.pointerClicked });
    }
    case 'wheel': {
      if (event.deltaY === 0) return state;
      return Object.freeze({ ...state, wheelNotches: state.wheelNotches + (event.deltaY < 0 ? 1 : -1) });
    }
    case 'blur':
      // Focus loss drops every key: the keyup events will never arrive.
      return Object.freeze({ ...state, held: EMPTY, released: state.held, pointerDown: false });
  }
}

/** Clears the per tick edges after the intent has been sampled. */
export function endTick(state: InputState): InputState {
  return Object.freeze({ ...state, pressed: EMPTY, released: EMPTY, pointerClicked: false, wheelNotches: 0 });
}

function axis(state: InputState, negative: Action, positive: Action): -1 | 0 | 1 {
  const n = state.held.has(negative);
  const p = state.held.has(positive);
  if (n === p) return 0;
  return p ? 1 : -1;
}

function firstIndex(pressed: ReadonlySet<Action>, indexOf: (action: Action) => number | null): number | null {
  for (const action of pressed) {
    const index = indexOf(action);
    if (index !== null) return index;
  }
  return null;
}

/** Samples the state into a frozen Intent; toWorld maps screen px to world px through the camera. */
export function buildIntent(state: InputState, toWorld: (screen: Vec2) => Vec2): Intent {
  return Object.freeze({
    moveX: axis(state, 'moveLeft', 'moveRight'),
    jump: state.pressed.has('jump'),
    backflip: state.pressed.has('backflip'),
    aimDelta: axis(state, 'aimDown', 'aimUp'),
    fireHeld: state.held.has('fire'),
    thrust: state.held.has('jump') || state.held.has('aimUp'),
    fireReleased: state.released.has('fire'),
    selectedSlot: firstIndex(state.pressed, slotIndex),
    fuse: firstIndex(state.pressed, fuseIndex),
    panelToggle: state.pressed.has('weaponPanel'),
    pause: state.pressed.has('pause'),
    pointer: toWorld(state.pointerScreen),
    pointerScreen: state.pointerScreen,
    pointerDown: state.pointerDown,
    pointerClicked: state.pointerClicked,
    zoomNotches: state.wheelNotches,
  });
}

export interface InputController {
  push(event: RawInputEvent): void;
  /** Builds this tick's intent and clears the edges. Call exactly once per tick. */
  sample(toWorld: (screen: Vec2) => Vec2): Intent;
  state(): InputState;
  reset(): void;
}

export function createInputController(binds: Keybinds): InputController {
  const keyMap = keyToActionMap(binds);
  // The one mutable cell: replaced, never mutated, on each event.
  let state = INITIAL_INPUT_STATE;
  return {
    push: (event) => {
      state = reduceInput(state, event, keyMap);
    },
    sample: (toWorld) => {
      const intent = buildIntent(state, toWorld);
      state = endTick(state);
      return intent;
    },
    state: () => state,
    reset: () => {
      state = INITIAL_INPUT_STATE;
    },
  };
}
