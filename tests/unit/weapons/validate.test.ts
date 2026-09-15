import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@/weapons/registry.ts';
import type { WeaponRegistry } from '@/weapons/registry.ts';
import { validateRegistry } from '@/weapons/validate.ts';
import type { WeaponDef, WeaponId } from '@/weapons/types.ts';
import { CPU_WEAPON_META } from '../../../sidecar/weapon-meta.ts';
import type { SanitizeWeaponInfo } from '../../../sidecar/sanitize.ts';

/** A registry with one def replaced by an arbitrary (possibly malformed) object. */
function withDef(id: WeaponId, def: unknown): WeaponRegistry {
  return { ...WEAPONS, [id]: def as WeaponDef };
}

/** A registry with one def shallow patched, keeping the rest of the row. */
function patch(id: WeaponId, fields: Record<string, unknown>): WeaponRegistry {
  return withDef(id, { ...WEAPONS[id], ...fields });
}

function errorsOf(registry: WeaponRegistry, meta?: Readonly<Record<string, SanitizeWeaponInfo>>): readonly string[] {
  const result = validateRegistry(registry, meta);
  return result.ok ? [] : result.error;
}

function expectError(errors: readonly string[], ...fragments: readonly string[]): void {
  const hit = errors.find((message) => fragments.every((fragment) => message.includes(fragment)));
  expect(hit, `expected an error mentioning ${fragments.join(' and ')}, got:\n${errors.join('\n')}`).toBeDefined();
}

describe('validateRegistry: the real registry', () => {
  it('passes with no errors', () => {
    const result = validateRegistry(WEAPONS);
    expect(result.ok, result.ok ? '' : result.error.join('\n')).toBe(true);
  });

  it('agrees with the sidecar metadata table by default', () => {
    expect(errorsOf(WEAPONS, CPU_WEAPON_META)).toEqual([]);
  });
});

describe('validateRegistry: required spec blocks per kind', () => {
  it('fails when a TIMED weapon has no fuse', () => {
    const { fuse: _fuse, ...noFuse } = WEAPONS.grenade;
    expectError(errorsOf(withDef('grenade', noFuse)), 'grenade', 'fuse');
  });

  it('fails when a PROJECTILE weapon has no blast', () => {
    const { blast: _blast, ...noBlast } = WEAPONS.bazooka;
    expectError(errorsOf(withDef('bazooka', noBlast)), 'bazooka', 'blast');
  });

  it('fails when a HITSCAN weapon has no hitscan block', () => {
    const { hitscan: _hitscan, ...noHitscan } = WEAPONS.shotgun;
    expectError(errorsOf(withDef('shotgun', noHitscan)), 'shotgun', 'hitscan');
  });

  it('fails when a MELEE weapon has no melee block', () => {
    const { melee: _melee, ...noMelee } = WEAPONS.fire_punch;
    expectError(errorsOf(withDef('fire_punch', noMelee)), 'fire_punch', 'melee');
  });

  it('fails when the air strike has no strike block', () => {
    const { strike: _strike, ...noStrike } = WEAPONS.air_strike;
    expectError(errorsOf(withDef('air_strike', noStrike)), 'air_strike', 'strike');
  });

  it('fails when the sheep has no spawn block', () => {
    const { spawn: _spawn, ...noSpawn } = WEAPONS.sheep;
    expectError(errorsOf(withDef('sheep', noSpawn)), 'sheep', 'spawn');
  });

  it('fails when a utility has no utility block', () => {
    const { utility: _utility, ...noUtility } = WEAPONS.teleport;
    expectError(errorsOf(withDef('teleport', noUtility)), 'teleport', 'utility');
  });

  it('fails when the placed mine has neither a fuse nor a mine spawn', () => {
    const { spawn: _spawn, ...noSpawn } = WEAPONS.mine;
    expectError(errorsOf(withDef('mine', noSpawn)), 'mine', 'spawn');
  });
});

describe('validateRegistry: fuses', () => {
  it('fails when fuse.defaultMs is not one of fuse.optionsMs', () => {
    const fuse = { ...WEAPONS.grenade.fuse, defaultMs: 2500 };
    expectError(errorsOf(patch('grenade', { fuse })), 'grenade', 'defaultMs');
  });

  it('fails when a non selectable fuse offers several options', () => {
    const fuse = { selectable: false, defaultMs: 3000, optionsMs: [3000, 4000] };
    expectError(errorsOf(patch('holy_hand_grenade', { fuse })), 'holy_hand_grenade', 'selectable');
  });
});

describe('validateRegistry: cluster children', () => {
  it('fails when a cluster points back at a panel weapon that clusters (cycle)', () => {
    const cluster = { ...WEAPONS.cluster_bomb.cluster, childWeaponId: 'cluster_bomb' };
    expectError(errorsOf(patch('cluster_bomb', { cluster })), 'cluster_bomb', 'cluster');
  });

  it('fails when a cluster child names any registry weapon at all', () => {
    const cluster = { ...WEAPONS.mortar.cluster, childWeaponId: 'bazooka' };
    expectError(errorsOf(patch('mortar', { cluster })), 'mortar', 'bazooka');
  });

  it('fails when a nested child carries its own cluster', () => {
    const base = WEAPONS.banana_bomb.cluster;
    const cluster = { ...base, childProjectile: { ...base?.childProjectile, cluster: { count: 5 } } };
    expectError(errorsOf(patch('banana_bomb', { cluster })), 'banana_bomb', 'cluster');
  });

  it('fails when the child blast is malformed', () => {
    const base = WEAPONS.mortar.cluster;
    const cluster = { ...base, childBlast: { ...base?.childBlast, maxDamage: -15 } };
    expectError(errorsOf(patch('mortar', { cluster })), 'mortar', 'maxDamage');
  });

  it('fails when a cluster spawns no children', () => {
    const cluster = { ...WEAPONS.mortar.cluster, count: 0 };
    expectError(errorsOf(patch('mortar', { cluster })), 'mortar', 'count');
  });
});

