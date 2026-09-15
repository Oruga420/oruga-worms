import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS, keyToActionMap } from '@/config/keybinds.ts';
import { vec2, type Vec2 } from '@/core/math.ts';
import {
  INITIAL_INPUT_STATE,
  buildIntent,
  createInputController,
  endTick,
  reduceInput,
  type InputState,
  type RawInputEvent,
} from '@/engine/input.ts';

const keyMap = keyToActionMap(DEFAULT_KEYBINDS);
const identity = (p: Vec2): Vec2 => p;

function run(events: readonly RawInputEvent[], from: InputState = INITIAL_INPUT_STATE): InputState {
  return events.reduce((state, event) => reduceInput(state, event, keyMap), from);
}

const down = (code: string): RawInputEvent => ({ kind: 'key', type: 'down', code });
const up = (code: string): RawInputEvent => ({ kind: 'key', type: 'up', code });

describe('input: key reducer', () => {
  it.each(['ArrowUp', 'KeyW', 'Enter'])('holds jetpack thrust with %s and releases it', (key) => {
    const state = run([down(key)]);
    expect(buildIntent(state, identity).thrust).toBe(true);
    expect(buildIntent(endTick(state), identity).thrust).toBe(true);
    expect(buildIntent(run([up(key)], state), identity).thrust).toBe(false);
  });
  it('tracks held keys through their actions and ignores unbound keys', () => {
    const state = run([down('ArrowLeft'), down('KeyZ')]);
    expect(state.held.has('moveLeft')).toBe(true);
    expect(state.pressed.has('moveLeft')).toBe(true);
    expect(state.held.size).toBe(1);
    expect(run([down('KeyZ')])).toBe(INITIAL_INPUT_STATE);
  });

  it('treats browser auto repeat as one press', () => {
    const state = run([down('Space'), down('Space'), down('Space')]);
    expect(state.pressed.has('fire')).toBe(true);
    const cleared = endTick(state);
    const repeated = run([down('Space')], cleared);
    expect(repeated.pressed.has('fire')).toBe(false);
    expect(repeated.held.has('fire')).toBe(true);
  });

  it('records releases only for keys that were held', () => {
    const state = run([down('Enter'), up('Enter'), up('Backspace')]);
    expect(state.held.size).toBe(0);
    expect(state.released.has('jump')).toBe(true);
    expect(state.released.has('backflip')).toBe(false);
  });

  it('never mutates a previous state', () => {
    const first = run([down('ArrowLeft')]);
    const second = run([down('ArrowRight')], first);
    expect(first.held.has('moveRight')).toBe(false);
    expect(second.held.has('moveLeft')).toBe(true);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it('drops every held key on blur and reports them released', () => {
    const state = run([down('ArrowLeft'), down('Space'), { kind: 'pointer', type: 'down', x: 1, y: 1 }, { kind: 'blur' }]);
    expect(state.held.size).toBe(0);
    expect(state.released.has('moveLeft')).toBe(true);
    expect(state.released.has('fire')).toBe(true);
    expect(state.pointerDown).toBe(false);
  });
});

describe('input: pointer and wheel', () => {
  it('tracks the pointer position, button and click edge', () => {
    const moved = run([{ kind: 'pointer', type: 'move', x: 10, y: 20 }]);
    expect(moved.pointerScreen).toEqual({ x: 10, y: 20 });
    const pressed = run([{ kind: 'pointer', type: 'down', x: 11, y: 21 }], moved);
    expect(pressed.pointerDown).toBe(true);
    expect(pressed.pointerClicked).toBe(false);
    const released = run([{ kind: 'pointer', type: 'up', x: 12, y: 22 }], pressed);
    expect(released.pointerDown).toBe(false);
    expect(released.pointerClicked).toBe(true);
    expect(released.pointerScreen).toEqual({ x: 12, y: 22 });
    expect(endTick(released).pointerClicked).toBe(false);
  });

  it('accumulates wheel notches with zoom in for negative deltaY', () => {
    const state = run([{ kind: 'wheel', deltaY: -100 }, { kind: 'wheel', deltaY: -3 }, { kind: 'wheel', deltaY: 50 }, { kind: 'wheel', deltaY: 0 }]);
    expect(state.wheelNotches).toBe(1);
    expect(endTick(state).wheelNotches).toBe(0);
  });
});

describe('input: intent', () => {
  it('is idle from the initial state', () => {
    const intent = buildIntent(INITIAL_INPUT_STATE, identity);
    expect(intent).toMatchObject({ moveX: 0, jump: false, aimDelta: 0, fireHeld: false, selectedSlot: null, fuse: null });
    expect(Object.isFrozen(intent)).toBe(true);
  });

  it('turns held movement and aim keys into axes, opposite keys cancel', () => {
    expect(buildIntent(run([down('KeyA')]), identity).moveX).toBe(-1);
    expect(buildIntent(run([down('ArrowRight')]), identity).moveX).toBe(1);
    expect(buildIntent(run([down('ArrowLeft'), down('ArrowRight')]), identity).moveX).toBe(0);
    expect(buildIntent(run([down('ArrowUp')]), identity).aimDelta).toBe(1);
    expect(buildIntent(run([down('KeyS')]), identity).aimDelta).toBe(-1);
  });

  it('reports fire held and the release edge', () => {
    const held = run([down('Space')]);
    expect(buildIntent(held, identity)).toMatchObject({ fireHeld: true, fireReleased: false });
    const released = run([up('Space')], endTick(held));
    expect(buildIntent(released, identity)).toMatchObject({ fireHeld: false, fireReleased: true });
  });

  it('maps slot, fuse, panel, pause, jump and backflip presses', () => {
    const intent = buildIntent(run([down('F4'), down('Digit2'), down('Tab'), down('Escape'), down('Enter'), down('Backspace')]), identity);
    expect(intent.selectedSlot).toBe(4);
    expect(intent.fuse).toBe(2);
    expect(intent.panelToggle).toBe(true);
    expect(intent.pause).toBe(true);
    expect(intent.jump).toBe(true);
    expect(intent.backflip).toBe(true);
  });

  it('maps the pointer to world space through the camera callback', () => {
    const state = run([{ kind: 'pointer', type: 'move', x: 100, y: 50 }]);
    const intent = buildIntent(state, (p) => vec2(p.x * 2 + 1000, p.y * 2 + 500));
    expect(intent.pointer).toEqual({ x: 1200, y: 600 });
    expect(intent.pointerScreen).toEqual({ x: 100, y: 50 });
  });
});

describe('input: controller', () => {
  it('samples once per tick and clears the edges but keeps held keys', () => {
    const controller = createInputController(DEFAULT_KEYBINDS);
    controller.push(down('ArrowRight'));
    controller.push(down('Enter'));
    controller.push({ kind: 'wheel', deltaY: -1 });
    const first = controller.sample(identity);
    expect(first.moveX).toBe(1);
    expect(first.jump).toBe(true);
    expect(first.zoomNotches).toBe(1);
    const second = controller.sample(identity);
    expect(second.moveX).toBe(1);
    expect(second.jump).toBe(false);
    expect(second.zoomNotches).toBe(0);
  });

  it('resets to the initial state', () => {
    const controller = createInputController(DEFAULT_KEYBINDS);
    controller.push(down('Space'));
    controller.reset();
    expect(controller.state()).toBe(INITIAL_INPUT_STATE);
  });
});

describe('input: shift modifier binds', () => {
  const shiftDown = (code: string): RawInputEvent => ({ kind: 'key', type: 'down', code, shift: true });
  const shiftUp = (code: string): RawInputEvent => ({ kind: 'key', type: 'up', code, shift: true });

  it('opens the weapon panel on Shift+Q and ignores a bare Q', () => {
    const shifted = run([shiftDown('KeyQ')]);
    expect(shifted.pressed.has('weaponPanel')).toBe(true);
    expect(buildIntent(shifted, identity).panelToggle).toBe(true);
    expect(run([down('KeyQ')])).toBe(INITIAL_INPUT_STATE);
  });

  it('falls back to the bare bind when shift is held on a key with no shifted bind, so Shift plus an arrow still walks', () => {
    const state = run([shiftDown('ArrowLeft')]);
    expect(state.held.has('moveLeft')).toBe(true);
    expect(buildIntent(state, identity).moveX).toBe(-1);
  });

  it('releases the shifted action even when shift was let go before the key', () => {
    // Shift+Q down, then shift released first, then Q released without the modifier.
    const held = run([shiftDown('KeyQ')]);
    const released = run([up('KeyQ')], endTick(held));
    expect(released.held.has('weaponPanel')).toBe(false);
    // The panel can therefore toggle again on the next Shift+Q, instead of staying stuck as held.
    const again = run([shiftDown('KeyQ')], endTick(released));
    expect(again.pressed.has('weaponPanel')).toBe(true);
  });

  it('releases a bare action on a shifted key up', () => {
    const held = run([down('ArrowRight')]);
    const released = run([shiftUp('ArrowRight')], endTick(held));
    expect(released.held.has('moveRight')).toBe(false);
  });

  it('is exposed to the DOM binder as the bare physical code', () => {
    // "Shift+KeyQ" must claim the Q key for preventDefault, and Tab stays claimed too.
    const codes = new Set(Object.values(DEFAULT_KEYBINDS).flat().map((key) => key.replace(/^Shift\+/, '')));
    expect(codes.has('KeyQ')).toBe(true);
    expect(codes.has('Tab')).toBe(true);
    expect(codes.has('Shift+KeyQ')).toBe(false);
  });
});
