/**
 * The anime row: the techniques of Saint Seiya (Antares, the Galaxian Explosion, the Tesoro del
 * Cielo), One Piece (the Hiken, Fujitora's meteor, the Santoryu), Frieren (Zoltraak) and Dragon Ball
 * (Majin Vegeta's Explosión Final). Each row
 * is a technique block (TechniqueSpec) the sim plays out (sim/techniques/*.ts); the row's kind only
 * says how it is aimed: along the aim line (HITSCAN, with the guide), a square ahead (MELEE), or
 * called down where the player clicks (TARGETED).
 *
 * Supers, like the rest of them: one of each per worm from the loadout, never out of a weapon crate,
 * recharged by the power orb, and locked on the opening turn only. The two that kill whatever they
 * reach pay for it: Antares costs half of the health its user has, the Galaxian Explosion the 50 the
 * one hit kills cost. The Tesoro del Cielo is paid strike by strike, 15 each; the Explosión Final
 * with the worm itself. All v1 tuning.
 */

import type { WeaponDef, WeaponId } from '../types.ts';
import { BOMBLET_FAILSAFE_MS, ONE_HIT_KILL_TOLL, blast, defineWeapon, grenadeProjectile, iconFrame, sourceSpeed } from './shared.ts';

/** What every technique row shares: one per worm, open from the second turn, no charge, one shot that ends the turn, no crate. */
const TECHNIQUE_ROW = Object.freeze({
  category: 'anime',
  heldSprite: null,
  ammo: 1,
  delayTurns: 2,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  crateWeight: 0,
} as const);

/**
 * Antares: fourteen needles of 2, one per star of Scorpio, then Antares in the heart. The needles
 * reach farther than the Freezer's light but need a clean line: they stop at the first wall.
 */
const ANTARES: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'antares',
  name: 'Antares',
  kind: 'HITSCAN',
  icon: iconFrame('antares'),
  requiresTargetSelect: false,
  /** Half of whatever health its user has, rounded up. */
  tollShare: 0.5,
  technique: {
    kind: 'needle',
    rangePx: 420,
    pointMs: 900,
    stings: 14,
    stingIntervalMs: 110,
    stingDamage: 2,
    antaresMs: 650,
    recoverMs: 1100,
  },
  sfx: { fire: 'ui_power_charge' },
});

/**
 * The Galaxian Explosion: a galaxy that flies slow enough to watch, and kills every worm within 44 px
 * of where it goes off, the thrower too if it stands that close; the crater is as wide.
 */
const GALAXIAN: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'galaxian',
  name: 'Explosión de Galaxias',
  kind: 'HITSCAN',
  icon: iconFrame('galaxian'),
  requiresTargetSelect: false,
  toll: ONE_HIT_KILL_TOLL,
  technique: {
    kind: 'galaxy',
    chargeMs: 1800,
    speedPxPerS: 420,
    rangePx: 700,
    radiusPx: 7,
    killRadiusPx: 44,
    /** The kill is the damage; the blast is the crater, the shake and the push. */
    blast: { radiusPx: 44, maxDamage: 0, knockback: sourceSpeed(12), carve: true, shake: 12, particle: 'holy' },
    recoverMs: 1300,
  },
  sfx: { fire: 'ui_power_charge', impact: 'exp_large' },
});

/** The Tesoro del Cielo: three turns of the target's team, 15 from the caster for each, the third kills. */
const TENBU_HORIN: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'tenbu_horin',
  name: 'Tesoro del Cielo',
  kind: 'HITSCAN',
  icon: iconFrame('tenbu_horin'),
  requiresTargetSelect: false,
  technique: {
    kind: 'treasure',
    rangePx: 420,
    castMs: 2600,
    hits: 3,
    hitToll: 15,
    strikeMs: 2000,
    recoverMs: 900,
  },
  sfx: { fire: 'wpn_holy_choir' },
});

