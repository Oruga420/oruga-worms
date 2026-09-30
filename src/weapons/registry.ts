/**
 * The frozen weapon registry (architecture.md section D): one data row per panel slot, keyed by
 * id in panel order, assembled from the def modules. Adding a weapon is a data row in a defs
 * file plus its id in PANEL_WEAPON_IDS (types.ts); this module fails at load if a panel id has
 * no row so a missing weapon is a boot error, never a silent blank in the panel.
 */

import { ANIMALS } from './defs/animals.ts';
import { EXPLOSIVES } from './defs/explosives.ts';
import { FIREARMS } from './defs/firearms.ts';
import { MELEE } from './defs/melee.ts';
import { PLACED } from './defs/placed.ts';
import { STRIKES } from './defs/strikes.ts';
import { UTILITIES } from './defs/utilities.ts';
import { PANEL_SLOT_COUNT, PANEL_WEAPON_IDS, type WeaponDef, type WeaponId } from './types.ts';

export type WeaponRegistry = Readonly<Record<WeaponId, WeaponDef>>;

const ROWS: Readonly<Partial<Record<WeaponId, WeaponDef>>> = Object.freeze({
  ...EXPLOSIVES,
  ...FIREARMS,
  ...MELEE,
  ...PLACED,
  ...STRIKES,
  ...ANIMALS,
  ...UTILITIES,
});

function assemble(): WeaponRegistry {
  const registry: Partial<Record<WeaponId, WeaponDef>> = {};
  for (const id of PANEL_WEAPON_IDS) {
    const def = ROWS[id];
    if (def === undefined) throw new Error(`weapon registry: no definition for panel id ${id}`);
    registry[id] = def;
  }
  return Object.freeze(registry) as WeaponRegistry;
}

/** Panel order, the same ids the sidecar uses. */
export const WEAPON_IDS: readonly WeaponId[] = PANEL_WEAPON_IDS;
export const PANEL_SLOTS: number = PANEL_SLOT_COUNT;
export const WEAPONS: WeaponRegistry = assemble();

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && (PANEL_WEAPON_IDS as readonly string[]).includes(value);
}

export function getWeapon(id: WeaponId): WeaponDef {
  return WEAPONS[id];
}

function defOf(idOrDef: WeaponId | WeaponDef): WeaponDef {
  return typeof idOrDef === 'string' ? WEAPONS[idOrDef] : idOrDef;
}

/** Fused grenades: the four TIMED rows. */
export function isTimed(idOrDef: WeaponId | WeaponDef): boolean {
  return defOf(idOrDef).kind === 'TIMED';
}

/** Needs a target point before firing: homing missile, air strike, teleport, girder. */
export function isTargeted(idOrDef: WeaponId | WeaponDef): boolean {
  return defOf(idOrDef).requiresTargetSelect;
}

export function isUtility(idOrDef: WeaponId | WeaponDef): boolean {
  return defOf(idOrDef).kind === 'UTILITY';
}

/**
 * The anime supers: a move that plays its own scene in the sim (Ryuko Ranbu's beating, the
 * Kamehameha's beam, Gear 5's meal, the Freezer's light, the Saibaman's sprouting). One of each per
 * worm, never out of a weapon crate; the power orb is what recharges them.
 */
export function isSuper(idOrDef: WeaponId | WeaponDef): boolean {
  const def = defOf(idOrDef);
  return def.combo !== undefined || def.beam !== undefined || def.devour !== undefined || def.hex !== undefined || def.sprout !== undefined;
}
