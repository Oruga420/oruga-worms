/**
 * Default input map (architecture.md section I, config/keybinds.ts). Keys are KeyboardEvent.code
 * values so the layout is the physical key, not the character. The map is frozen data; every
 * change goes through rebind(), which returns a new map and runs the validator.
 *
 * Layout notes: Worms Armageddon puts jump on Enter, backflip on Backspace, fire on Space, fuse
 * on the digit row and weapon groups on the F keys. Weapon slots 1..9 therefore live on F1..F9
 * and fuse 1..5 on Digit1..Digit5, because one physical key may only map to one action (the
 * validator rejects duplicates). Slot and fuse actions are separate so a timed weapon can take a
 * fuse without the panel stealing the digit.
 *
 * A key may carry the modifier prefix "Shift+" ("Shift+KeyQ"), which is how the weapon panel gets
 * its Shift+Q binding. The prefixed and bare forms are DIFFERENT keys to the validator, so
 * "Shift+KeyQ" and "KeyQ" may name different actions; input.ts resolves the shifted form first and
 * falls back to the bare one, which is what keeps Shift plus an arrow walking normally.
 */

import { err, ok, type Result } from '../core/result.ts';

export const MOVEMENT_ACTIONS = ['moveLeft', 'moveRight', 'jump', 'backflip', 'aimUp', 'aimDown', 'fire'] as const;
export const SLOT_ACTIONS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9'] as const;
export const FUSE_ACTIONS = ['fuse1', 'fuse2', 'fuse3', 'fuse4', 'fuse5'] as const;
export const META_ACTIONS = ['weaponPanel', 'pause'] as const;

export type MovementAction = (typeof MOVEMENT_ACTIONS)[number];
export type SlotAction = (typeof SLOT_ACTIONS)[number];
export type FuseAction = (typeof FUSE_ACTIONS)[number];
export type MetaAction = (typeof META_ACTIONS)[number];
export type Action = MovementAction | SlotAction | FuseAction | MetaAction;

export const ACTIONS: readonly Action[] = Object.freeze([
  ...MOVEMENT_ACTIONS,
  ...SLOT_ACTIONS,
  ...FUSE_ACTIONS,
  ...META_ACTIONS,
]);

/**
 * A KeyboardEvent.code, for example "ArrowLeft", "Space", "Digit3", "F5", optionally prefixed
 * with "Shift+" to require the shift modifier ("Shift+KeyQ").
 */
export type KeyCode = string;

export const SHIFT_PREFIX = 'Shift+';

/** "Shift+KeyQ" to "KeyQ"; an unprefixed code is returned unchanged. */
export function bareKeyCode(key: KeyCode): string {
  return key.startsWith(SHIFT_PREFIX) ? key.slice(SHIFT_PREFIX.length) : key;
}

/** "KeyQ" to "Shift+KeyQ". */
export function shiftedKeyCode(code: string): KeyCode {
  return `${SHIFT_PREFIX}${code}`;
}

export type Keybinds = Readonly<Record<Action, readonly KeyCode[]>>;

function freezeBinds(binds: Record<Action, readonly KeyCode[]>): Keybinds {
  for (const keys of Object.values(binds)) Object.freeze(keys);
  return Object.freeze(binds);
}

export const DEFAULT_KEYBINDS: Keybinds = freezeBinds({
  moveLeft: ['ArrowLeft', 'KeyA'],
  moveRight: ['ArrowRight', 'KeyD'],
  aimUp: ['ArrowUp', 'KeyW'],
  aimDown: ['ArrowDown', 'KeyS'],
  jump: ['Enter'],
  backflip: ['Backspace'],
  fire: ['Space'],
  weaponPanel: ['Tab', 'Shift+KeyQ'],
  slot1: ['F1'],
  slot2: ['F2'],
  slot3: ['F3'],
  slot4: ['F4'],
  slot5: ['F5'],
  slot6: ['F6'],
  slot7: ['F7'],
  slot8: ['F8'],
  slot9: ['F9'],
  fuse1: ['Digit1'],
  fuse2: ['Digit2'],
  fuse3: ['Digit3'],
  fuse4: ['Digit4'],
  fuse5: ['Digit5'],
  pause: ['Escape', 'KeyP'],
});

export type KeybindErrorCode = 'not_an_object' | 'missing_action' | 'unknown_action' | 'empty' | 'bad_key' | 'duplicate';

export interface KeybindError {
  readonly code: KeybindErrorCode;
  readonly action: string;
  readonly key: string | null;
  readonly message: string;
}

function fail(code: KeybindErrorCode, action: string, key: string | null, message: string): Result<never, KeybindError> {
  return err(Object.freeze({ code, action, key, message }));
}

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function readKeys(action: string, raw: unknown): Result<readonly KeyCode[], KeybindError> {
  if (!Array.isArray(raw) || raw.length === 0) return fail('empty', action, null, `${action} needs at least one key`);
  for (const key of raw) {
    if (typeof key !== 'string' || key.trim() === '') {
      return fail('bad_key', action, String(key), `${action} has a key that is not a non empty string`);
    }
    // "Shift+" on its own names no physical key, and it would make bareKeyCode return "".
    if (bareKeyCode(key).trim() === '') {
      return fail('bad_key', action, key, `${action} has a modifier prefix with no key code`);
    }
  }
  return ok(Object.freeze([...(raw as string[])]));
}

/**
 * Validates an untrusted map (for example from localStorage) and returns a frozen Keybinds.
 * Rejects unknown or missing actions, empty lists, non string keys and any key bound twice.
 */
export function validateKeybinds(input: unknown): Result<Keybinds, KeybindError> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('not_an_object', '', null, 'keybinds must be an object keyed by action');
  }
  const record = input as Record<string, unknown>;
  for (const name of Object.keys(record)) {
    if (!isAction(name)) return fail('unknown_action', name, null, `${name} is not a known action`);
  }
  const out: Partial<Record<Action, readonly KeyCode[]>> = {};
  const owners = new Map<KeyCode, Action>();
  for (const action of ACTIONS) {
    if (!(action in record)) return fail('missing_action', action, null, `${action} is not bound`);
    const keys = readKeys(action, record[action]);
    if (!keys.ok) return keys;
    for (const key of keys.value) {
      const owner = owners.get(key);
      if (owner !== undefined) return fail('duplicate', action, key, `${key} is bound to both ${owner} and ${action}`);
      owners.set(key, action);
    }
    out[action] = keys.value;
  }
  return ok(freezeBinds(out as Record<Action, readonly KeyCode[]>));
}

/** Returns a new map with one action rebound, validated. The input map is never mutated. */
export function rebind(binds: Keybinds, action: Action, keys: readonly KeyCode[]): Result<Keybinds, KeybindError> {
  return validateKeybinds({ ...binds, [action]: [...keys] });
}

/** Inverse lookup, key code to action, for the input reducer. */
export function keyToActionMap(binds: Keybinds): ReadonlyMap<KeyCode, Action> {
  const map = new Map<KeyCode, Action>();
  for (const action of ACTIONS) {
    for (const key of binds[action]) map.set(key, action);
  }
  return map;
}

/** 1..9 for slot actions, null otherwise. */
export function slotIndex(action: Action): number | null {
  const index = (SLOT_ACTIONS as readonly string[]).indexOf(action);
  return index === -1 ? null : index + 1;
}

/** 1..5 for fuse actions, null otherwise. */
export function fuseIndex(action: Action): number | null {
  const index = (FUSE_ACTIONS as readonly string[]).indexOf(action);
  return index === -1 ? null : index + 1;
}
