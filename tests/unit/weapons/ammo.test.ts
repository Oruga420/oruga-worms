import { describe, expect, it } from 'vitest';
import {
  INFINITE_AMMO,
  add,
  available,
  consume,
  crateRollTable,
  createLedger,
  hasAmmo,
  pickCrateWeapon,
} from '@/weapons/ammo.ts';
import type { AmmoLedger } from '@/weapons/ammo.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';

function unwrap<T, E>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('ammo ledger: creation', () => {
  it('starts every weapon at its def ammo, -1 for infinite', () => {
    const ledger = createLedger(WEAPONS);
    expect(Object.keys(ledger)).toEqual([...WEAPON_IDS]);
    expect(ledger.bazooka).toBe(INFINITE_AMMO);
    expect(ledger.grenade).toBe(-1);
    expect(ledger.homing_missile).toBe(1);
    expect(ledger.mortar).toBe(5);
    expect(ledger.banana_bomb).toBe(0);
    expect(ledger.minigun).toBe(0);
    expect(ledger.girder).toBe(3);
    expect(ledger.skip_go).toBe(-1);
  });

  it('is frozen', () => {
    const ledger = createLedger(WEAPONS);
    expect(Object.isFrozen(ledger)).toBe(true);
  });

  it('lets a scheme override starting counts', () => {
    const ledger = createLedger(WEAPONS, { banana_bomb: 2, bazooka: 3, mine: 0 });
    expect(ledger.banana_bomb).toBe(2);
    expect(ledger.bazooka).toBe(3);
    expect(ledger.mine).toBe(0);
    expect(ledger.grenade).toBe(-1);
  });
});

describe('ammo ledger: consume', () => {
  it('decrements a finite count and returns a new frozen ledger, leaving the old one untouched', () => {
    const before = createLedger(WEAPONS);
    const after = unwrap(consume(before, 'mortar'));
    expect(after.mortar).toBe(4);
    expect(before.mortar).toBe(5);
    expect(after).not.toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(after.grenade).toBe(before.grenade);
  });

  it('keeps infinite ammo infinite', () => {
    const before = createLedger(WEAPONS);
    const after = unwrap(consume(before, 'bazooka'));
    expect(after.bazooka).toBe(INFINITE_AMMO);
  });

  it('returns an error when the weapon is empty', () => {
    const ledger = createLedger(WEAPONS);
    const result = consume(ledger, 'banana_bomb');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'empty', id: 'banana_bomb' });
  });

  it('runs a single shot weapon dry after one use', () => {
    const one = createLedger(WEAPONS);
    const zero = unwrap(consume(one, 'holy_hand_grenade'));
    expect(zero.holy_hand_grenade).toBe(0);
    expect(hasAmmo(zero, 'holy_hand_grenade')).toBe(false);
    expect(consume(zero, 'holy_hand_grenade').ok).toBe(false);
    expect(hasAmmo(one, 'holy_hand_grenade')).toBe(true);
  });
});

describe('ammo ledger: add', () => {
  it('adds a crate pickup without mutating the source ledger', () => {
    const before = createLedger(WEAPONS);
    const after = unwrap(add(before, 'banana_bomb', 1));
    expect(after.banana_bomb).toBe(1);
    expect(before.banana_bomb).toBe(0);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it('keeps infinite ammo infinite', () => {
    const ledger = createLedger(WEAPONS);
    expect(unwrap(add(ledger, 'bazooka', 3)).bazooka).toBe(INFINITE_AMMO);
  });

  it('rejects a negative or fractional amount', () => {
    const ledger = createLedger(WEAPONS);
    expect(add(ledger, 'mortar', -1).ok).toBe(false);
    expect(add(ledger, 'mortar', 1.5).ok).toBe(false);
    expect(add(ledger, 'mortar', Number.NaN).ok).toBe(false);
    const zero = add(ledger, 'mortar', 0);
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.value.mortar).toBe(5);
  });
});

describe('ammo ledger: available', () => {
  it('lists weapons with ammo in panel order and skips the empty ones', () => {
    const ledger = createLedger(WEAPONS);
    const ids = available(ledger);
    expect(ids).not.toContain('banana_bomb');
    expect(ids).not.toContain('minigun');
    expect(ids[0]).toBe('bazooka');
    expect(ids).toEqual(WEAPON_IDS.filter((id) => ledger[id] !== 0));
    expect(Object.isFrozen(ids)).toBe(true);
  });

  it('reflects consumption', () => {
    const ledger: AmmoLedger = unwrap(consume(createLedger(WEAPONS), 'holy_hand_grenade'));
    expect(available(ledger)).not.toContain('holy_hand_grenade');
  });
});

describe('crate roll table', () => {
  it('lists only weapons with a positive crate weight and finite ammo', () => {
    const table = crateRollTable(WEAPONS);
    expect(table.length).toBeGreaterThan(0);
    for (const entry of table) {
      expect(entry.weight).toBeGreaterThan(0);
      expect(WEAPONS[entry.id].crateWeight).toBe(entry.weight);
      expect(WEAPONS[entry.id].ammo).not.toBe(INFINITE_AMMO);
    }
    const ids = table.map((entry) => entry.id);
    expect(ids).toContain('banana_bomb');
    expect(ids).toContain('minigun');
    expect(ids).not.toContain('bazooka');
    expect(ids).not.toContain('skip_go');
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('holds delayed weapons back until their delay has elapsed', () => {
    const early = crateRollTable(WEAPONS, { turnsElapsed: 0 }).map((entry) => entry.id);
    expect(early).not.toContain('homing_missile');
    expect(early).not.toContain('air_strike');
    const late = crateRollTable(WEAPONS, { turnsElapsed: 5 }).map((entry) => entry.id);
    expect(late).toContain('homing_missile');
    expect(late).toContain('air_strike');
    const all = crateRollTable(WEAPONS).map((entry) => entry.id);
    expect(all).toContain('air_strike');
  });

  it('picks by cumulative weight from a 0..1 roll', () => {
    const table = crateRollTable(WEAPONS);
    const first = table[0];
    const last = table[table.length - 1];
    expect(pickCrateWeapon(table, 0)).toBe(first?.id);
    expect(pickCrateWeapon(table, 0.999_999)).toBe(last?.id);
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    const firstWeight = first?.weight ?? 0;
    expect(pickCrateWeapon(table, (firstWeight - 0.001) / total)).toBe(first?.id);
    expect(pickCrateWeapon(table, (firstWeight + 0.001) / total)).toBe(table[1]?.id);
  });

  it('returns null for an empty table or a roll outside 0..1', () => {
    const table = crateRollTable(WEAPONS);
    expect(pickCrateWeapon([], 0.5)).toBeNull();
    expect(pickCrateWeapon(table, 1)).toBeNull();
    expect(pickCrateWeapon(table, -0.1)).toBeNull();
    expect(pickCrateWeapon(table, Number.NaN)).toBeNull();
  });
});