describe('validateRegistry: sprites, numbers and ids', () => {
  it('fails on an empty icon', () => {
    expectError(errorsOf(patch('bazooka', { icon: '' })), 'bazooka', 'icon');
  });

  it('fails on an empty held sprite (null is the way to say none)', () => {
    expectError(errorsOf(patch('bazooka', { heldSprite: '' })), 'bazooka', 'heldSprite');
  });

  it('fails on a negative or non finite number anywhere in the row', () => {
    const blast = { ...WEAPONS.dynamite.blast, maxDamage: -5 };
    expectError(errorsOf(patch('dynamite', { blast })), 'dynamite', 'maxDamage');
    const hitscan = { ...WEAPONS.uzi.hitscan, burstIntervalMs: Number.NaN };
    expectError(errorsOf(patch('uzi', { hitscan })), 'uzi', 'burstIntervalMs');
    expectError(errorsOf(patch('sheep', { maxPower: Number.POSITIVE_INFINITY })), 'sheep', 'maxPower');
  });

  it('allows -1 only for ammo', () => {
    expect(errorsOf(patch('bazooka', { ammo: -1 }))).toEqual([]);
    expectError(errorsOf(patch('bazooka', { ammo: -2 })), 'bazooka', 'ammo');
    expectError(errorsOf(patch('bazooka', { crateWeight: -1 })), 'bazooka', 'crateWeight');
  });

  it('fails when an infinite weapon carries a crate weight', () => {
    expectError(errorsOf(patch('bazooka', { crateWeight: 2 })), 'bazooka', 'crateWeight');
  });

  it('fails when a multi shot weapon ends the turn on the first shot', () => {
    expectError(errorsOf(patch('shotgun', { endsTurnOnFire: true })), 'shotgun', 'endsTurnOnFire');
  });

  it('fails when a charged weapon has no launch speed', () => {
    expectError(errorsOf(patch('bazooka', { maxPower: 0 })), 'bazooka', 'maxPower');
  });

  it('fails when the def id does not match its key', () => {
    expectError(errorsOf(withDef('grenade', WEAPONS.bazooka)), 'grenade', 'bazooka');
  });

  it('fails when a panel id is missing or an unknown key is present', () => {
    const { skip_go: _skip, ...missing } = WEAPONS;
    expectError(errorsOf(missing as unknown as WeaponRegistry), 'skip_go');
    const extra = { ...WEAPONS, surrender: { ...WEAPONS.skip_go, id: 'surrender' } };
    expectError(errorsOf(extra as unknown as WeaponRegistry), 'surrender');
  });

  it('fails when a spawn entity type does not match the kind', () => {
    const spawn = { ...WEAPONS.sheep.spawn, entityType: 'mine' };
    expectError(errorsOf(patch('sheep', { spawn })), 'sheep', 'entityType');
  });
});

describe('validateRegistry: sidecar agreement', () => {
  it('fails when the sidecar disagrees on target selection', () => {
    const meta = { ...CPU_WEAPON_META, bazooka: { ...CPU_WEAPON_META.bazooka, requiresTargetSelect: true } };
    expectError(errorsOf(WEAPONS, meta as Record<string, SanitizeWeaponInfo>), 'bazooka', 'requiresTargetSelect');
  });

  it('fails when the sidecar offers different fuse options', () => {
    const grenade = { ...CPU_WEAPON_META.grenade, fuseOptionsMs: [1000, 2000, 3000] };
    const meta = { ...CPU_WEAPON_META, grenade };
    expectError(errorsOf(WEAPONS, meta as Record<string, SanitizeWeaponInfo>), 'grenade', 'fuseOptionsMs');
  });

  it('fails when the sidecar exposes a fuse for a weapon that is not TIMED', () => {
    const dynamite = { ...CPU_WEAPON_META.dynamite, fuseOptionsMs: [5000], fuseDefaultMs: 5000 };
    const meta = { ...CPU_WEAPON_META, dynamite };
    expectError(errorsOf(WEAPONS, meta as Record<string, SanitizeWeaponInfo>), 'dynamite', 'fuse');
  });

  it('fails when the sidecar table is missing a weapon or has an extra one', () => {
    const { mine: _mine, ...missing } = CPU_WEAPON_META;
    expectError(errorsOf(WEAPONS, missing), 'mine', 'sidecar');
    const extra = { ...CPU_WEAPON_META, prod: { ...CPU_WEAPON_META.bazooka, id: 'prod' } };
    expectError(errorsOf(WEAPONS, extra as Record<string, SanitizeWeaponInfo>), 'prod', 'sidecar');
  });
});
