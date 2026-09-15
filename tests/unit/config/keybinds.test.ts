import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_KEYBINDS,
  fuseIndex,
  keyToActionMap,
  rebind,
  slotIndex,
  validateKeybinds,
  type Keybinds,
} from '@/config/keybinds.ts';

function expectErr(result: ReturnType<typeof validateKeybinds>, code: string): void {
  if (result.ok) throw new Error('expected an error');
  expect(result.error.code).toBe(code);
}

describe('keybinds: defaults', () => {
  it('bind every action at least once and pass the validator', () => {
    const result = validateKeybinds(DEFAULT_KEYBINDS);
    expect(result.ok).toBe(true);
    for (const action of ACTIONS) expect(DEFAULT_KEYBINDS[action].length).toBeGreaterThan(0);
  });

  it('cover the 23 actions from the plan', () => {
    expect(ACTIONS).toHaveLength(23);
    expect(ACTIONS).toContain('backflip');
    expect(ACTIONS).toContain('weaponPanel');
    expect(ACTIONS).toContain('slot9');
    expect(ACTIONS).toContain('fuse5');
    expect(ACTIONS).toContain('pause');
  });

  it('put fuses on the digit row and weapon slots on the F keys', () => {
    expect(DEFAULT_KEYBINDS.fuse3).toEqual(['Digit3']);
    expect(DEFAULT_KEYBINDS.slot3).toEqual(['F3']);
    expect(DEFAULT_KEYBINDS.fire).toEqual(['Space']);
    expect(DEFAULT_KEYBINDS.jump).toEqual(['Enter']);
    expect(DEFAULT_KEYBINDS.backflip).toEqual(['Backspace']);
  });

  it('are frozen data', () => {
    expect(Object.isFrozen(DEFAULT_KEYBINDS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_KEYBINDS.moveLeft)).toBe(true);
  });
});

describe('keybinds: validator', () => {
  it('rejects a key bound to two actions', () => {
    const broken = { ...DEFAULT_KEYBINDS, jump: ['Space'] };
    const result = validateKeybinds(broken);
    expectErr(result, 'duplicate');
    if (!result.ok) {
      expect(result.error.key).toBe('Space');
      expect(result.error.message).toContain('fire');
      expect(result.error.message).toContain('jump');
    }
  });

  it('rejects a missing action', () => {
    const rest = Object.fromEntries(Object.entries(DEFAULT_KEYBINDS).filter(([action]) => action !== 'pause'));
    expectErr(validateKeybinds(rest), 'missing_action');
  });

  it('rejects an unknown action', () => {
    expectErr(validateKeybinds({ ...DEFAULT_KEYBINDS, teleport: ['KeyT'] }), 'unknown_action');
  });

  it('rejects an empty key list and non string keys', () => {
    expectErr(validateKeybinds({ ...DEFAULT_KEYBINDS, fire: [] }), 'empty');
    expectErr(validateKeybinds({ ...DEFAULT_KEYBINDS, fire: [42] }), 'bad_key');
    expectErr(validateKeybinds({ ...DEFAULT_KEYBINDS, fire: [''] }), 'bad_key');
  });

  it('rejects non objects', () => {
    expectErr(validateKeybinds(null), 'not_an_object');
    expectErr(validateKeybinds([]), 'not_an_object');
    expectErr(validateKeybinds('ArrowLeft'), 'not_an_object');
  });

  it('returns a frozen copy and never mutates the input', () => {
    const input: Record<string, string[]> = Object.fromEntries(ACTIONS.map((a) => [a, [...DEFAULT_KEYBINDS[a]]]));
    const result = validateKeybinds(input);
    if (!result.ok) throw new Error('expected ok');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.fire)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(result.value.fire).not.toBe(input['fire']);
  });
});

describe('keybinds: rebind and lookups', () => {
  it('returns a new map with the action rebound and leaves the original alone', () => {
    const result = rebind(DEFAULT_KEYBINDS, 'jump', ['KeyJ']);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.jump).toEqual(['KeyJ']);
    expect(DEFAULT_KEYBINDS.jump).toEqual(['Enter']);
    expect(result.value).not.toBe(DEFAULT_KEYBINDS);
  });

  it('refuses a rebind that collides', () => {
    expectErr(rebind(DEFAULT_KEYBINDS, 'jump', ['ArrowLeft']), 'duplicate');
  });

  it('builds the inverse map used by the input reducer', () => {
    const map = keyToActionMap(DEFAULT_KEYBINDS);
    expect(map.get('ArrowLeft')).toBe('moveLeft');
    expect(map.get('KeyA')).toBe('moveLeft');
    expect(map.get('F7')).toBe('slot7');
    expect(map.get('Digit2')).toBe('fuse2');
    expect(map.get('KeyZ')).toBeUndefined();
    const bound = ACTIONS.reduce((n, a) => n + DEFAULT_KEYBINDS[a].length, 0);
    expect(map.size).toBe(bound);
  });

  it('maps slot and fuse actions to their indices', () => {
    expect(slotIndex('slot1')).toBe(1);
    expect(slotIndex('slot9')).toBe(9);
    expect(slotIndex('fire')).toBeNull();
    expect(fuseIndex('fuse1')).toBe(1);
    expect(fuseIndex('fuse5')).toBe(5);
    expect(fuseIndex('slot1')).toBeNull();
  });

  it('accepts a hand written map typed as Keybinds', () => {
    const custom: Keybinds = { ...DEFAULT_KEYBINDS, pause: ['Escape'] };
    expect(validateKeybinds(custom).ok).toBe(true);
  });
});
