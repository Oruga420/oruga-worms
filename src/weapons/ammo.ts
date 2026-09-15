/**
 * Immutable per team ammo ledger (architecture.md section D: weapon defs are never mutated,
 * ammo lives in match state as a frozen per team record) plus the weapon crate roll table.
 * -1 is infinite, 0 is empty. Every operation returns a new frozen ledger or an error.
 */

import { err, ok, type Result } from '../core/result.ts';
import { INFINITE_AMMO } from './defs/shared.ts';
import type { WeaponRegistry } from './registry.ts';
import { PANEL_WEAPON_IDS, type WeaponId } from './types.ts';

export { INFINITE_AMMO };

export type AmmoLedger = Readonly<Record<WeaponId, number>>;

export type AmmoError = { readonly kind: 'empty'; readonly id: WeaponId } | { readonly kind: 'badAmount'; readonly id: WeaponId; readonly amount: number };

/** Starting counts from the registry, overridden by a scheme; keys in panel order. */
export function createLedger(registry: WeaponRegistry, scheme: Readonly<Partial<Record<WeaponId, number>>> = {}): AmmoLedger {
  const ledger: Partial<Record<WeaponId, number>> = {};
  for (const id of PANEL_WEAPON_IDS) ledger[id] = scheme[id] ?? registry[id].ammo;
  return Object.freeze(ledger) as AmmoLedger;
}

export function hasAmmo(ledger: AmmoLedger, id: WeaponId): boolean {
  const count = ledger[id];
  return count === INFINITE_AMMO || count > 0;
}

export function consume(ledger: AmmoLedger, id: WeaponId): Result<AmmoLedger, AmmoError> {
  const count = ledger[id];
  if (count === INFINITE_AMMO) return ok(Object.freeze({ ...ledger }));
  if (count <= 0) return err({ kind: 'empty', id });
  return ok(Object.freeze({ ...ledger, [id]: count - 1 }));
}

export function add(ledger: AmmoLedger, id: WeaponId, amount: number): Result<AmmoLedger, AmmoError> {
  if (!Number.isInteger(amount) || amount < 0) return err({ kind: 'badAmount', id, amount });
  const count = ledger[id];
  if (count === INFINITE_AMMO) return ok(Object.freeze({ ...ledger }));
  return ok(Object.freeze({ ...ledger, [id]: count + amount }));
}

/** Weapons that can be fired right now, in panel order. */
export function available(ledger: AmmoLedger): readonly WeaponId[] {
  return Object.freeze(PANEL_WEAPON_IDS.filter((id) => hasAmmo(ledger, id)));
}

export interface CrateRollEntry {
  readonly id: WeaponId;
  readonly weight: number;
}

export interface CrateRollOptions {
  /** Turns played so far; weapons with a delay stay out of crates until it has elapsed. Omit to include everything. */
  readonly turnsElapsed?: number;
}

/** Finite weapons with a positive crate weight, in panel order, honoring scheme delays. */
export function crateRollTable(registry: WeaponRegistry, options: CrateRollOptions = {}): readonly CrateRollEntry[] {
  const entries: CrateRollEntry[] = [];
  for (const id of PANEL_WEAPON_IDS) {
    const def = registry[id];
    if (def.crateWeight <= 0 || def.ammo === INFINITE_AMMO) continue;
    const delay = def.delayTurns ?? 0;
    if (options.turnsElapsed !== undefined && options.turnsElapsed < delay) continue;
    entries.push(Object.freeze({ id, weight: def.crateWeight }));
  }
  return Object.freeze(entries);
}

/** Picks by cumulative weight from a roll in [0, 1); null for an empty table or a roll outside the range. */
export function pickCrateWeapon(table: readonly CrateRollEntry[], roll: number): WeaponId | null {
  if (table.length === 0 || !Number.isFinite(roll) || roll < 0 || roll >= 1) return null;
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return null;
  let cursor = roll * total;
  for (const entry of table) {
    if (cursor < entry.weight) return entry.id;
    cursor -= entry.weight;
  }
  return table[table.length - 1]?.id ?? null;
}
