/**
 * Static weapon metadata the sidecar sanitizer needs (fuse options, target selection) for the
 * v1 roster of ultraplan rev 2. Track 1C will ship the real weapon registry under src/weapons;
 * until Phase 2.3 wires that registry into the sidecar this table is the source of truth here,
 * and the ids below are the ones the registry must use (snake_case, one per panel slot).
 */

import type { CpuTurnRequest } from '../src/ai/contract.ts';
import type { SanitizeContext, SanitizeWeaponInfo } from './sanitize.ts';

export const FUSE_OPTIONS_MS: readonly number[] = Object.freeze([1000, 2000, 3000, 4000, 5000]);
export const HOLY_FUSE_MS = 3000;

function plain(id: string): SanitizeWeaponInfo {
  return Object.freeze({ id, requiresTargetSelect: false, fuseOptionsMs: null, fuseDefaultMs: null });
}

function timed(id: string): SanitizeWeaponInfo {
  return Object.freeze({ id, requiresTargetSelect: false, fuseOptionsMs: FUSE_OPTIONS_MS, fuseDefaultMs: 3000 });
}

function targeted(id: string): SanitizeWeaponInfo {
  return Object.freeze({ id, requiresTargetSelect: true, fuseOptionsMs: null, fuseDefaultMs: null });
}

/**
 * 21 combat weapons plus 5 utilities: the ultraplan rev 2 roster, plus the tank cannon, napalm gun
 * and sonic blast gun. validate.ts fails the boot when a registry weapon is missing here, which is
 * what keeps this table and src/weapons from drifting apart.
 */
export const CPU_WEAPON_META: Readonly<Record<string, SanitizeWeaponInfo>> = Object.freeze({
  bazooka: plain('bazooka'),
  homing_missile: targeted('homing_missile'),
  mortar: plain('mortar'),
  longbow: plain('longbow'),
  grenade: timed('grenade'),
  cluster_bomb: timed('cluster_bomb'),
  banana_bomb: timed('banana_bomb'),
  holy_hand_grenade: Object.freeze({
    id: 'holy_hand_grenade',
    requiresTargetSelect: false,
    fuseOptionsMs: Object.freeze([HOLY_FUSE_MS]),
    fuseDefaultMs: HOLY_FUSE_MS,
  }),
  tank: plain('tank'),
  napalm: plain('napalm'),
  handgun: plain('handgun'),
  shotgun: plain('shotgun'),
  uzi: plain('uzi'),
  minigun: plain('minigun'),
  sonic_blast: plain('sonic_blast'),
  fire_punch: plain('fire_punch'),
  baseball_bat: plain('baseball_bat'),
  dynamite: plain('dynamite'),
  mine: plain('mine'),
  sheep: plain('sheep'),
  air_strike: targeted('air_strike'),
  parachute: plain('parachute'),
  jetpack: plain('jetpack'),
  teleport: targeted('teleport'),
  girder: targeted('girder'),
  skip_go: plain('skip_go'),
});

export function weaponMetaFor(id: string): SanitizeWeaponInfo {
  return CPU_WEAPON_META[id] ?? plain(id);
}

/**
 * Sanitizer context for one request: only the weapons the active team can fire right now
 * (count -1 is infinite, 0 or missing means none), the world bounds and the enemy positions.
 */
export function sanitizeContextFor(req: CpuTurnRequest): SanitizeContext {
  const weapons: Record<string, SanitizeWeaponInfo> = {};
  const ammo: Record<string, number> = {};
  for (const entry of req.ammo) {
    const id = String(entry.weapon);
    if (entry.count === 0) continue;
    weapons[id] = weaponMetaFor(id);
    ammo[id] = entry.count;
  }
  return Object.freeze({
    weapons: Object.freeze(weapons),
    ammo: Object.freeze(ammo),
    world: req.world,
    activeX: req.active.x,
    enemies: req.enemies,
    maxWalkMs: req.active.maxWalkMs,
  });
}
