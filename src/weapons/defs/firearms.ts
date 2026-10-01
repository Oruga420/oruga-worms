/**
 * Firearm rows of the ultraplan rev 2 roster: handgun, shotgun, uzi, minigun and the sonic blast
 * gun are HITSCAN; the longbow is a fixed power PROJECTILE that does not carve (its arrows embed
 * in the landscape). The Kamehameha, a charged energy beam, is a HITSCAN row with a beam block, and
 * the Freezer, a light that makes a worm swell up and burst, one with a hex block.
 */

import { WORLD_SIZE_MAX } from '../../config/constants.ts';
import type { HitscanSpec, WeaponDef, WeaponId } from '../types.ts';
import {
  INFINITE_AMMO,
  MAX_LAUNCH_SPEED,
  ONE_HIT_KILL_TOLL,
  blast,
  contactProjectile,
  craterRadiusPx,
  defineWeapon,
  heldFrame,
  iconFrame,
  sourceFramesToMs,
  sourceSpeed,
  speedForRange45,
} from './shared.ts';

/** Bullets fly until they hit something: the ray covers the largest supported world. */
const BULLET_RANGE_PX = WORLD_SIZE_MAX.w;
/** Roster bullet craters: 11 px for the guns, 47 px for the shotgun slug. */
const BULLET_CRATER_DIAMETER_PX = 11;
const SHOTGUN_CRATER_DIAMETER_PX = 47;
/** Handgun: six rounds in slow succession (Handgun page); the interval is a v1 tuning value. */
const HANDGUN_INTERVAL_MS = 250;
/** A pressure wave dissipates: the sonic blast reaches a third of a screen, not the whole map. */
const SONIC_RANGE_PX = 420;
/** Uzi fires 1 bullet every 6 source frames, minigun every 3 (Uzi and Minigun pages). */
const UZI_INTERVAL_MS = sourceFramesToMs(6);
const MINIGUN_INTERVAL_MS = sourceFramesToMs(3);

interface GunRow {
  readonly spreadDeg: number;
  readonly damagePerPellet: number;
  readonly craterDiameterPx: number;
  readonly burstCount: number;
  readonly burstIntervalMs: number;
  /** Push per pellet, source px per frame (v1 tuning: the last bullets move the worm most). */
  readonly recoilPxPerFrame: number;
  readonly aimWhileFiring: boolean;
}

function gun(row: GunRow): HitscanSpec {
  return {
    pellets: 1,
    spreadDeg: row.spreadDeg,
    damagePerPellet: row.damagePerPellet,
    rangePx: BULLET_RANGE_PX,
    carveRadiusPx: craterRadiusPx(row.craterDiameterPx),
    burstCount: row.burstCount,
    burstIntervalMs: row.burstIntervalMs,
    recoil: sourceSpeed(row.recoilPxPerFrame),
    aimWhileFiring: row.aimWhileFiring,
  };
}

const HANDGUN: WeaponDef = defineWeapon({
  id: 'handgun',
  name: 'Handgun',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('handgun'),
  heldSprite: heldFrame('handgun'),
  ammo: INFINITE_AMMO,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 0,
  hitscan: gun({
    spreadDeg: 3,
    damagePerPellet: 5,
    craterDiameterPx: BULLET_CRATER_DIAMETER_PX,
    burstCount: 6,
    burstIntervalMs: HANDGUN_INTERVAL_MS,
    recoilPxPerFrame: 1,
    aimWhileFiring: true,
  }),
  sfx: { fire: 'wpn_handgun_shot' },
});

const SHOTGUN: WeaponDef = defineWeapon({
  id: 'shotgun',
  name: 'Shotgun',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('shotgun'),
  heldSprite: heldFrame('shotgun'),
  ammo: INFINITE_AMMO,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  /** Two shots with free movement between them; the turn ends after the second. */
  shotsPerTurn: 2,
  endsTurnOnFire: false,
  requiresTargetSelect: false,
  crateWeight: 0,
  hitscan: gun({
    spreadDeg: 0,
    damagePerPellet: 25,
    craterDiameterPx: SHOTGUN_CRATER_DIAMETER_PX,
    burstCount: 1,
    burstIntervalMs: 0,
    recoilPxPerFrame: 6,
    aimWhileFiring: false,
  }),
  sfx: { fire: 'wpn_shotgun_blast', impact: 'exp_small_1', arm: 'wpn_shotgun_cock' },
});