/** The Hiken: a fist of fire with a bigger blast than the bazooka's, and nine burning blobs. */
const HIKEN: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'hiken',
  name: 'Hiken',
  kind: 'HITSCAN',
  icon: iconFrame('hiken'),
  requiresTargetSelect: false,
  technique: {
    kind: 'hiken',
    windupMs: 1100,
    speedPxPerS: 420,
    rangePx: 640,
    radiusPx: 9,
    blast: blast(110, 55, 11, 'big'),
    flames: 9,
    flameSpeed: sourceSpeed(5.5),
    flameProjectile: grenadeProjectile('proj_flame', 2, 'min', BOMBLET_FAILSAFE_MS),
    flameBlast: blast(29, 10, 3, 'small'),
    recoverMs: 1000,
  },
  sfx: { fire: 'wpn_firepunch_whoosh', impact: 'exp_large' },
});

/** Fujitora's meteor: the biggest crater in the game, a little wider than the holy hand grenade's. */
const METEOR: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'meteor',
  name: 'Meteorito',
  kind: 'TARGETED',
  icon: iconFrame('meteor'),
  requiresTargetSelect: true,
  technique: {
    kind: 'meteor',
    callMs: 1400,
    fallSpeedPxPerS: 380,
    slant: 0.45,
    radiusPx: 12,
    blast: blast(210, 80, 17, 'holy'),
    recoverMs: 1200,
  },
  sfx: { fire: 'wld_sudden_death_siren', impact: 'exp_large' },
});

/** The Santoryu: an 84 px square cut into 12 px cubes, 45 to every worm in it. */
const SANTORYU: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'santoryu',
  name: 'Santoryu',
  kind: 'MELEE',
  icon: iconFrame('santoryu'),
  requiresTargetSelect: false,
  technique: {
    kind: 'dice',
    sizePx: 84,
    reachPx: 64,
    cubePx: 12,
    damage: 45,
    push: 160,
    lift: 260,
    drawMs: 900,
    slashes: 6,
    slashIntervalMs: 110,
    recoverMs: 1100,
  },
  sfx: { fire: 'wpn_shotgun_cock' },
});

/**
 * Zoltraak: five circles, five beams of 18 at most meeting on one point. Light, not a blast: the
 * beams barely push, so a worm the first one finds is still there for the other four.
 */
const ZOLTRAAK: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'zoltraak',
  name: 'Zoltraak',
  kind: 'HITSCAN',
  icon: iconFrame('zoltraak'),
  requiresTargetSelect: false,
  technique: {
    kind: 'zoltraak',
    circles: 5,
    formMs: 500,
    circleIntervalMs: 220,
    fireIntervalMs: 160,
    rangePx: 600,
    spreadPx: 26,
    beamBlast: { radiusPx: 15, maxDamage: 18, knockback: sourceSpeed(0.5), carve: true, shake: 1, particle: 'small' },
    recoverMs: 900,
  },
  sfx: { fire: 'wpn_teleport_zap' },
});

/**
 * The Explosión Final: everything within 70 px of the worm goes, the worm first of all, and the
 * crater is as wide as the holy hand grenade's. No aim, no toll: the worm is the price.
 */
const FINAL_EXPLOSION: WeaponDef = defineWeapon({
  ...TECHNIQUE_ROW,
  id: 'final_explosion',
  name: 'Explosión Final',
  kind: 'MELEE',
  icon: iconFrame('final_explosion'),
  requiresTargetSelect: false,
  technique: {
    kind: 'final',
    chargeMs: 2600,
    killRadiusPx: 70,
    /** The kill is the damage; the blast is the crater, the shake and the push. */
    blast: { radiusPx: 70, maxDamage: 0, knockback: sourceSpeed(16), carve: true, shake: 18, particle: 'holy' },
    recoverMs: 1600,
  },
  sfx: { fire: 'ui_power_charge', impact: 'wpn_holy_blast' },
});

export const ANIME = Object.freeze({
  antares: ANTARES,
  galaxian: GALAXIAN,
  tenbu_horin: TENBU_HORIN,
  hiken: HIKEN,
  meteor: METEOR,
  santoryu: SANTORYU,
  zoltraak: ZOLTRAAK,
  final_explosion: FINAL_EXPLOSION,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
