import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS, rebind } from '@/config/keybinds.ts';
import { createInputController } from '@/engine/input.ts';
import { keyEventsFor } from '@/ui/touch-controls.ts';

const toWorld = (p: { x: number; y: number }) => p;

describe('touch controls key resolution', () => {
  it('presses and releases the first bound key of an action', () => {
    expect(keyEventsFor(DEFAULT_KEYBINDS, 'fire')).toEqual({
      down: { kind: 'key', type: 'down', code: 'Space', shift: false },
      up: { kind: 'key', type: 'up', code: 'Space', shift: false },
    });
  });

  it('drives the same intents as the keyboard: hold fire charges, lifting it fires', () => {
    const input = createInputController(DEFAULT_KEYBINDS);
    const fire = keyEventsFor(DEFAULT_KEYBINDS, 'fire');
    const left = keyEventsFor(DEFAULT_KEYBINDS, 'moveLeft');
    if (fire === null || left === null) throw new Error('default binds missing');
    input.push(left.down);
    input.push(fire.down);
    const held = input.sample(toWorld);
    expect(held.fireHeld).toBe(true);
    expect(held.moveX).toBe(-1);
    input.push(fire.up);
    input.push(left.up);
    const released = input.sample(toWorld);
    expect(released.fireReleased).toBe(true);
    expect(released.moveX).toBe(0);
  });

  it('follows a rebind, including a Shift+ binding', () => {
    const result = rebind(DEFAULT_KEYBINDS, 'weaponPanel', ['Shift+KeyE']);
    if (!result.ok) throw new Error(result.error.message);
    const events = keyEventsFor(result.value, 'weaponPanel');
    expect(events?.down).toEqual({ kind: 'key', type: 'down', code: 'KeyE', shift: true });
    const input = createInputController(result.value);
    if (events === null) throw new Error('no binding');
    input.push(events.down);
    expect(input.sample(toWorld).panelToggle).toBe(true);
  });
});