const UZI: WeaponDef = defineWeapon({
  id: 'uzi',
  name: 'Uzi',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('uzi'),
  heldSprite: heldFrame('uzi'),
  ammo: INFINITE_AMMO,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 0,
  hitscan: gun({
    spreadDeg: 6,
    damagePerPellet: 5,
    craterDiameterPx: BULLET_CRATER_DIAMETER_PX,
    burstCount: 10,
    burstIntervalMs: UZI_INTERVAL_MS,
    recoilPxPerFrame: 1.5,
    aimWhileFiring: true,
  }),
  sfx: { fire: 'wpn_uzi_burst' },
});

const MINIGUN: WeaponDef = defineWeapon({
  id: 'minigun',
  name: 'Minigun',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('minigun'),
  heldSprite: heldFrame('minigun'),
  /** Crate only, weight 2 (prior-art.md). */
  ammo: 0,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 2,
  hitscan: gun({
    spreadDeg: 8,
    damagePerPellet: 5,
    craterDiameterPx: BULLET_CRATER_DIAMETER_PX,
    burstCount: 20,
    burstIntervalMs: MINIGUN_INTERVAL_MS,
    recoilPxPerFrame: 2,
    aimWhileFiring: true,
  }),
  /** No minigun cue in the audio plan yet; the uzi burst stands in. */
  sfx: { fire: 'wpn_uzi_burst' },
});

const LONGBOW: WeaponDef = defineWeapon({
  id: 'longbow',
  name: 'Longbow',
  kind: 'PROJECTILE',
  category: 'firearm',
  icon: iconFrame('longbow'),
  heldSprite: heldFrame('longbow'),
  /** Scheme byte reads 2 (judge-charly C2). */
  ammo: 2,
  /** Arrows move at a fixed power in projectile motion (Longbow page). */
  charged: false,
  maxPower: MAX_LAUNCH_SPEED,
  windAffected: false,
  gravityScale: 1,
  /** Two arrows per turn, free movement between them, like the shotgun. */
  shotsPerTurn: 2,
  endsTurnOnFire: false,
  requiresTargetSelect: false,
  crateWeight: 2,
  projectile: contactProjectile('proj_arrow', 2, { detonateOnTimeout: false }),
  /** Single target damage with a strong push; no crater, the arrow embeds in the landscape. */
  blast: { radiusPx: 6, maxDamage: 15, knockback: sourceSpeed(8), carve: false, shake: 1, particle: 'small' },
  /** No bow cue in the audio plan yet; the throw swish stands in. */
  sfx: { fire: 'wpn_grenade_throw' },
});

/**
 * Sonic blast gun: a pressure wave, so it is a displacement weapon rather than a damage one. It
 * carves nothing and barely hurts, but the per pellet recoil is the largest in the roster, which
 * makes it the tool for pushing a worm off a ledge or into the water. Three pellets in a wide
 * cone so the push lands even on a loose aim.
 */
const SONIC_BLAST: WeaponDef = defineWeapon({
  id: 'sonic_blast',
  name: 'Sonic Blast',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('sonic_blast'),
  heldSprite: heldFrame('sonic_blast'),
  ammo: 1,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  crateWeight: 3,
  hitscan: {
    /** A cone, not a bullet: the wave hits with three overlapping pellets. */
    pellets: 3,
    spreadDeg: 18,
    damagePerPellet: 4,
    rangePx: SONIC_RANGE_PX,
    /** A pressure wave moves the landscape's occupants, not the landscape. */
    carveRadiusPx: 0,
    burstCount: 1,
    burstIntervalMs: 0,
    /** The whole point of the weapon: about four times the shotgun's push per pellet. */
    recoil: sourceSpeed(24),
    aimWhileFiring: false,
  },
  /** No sonic cue in the audio plan yet; the holy blast boom stands in for the wave. */
  sfx: { fire: 'wpn_holy_blast' },
});

