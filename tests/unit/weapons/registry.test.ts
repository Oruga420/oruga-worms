import { describe, expect, it } from 'vitest';
import { PANEL_SLOTS, WEAPONS, WEAPON_IDS, getWeapon, isTimed, isTargeted, isUtility, isWeaponId } from '@/weapons/registry.ts';
import { PANEL_WEAPON_IDS } from '@/weapons/types.ts';
import type { WeaponDef, WeaponId } from '@/weapons/types.ts';
import { CPU_WEAPON_META } from '../../../sidecar/weapon-meta.ts';

/**
 * The 26 panel ids the sidecar uses, in panel order: the ultraplan rev 2 roster plus the tank
 * cannon, napalm gun and sonic blast gun. Spelled out rather than derived so a lost or reordered
 * id fails here instead of silently changing what F1..F9 select.
 */
const SIDECAR_IDS = [
  'bazooka',
  'homing_missile',
  'mortar',
  'longbow',
  'grenade',
  'cluster_bomb',
  'banana_bomb',
  'holy_hand_grenade',
  'tank',
  'napalm',
  'handgun',
  'shotgun',
  'uzi',
  'minigun',
  'sonic_blast',
  'fire_punch',
  'baseball_bat',
  'dynamite',
  'mine',
  'sheep',
  'air_strike',
  'parachute',
  'jetpack',
  'teleport',
  'girder',
  'skip_go',
] as const;

const UTILITY_IDS: readonly WeaponId[] = ['parachute', 'jetpack', 'teleport', 'girder', 'skip_go'];
const TIMED_IDS: readonly WeaponId[] = ['grenade', 'cluster_bomb', 'banana_bomb', 'holy_hand_grenade'];
const TARGETED_IDS: readonly WeaponId[] = ['homing_missile', 'air_strike', 'teleport', 'girder'];

function isDeepFrozen(value: unknown, path = 'root'): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const problems = Object.isFrozen(value) ? [] : [path];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    problems.push(...isDeepFrozen(child, `${path}.${key}`));
  }
  return problems;
}

describe('weapon registry: ids', () => {
  it('has exactly the 26 sidecar ids in panel order', () => {
    expect(WEAPON_IDS).toEqual(SIDECAR_IDS);
    expect(WEAPON_IDS).toHaveLength(26);
    expect(PANEL_SLOTS).toBe(26);
    expect(WEAPON_IDS).toEqual(PANEL_WEAPON_IDS);
  });

  it('matches the sidecar metadata table key for key', () => {
    expect([...Object.keys(CPU_WEAPON_META)].sort()).toEqual([...WEAPON_IDS].sort());
  });

  it('keys every def under its own id', () => {
    expect(Object.keys(WEAPONS)).toEqual([...WEAPON_IDS]);
    for (const id of WEAPON_IDS) expect(WEAPONS[id].id).toBe(id);
  });

  it('splits into 21 combat weapons and 5 utilities', () => {
    const utilities = WEAPON_IDS.filter((id) => WEAPONS[id].kind === 'UTILITY');
    expect(utilities).toEqual(UTILITY_IDS);
    expect(WEAPON_IDS.length - utilities.length).toBe(21);
  });

  it('recognises panel ids and rejects child or unknown ids', () => {
    expect(isWeaponId('bazooka')).toBe(true);
    expect(isWeaponId('skip_go')).toBe(true);
    expect(isWeaponId('mortar_bomblet')).toBe(false);
    expect(isWeaponId('')).toBe(false);
  });
});

describe('weapon registry: helpers', () => {
  it('getWeapon returns the frozen def for an id', () => {
    const def: WeaponDef = getWeapon('bazooka');
    expect(def).toBe(WEAPONS.bazooka);
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('isTimed is true only for the four fused grenades', () => {
    for (const id of WEAPON_IDS) {
      expect(isTimed(id), id).toBe(TIMED_IDS.includes(id));
      expect(isTimed(WEAPONS[id]), id).toBe(TIMED_IDS.includes(id));
    }
  });

  it('isTargeted is true only for homing, air strike, teleport and girder', () => {
    for (const id of WEAPON_IDS) expect(isTargeted(id), id).toBe(TARGETED_IDS.includes(id));
  });

  it('isUtility is true only for the five utilities', () => {
    for (const id of WEAPON_IDS) expect(isUtility(id), id).toBe(UTILITY_IDS.includes(id));
  });
});

describe('weapon registry: data rows', () => {
  it('is deeply frozen, nested specs included', () => {
    expect(Object.isFrozen(WEAPONS)).toBe(true);
    expect(isDeepFrozen(WEAPONS)).toEqual([]);
  });

  it('names icons weapon_icon_<id> and held sprites weapon_held_<id> or null', () => {
    for (const id of WEAPON_IDS) {
      const def = WEAPONS[id];
      expect(def.icon).toBe(`weapon_icon_${id}`);
      if (def.heldSprite !== null) expect(def.heldSprite).toBe(`weapon_held_${id}`);
    }
  });

  it('draws no held sprite for the air strike and the utilities only', () => {
    const withoutHeld = WEAPON_IDS.filter((id) => WEAPONS[id].heldSprite === null);
    expect(withoutHeld).toEqual(['air_strike', ...UTILITY_IDS]);
  });

  it('gives every weapon a non empty display name and a fire cue', () => {
    for (const id of WEAPON_IDS) {
      expect(WEAPONS[id].name.length).toBeGreaterThan(0);
      expect(WEAPONS[id].sfx.fire.length).toBeGreaterThan(0);
    }
  });

  it('keeps clustering as a field: children are nested and never cluster again', () => {
    const clustering = WEAPON_IDS.filter((id) => WEAPONS[id].cluster !== undefined);
    expect(clustering).toEqual(['mortar', 'cluster_bomb', 'banana_bomb', 'napalm']);
    // Child counts per weapon: the three roster clusters split five ways, the napalm gun sprays.
    const counts: Readonly<Record<string, number>> = { mortar: 5, cluster_bomb: 5, banana_bomb: 5, napalm: 14 };
    for (const id of clustering) {
      const cluster = WEAPONS[id].cluster;
      expect(cluster?.childProjectile).toBeDefined();
      expect(cluster?.childBlast).toBeDefined();
      expect(cluster?.childProjectile).not.toHaveProperty('cluster');
      expect(cluster?.count).toBe(counts[id]);
    }
  });
});
