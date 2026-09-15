/**
 * Utility rows of the ultraplan rev 2 roster: parachute, jetpack, teleport, girder, skip go. Ammo
 * 2, 1, 2, 3 and infinite; the jetpack carries a 2 turn delay in the scheme; only Skip Go and
 * Teleport end the turn. Utilities hold no sprite and never appear in the CPU's fire options.
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import { IMMEDIATE_TURN_END_MS, INFINITE_AMMO, defineWeapon, iconFrame } from './shared.ts';

/** Jet Pack page: 30 fuel drained at 6 per second per thruster, so 5 s of single thruster burn. */
const JETPACK_FUEL_UNITS = 30;
const JETPACK_DRAIN_PER_SECOND = 6;
const JETPACK_FUEL_MS = (JETPACK_FUEL_UNITS / JETPACK_DRAIN_PER_SECOND) * 1000;
/** Girder page: long girder about 64 px, as tall as a worm; placement range 600 px at 3 stars. */
const GIRDER_LENGTH_PX = 64;
const GIRDER_THICKNESS_PX = 16;
const GIRDER_RANGE_PX = 600;

interface UtilityRow {
  readonly id: WeaponId;
  readonly name: string;
  readonly ammo: number;
  readonly delayTurns?: number;
  readonly windAffected: boolean;
  readonly endsTurnOnFire: boolean;
  readonly requiresTargetSelect: boolean;
  readonly crateWeight: number;
  readonly utility: NonNullable<WeaponDef['utility']>;
  readonly sfx: WeaponDef['sfx'];
}

function utilityDef(row: UtilityRow): WeaponDef {
  return defineWeapon({
    id: row.id,
    name: row.name,
    kind: 'UTILITY',
    category: 'utility',
    icon: iconFrame(row.id),
    heldSprite: null,
    ammo: row.ammo,
    ...(row.delayTurns === undefined ? {} : { delayTurns: row.delayTurns }),
    charged: false,
    maxPower: 0,
    windAffected: row.windAffected,
    gravityScale: 1,
    shotsPerTurn: 1,
    endsTurnOnFire: row.endsTurnOnFire,
    ...(row.endsTurnOnFire ? { retreatMs: IMMEDIATE_TURN_END_MS } : {}),
    requiresTargetSelect: row.requiresTargetSelect,
    crateWeight: row.crateWeight,
    utility: row.utility,
    sfx: row.sfx,
  });
}

const PARACHUTE = utilityDef({
  id: 'parachute',
  name: 'Parachute',
  ammo: 2,
  /** Strongly affected by the wind (Parachute page). */
  windAffected: true,
  endsTurnOnFire: false,
  requiresTargetSelect: false,
  crateWeight: 1,
  utility: { effect: 'parachute' },
  sfx: { fire: 'wpn_parachute_open' },
});

const JETPACK = utilityDef({
  id: 'jetpack',
  name: 'Jetpack',
  ammo: 1,
  delayTurns: 2,
  windAffected: false,
  endsTurnOnFire: false,
  requiresTargetSelect: false,
  /** Utility crate item in the source, never a weapon crate drop. */
  crateWeight: 0,
  utility: { effect: 'jetpack', fuelMs: JETPACK_FUEL_MS },
  /** No jetpack cue in the audio plan yet; the small jet loop stands in for both slots. */
  sfx: { fire: 'wpn_supersheep_jet', loop: 'wpn_supersheep_jet' },
});

const TELEPORT = utilityDef({
  id: 'teleport',
  name: 'Teleport',
  ammo: 2,
  windAffected: false,
  /** Ends the turn immediately, unlimited range (Teleport page). */
  endsTurnOnFire: true,
  requiresTargetSelect: true,
  crateWeight: 1,
  utility: { effect: 'teleport' },
  sfx: { fire: 'wpn_teleport_zap' },
});

const GIRDER = utilityDef({
  id: 'girder',
  name: 'Girder',
  ammo: 3,
  windAffected: false,
  endsTurnOnFire: false,
  requiresTargetSelect: true,
  crateWeight: 1,
  utility: {
    effect: 'girder',
    girderSizePx: { w: GIRDER_LENGTH_PX, h: GIRDER_THICKNESS_PX },
    rangePx: GIRDER_RANGE_PX,
  },
  sfx: { fire: 'wpn_girder_place' },
});

const SKIP_GO = utilityDef({
  id: 'skip_go',
  name: 'Skip Go',
  ammo: INFINITE_AMMO,
  windAffected: false,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 0,
  utility: { effect: 'skip' },
  sfx: { fire: 'wld_turn_swoosh' },
});

export const UTILITIES = Object.freeze({
  parachute: PARACHUTE,
  jetpack: JETPACK,
  teleport: TELEPORT,
  girder: GIRDER,
  skip_go: SKIP_GO,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