/** The beam reaches a third of the map and bores through whatever land is in the way. */
const KAMEHAMEHA_RANGE_PX = 640;
/** Wider than a worm is tall (16 px): the tunnel it leaves is one a worm can walk through. */
const KAMEHAMEHA_RADIUS_PX = 10;
const KAMEHAMEHA_DAMAGE = 45;
/** A worm the beam hits flies about 300 px, carried along the beam and lifted off its feet. */
const KAMEHAMEHA_THROW = speedForRange45(300);

const KAMEHAMEHA: WeaponDef = defineWeapon({
  id: 'kamehameha',
  name: 'Kamehameha',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('kamehameha'),
  /** Fired from the bare hands: the energy ball is the only thing the worm holds. */
  heldSprite: null,
  ammo: 1,
  /** Like every super: never on the opening turn. */
  delayTurns: 2,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  /** One per worm, from the loadout only: a weapon crate never hands out another super. */
  crateWeight: 0,
  /** What the heuristic and the panel read: the aim line, the reach and the hit on every worm on it. */
  hitscan: {
    pellets: 1,
    spreadDeg: 0,
    damagePerPellet: KAMEHAMEHA_DAMAGE,
    rangePx: KAMEHAMEHA_RANGE_PX,
    carveRadiusPx: KAMEHAMEHA_RADIUS_PX,
    burstCount: 1,
    burstIntervalMs: 0,
    recoil: 0,
    aimWhileFiring: false,
  },
  beam: {
    /** The chant (voice_super_kamehameha_chant) plays over the charge: keep the two the same length. */
    chargeMs: 1500,
    speedPxPerS: 2200,
    rangePx: KAMEHAMEHA_RANGE_PX,
    radiusPx: KAMEHAMEHA_RADIUS_PX,
    damage: KAMEHAMEHA_DAMAGE,
    push: KAMEHAMEHA_THROW * 0.8,
    lift: KAMEHAMEHA_THROW * 0.5,
    holdMs: 450,
    fadeMs: 350,
    tipBlast: blast(90, 35, 10, 'big'),
  },
  sfx: { fire: 'ui_power_charge', impact: 'exp_large' },
});

/** The light finds a worm up to half a screen away, as long as it is in plain sight. */
const FREEZER_RANGE_PX = 340;

const FREEZER: WeaponDef = defineWeapon({
  id: 'freezer',
  name: 'Freezer',
  kind: 'HITSCAN',
  category: 'firearm',
  icon: iconFrame('freezer'),
  /** A bare finger: the light on its tip is the only thing the worm holds. */
  heldSprite: null,
  ammo: 1,
  /** Like every super: never on the opening turn. */
  delayTurns: 2,
  charged: false,
  maxPower: 0,
  windAffected: false,
  gravityScale: 1,
  shotsPerTurn: 1,
  endsTurnOnFire: true,
  requiresTargetSelect: false,
  /** One per worm, from the loadout only: a weapon crate never hands out another super. */
  crateWeight: 0,
  /** A worm that bursts is gone whatever its health: the one who points pays for it with half its own. */
  toll: ONE_HIT_KILL_TOLL,
  /** Required of a hitscan row: the lock reach, and a whole worm's health as the hit (the burst takes all a worm has, however much). */
  hitscan: {
    pellets: 1,
    spreadDeg: 0,
    damagePerPellet: 100,
    rangePx: FREEZER_RANGE_PX,
    carveRadiusPx: 0,
    burstCount: 1,
    burstIntervalMs: 0,
    recoil: 0,
    aimWhileFiring: false,
  },
  hex: {
    rangePx: FREEZER_RANGE_PX,
    pointMs: 1000,
    lightSpeedPxPerS: 520,
    riseMs: 1000,
    liftPx: 36,
    swellMs: 1600,
    pulses: 5,
    /** A body going off in mid air: it reaches the neighbours, and dents the ground under it. */
    burst: blast(110, 30, 9, 'medium'),
    recoverMs: 1200,
  },
  sfx: { fire: 'ui_power_charge', impact: 'exp_large' },
});

export const FIREARMS = Object.freeze({
  handgun: HANDGUN,
  shotgun: SHOTGUN,
  uzi: UZI,
  minigun: MINIGUN,
  sonic_blast: SONIC_BLAST,
  kamehameha: KAMEHAMEHA,
  freezer: FREEZER,
  longbow: LONGBOW,
}) satisfies Readonly<Partial<Record<WeaponId, WeaponDef>>>;
