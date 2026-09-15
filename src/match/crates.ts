/**
 * Crate drops (tuning card: 6.7 percent weapon, 3.3 health, 3.3 utility per turn, at most 5 on
 * the map, health crate +25). One independent roll per TurnEnd against the configured odds; the
 * original draws from a 100 slot bag without replacement, the long run frequencies are the same.
 * Health crates stop in sudden death (prior-art.md Part B).
 *
 * The utility table is the Worms Armageddon one, kept as a placeholder: Phase 2.3 maps the
 * entries onto the v1 utility effects the registry actually ships.
 */

import type { Rng } from '../core/rng.ts';
import { WEAPONS, isUtility } from '../weapons/registry.ts';
import { PANEL_WEAPON_IDS, type WeaponId } from '../weapons/types.ts';
import type { MatchConfig } from './deps.ts';
import type { CrateType } from './state.ts';

/**
 * Which weapon a picked crate holds, drawn from the roster by crateWeight: combat weapons for a
 * weapon crate, utilities for a utility crate. Weapons the team already has in infinite supply are
 * skipped, since one more of those would be a crate that gives nothing. Null when nothing qualifies.
 */
export function rollCrateWeapon(rng: Rng, crate: 'weapon' | 'utility', ammo: Readonly<Partial<Record<WeaponId, number>>>): WeaponId | null {
  const candidates = PANEL_WEAPON_IDS.filter((id) => {
    const def = WEAPONS[id];
    const count = ammo[id];
    if (def.crateWeight <= 0 || count === undefined || count < 0) return false;
    return crate === 'utility' ? isUtility(def) : !isUtility(def);
  });
  const total = candidates.reduce((sum, id) => sum + WEAPONS[id].crateWeight, 0);
  if (candidates.length === 0 || total <= 0) return null;
  let roll = rng.next() * total;
  for (const id of candidates) {
    roll -= WEAPONS[id].crateWeight;
    if (roll < 0) return id;
  }
  return candidates[candidates.length - 1] ?? null;
}

export interface CrateRollOptions {
  /** No health crates once sudden death has started. */
  readonly suddenDeath?: boolean;
  /** A crate rolled earlier that the sim has not landed yet counts against the cap. */
  readonly pendingDrop?: boolean;
}

export interface CrateOdds {
  readonly weapon: number;
  readonly health: number;
  readonly utility: number;
  readonly none: number;
}

/** Per turn probabilities as fractions in 0..1. */
export function crateOdds(config: MatchConfig): CrateOdds {
  const { weaponPct, healthPct, utilityPct } = config.crates;
  const weapon = weaponPct / 100;
  const health = healthPct / 100;
  const utility = utilityPct / 100;
  return Object.freeze({ weapon, health, utility, none: Math.max(0, 1 - weapon - health - utility) });
}

export function canDropCrate(cratesOnMap: number, config: MatchConfig, pendingDrop = false): boolean {
  return cratesOnMap + (pendingDrop ? 1 : 0) < config.crates.maxOnMap;
}

/** null means no crate this turn. */
export function rollCrate(
  rng: Rng,
  config: MatchConfig,
  cratesOnMap: number,
  options: CrateRollOptions = {},
): CrateType | null {
  if (!canDropCrate(cratesOnMap, config, options.pendingDrop ?? false)) return null;
  const roll = rng.next() * 100;
  const { weaponPct, healthPct, utilityPct } = config.crates;
  if (roll < weaponPct) return 'weapon';
  if (roll < weaponPct + healthPct) return options.suddenDeath === true ? null : 'health';
  if (roll < weaponPct + healthPct + utilityPct) return 'utility';
  return null;
}

export function healthCrateAmount(config: MatchConfig): number {
  return config.crates.healthAmount;
}

export const UTILITY_CRATE_IDS = [
  'fast_walk',
  'laser_sight',
  'double_damage',
  'invisibility',
  'low_gravity',
  'crate_spy',
  'jetpack',
  'double_turn_time',
  'crate_shower',
] as const;
export type UtilityCrateId = (typeof UTILITY_CRATE_IDS)[number];

export interface UtilityCrateItem {
  readonly id: UtilityCrateId;
  readonly weight: number;
}

/** Worms Armageddon utility crate weights (prior-art.md Part B). */
export const UTILITY_CRATE_ITEMS: readonly UtilityCrateItem[] = Object.freeze([
  Object.freeze({ id: 'fast_walk', weight: 20 }),
  Object.freeze({ id: 'laser_sight', weight: 10 }),
  Object.freeze({ id: 'double_damage', weight: 15 }),
  Object.freeze({ id: 'invisibility', weight: 5 }),
  Object.freeze({ id: 'low_gravity', weight: 10 }),
  Object.freeze({ id: 'crate_spy', weight: 15 }),
  Object.freeze({ id: 'jetpack', weight: 10 }),
  Object.freeze({ id: 'double_turn_time', weight: 15 }),
  Object.freeze({ id: 'crate_shower', weight: 5 }),
] as const);

/** One weighted pick; undefined for an empty table or non positive weights. */
export function rollWeighted<T extends { readonly weight: number }>(rng: Rng, items: readonly T[]): T | undefined {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (total <= 0) return undefined;
  let cursor = rng.next() * total;
  for (const item of items) {
    cursor -= Math.max(0, item.weight);
    if (cursor < 0) return item;
  }
  return items[items.length - 1];
}

export function rollUtility(rng: Rng, items: readonly UtilityCrateItem[] = UTILITY_CRATE_ITEMS): UtilityCrateId {
  return rollWeighted(rng, items)?.id ?? 'fast_walk';
}

/** Scheduled drops always deliver: configured odds choose the kind, never whether it exists. */
export function rollScheduledCrate(rng: Rng, config: MatchConfig, suddenDeath = false): CrateType {
  const items: { kind: CrateType; weight: number }[] = [
    { kind: 'weapon', weight: config.crates.weaponPct },
    { kind: 'utility', weight: config.crates.utilityPct },
    ...(suddenDeath ? [] : [{ kind: 'health' as const, weight: config.crates.healthPct }]),
  ];
  return rollWeighted(rng, items)?.kind ?? 'weapon';
}
