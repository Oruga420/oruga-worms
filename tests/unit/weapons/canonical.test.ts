/**
 * Spot checks of the canonical numbers from the ultraplan rev 2 "Weapon roster v1" card. Crater
 * DIAMETERS in the table become radiusPx = diameter / 2; times are ms; speeds are px per second
 * derived from source px per frame through config/units.ts.
 */

import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { pxPerSourceFrameToPxPerSecond, sourceFramesToTicks, ticksToMs } from '@/config/units.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';
import { SOURCE_GRAVITY_PX_PER_FRAME_SQ, SOURCE_LAUNCH_SPEED_PX_PER_FRAME } from '@/weapons/defs/shared.ts';

const FUSE_OPTIONS = [1000, 2000, 3000, 4000, 5000];

describe('canonical numbers: projectiles', () => {
  it('bazooka: 50 damage, 97 px crater, wind, infinite, skims water', () => {
    const def = WEAPONS.bazooka;
    expect(def.blast?.maxDamage).toBe(50);
    expect(def.blast?.radiusPx).toBe(48.5);
    expect(def.windAffected).toBe(true);
    expect(def.ammo).toBe(-1);
    expect(def.charged).toBe(true);
    expect(def.projectile?.water).toBe('skim');
    expect(def.projectile?.bounce).toBe(0);
    expect(def.maxPower).toBe(pxPerSourceFrameToPxPerSecond(SOURCE_LAUNCH_SPEED_PX_PER_FRAME));
    expect(def.maxPower).toBe(1250);
  });

  it('homing missile: locks 0.5 s, attraction ends 4 s, self destructs 10 s, passes under water', () => {
    const def = WEAPONS.homing_missile;
    expect(def.requiresTargetSelect).toBe(true);
    expect(def.ammo).toBe(1);
    expect(def.windAffected).toBe(false);
    expect(def.projectile?.homing?.activateAfterMs).toBe(500);
    expect(def.projectile?.homing?.deactivateAfterMs).toBe(4000);
    expect(def.projectile?.homing?.selfDestructMs).toBe(10_000);
    expect(def.projectile?.water).toBe('pass');
    expect(def.blast?.maxDamage).toBe(50);
    expect(def.blast?.radiusPx).toBe(48.5);
  });

  it('mortar: fixed power, 5 bomblets of 15 with 35 px craters flying back', () => {
    const def = WEAPONS.mortar;
    expect(def.charged).toBe(false);
    expect(def.maxPower).toBe(1250);
    expect(def.ammo).toBe(5);
    expect(def.cluster?.count).toBe(5);
    expect(def.cluster?.direction).toBe('back');
    expect(def.cluster?.childBlast.maxDamage).toBe(15);
    expect(def.cluster?.childBlast.radiusPx).toBe(17.5);
    expect(def.cluster?.childProjectile.bounce).toBe(0);
  });

  it('longbow: 2 arrows of 15, ammo 2, no carve, no wind', () => {
    const def = WEAPONS.longbow;
    expect(def.ammo).toBe(2);
    expect(def.shotsPerTurn).toBe(2);
    expect(def.endsTurnOnFire).toBe(false);
    expect(def.blast?.carve).toBe(false);
    expect(def.blast?.maxDamage).toBe(15);
    expect(def.windAffected).toBe(false);
    expect(def.charged).toBe(false);
  });
});

describe('canonical numbers: timed grenades', () => {
  it('grenade: fuse 1 to 5 s default 3, bounce MAX 0.96 horizontal 0.60 vertical, selectable', () => {
    const def = WEAPONS.grenade;
    expect(def.fuse?.optionsMs).toEqual(FUSE_OPTIONS);
    expect(def.fuse?.defaultMs).toBe(3000);
    expect(def.fuse?.selectable).toBe(true);
    expect(def.projectile?.bounce).toBe(0.6);
    expect(def.projectile?.friction).toBe(0.96);
    expect(def.projectile?.bounce).toBe(GAME_CONFIG.grenadeBounce.max.y);
    expect(def.projectile?.friction).toBe(GAME_CONFIG.grenadeBounce.max.x);
    expect(def.projectile?.bounceMode).toBe('selectable');
    expect(def.blast?.maxDamage).toBe(50);
    expect(def.blast?.radiusPx).toBe(48.5);
    expect(def.ammo).toBe(-1);
    expect(def.windAffected).toBe(false);
  });

  it('cluster bomb: ammo 3, 5 bomblets of 20 with 47 px craters, bomblets detonate on contact', () => {
    const def = WEAPONS.cluster_bomb;
    expect(def.ammo).toBe(3);
    expect(def.cluster?.count).toBe(5);
    expect(def.cluster?.direction).toBe('up');
    expect(def.cluster?.childBlast.maxDamage).toBe(20);
    expect(def.cluster?.childBlast.radiusPx).toBe(23.5);
    expect(def.cluster?.childProjectile.bounce).toBe(0);
    expect(def.cluster?.childProjectile.maxLifetimeMs).toBe(9000);
    expect(def.fuse?.optionsMs).toEqual(FUSE_OPTIONS);
  });

  it('banana bomb: crate only, forced max bounce, 5 bananas of 75 with 147 px craters', () => {
    const def = WEAPONS.banana_bomb;
    expect(def.ammo).toBe(0);
    expect(def.crateWeight).toBe(1);
    expect(def.projectile?.bounceMode).toBe('max');
    expect(def.cluster?.count).toBe(5);
    expect(def.cluster?.childBlast.maxDamage).toBe(75);
    expect(def.cluster?.childBlast.radiusPx).toBe(73.5);
  });

  it('holy hand grenade: 100 damage, 199 px crater, fixed 3 s then rest, min bounce, ammo 1', () => {
    const def = WEAPONS.holy_hand_grenade;
    expect(def.blast?.maxDamage).toBe(100);
    expect(def.blast?.radiusPx).toBe(99.5);
    expect(def.fuse?.selectable).toBe(false);
    expect(def.fuse?.optionsMs).toEqual([3000]);
    expect(def.fuse?.defaultMs).toBe(3000);
    expect(def.fuse?.restBeforeDetonate).toBe(true);
    expect(def.projectile?.bounceMode).toBe('min');
    expect(def.projectile?.bounce).toBe(GAME_CONFIG.grenadeBounce.min.y);
    expect(def.ammo).toBe(1);
    expect(def.blast?.particle).toBe('holy');
  });
});

describe('canonical numbers: firearms', () => {
  it('handgun: 6 rounds of 5, 11 px craters, aim while firing, infinite', () => {
    const def = WEAPONS.handgun;
    expect(def.hitscan?.burstCount).toBe(6);
    expect(def.hitscan?.damagePerPellet).toBe(5);
    expect(def.hitscan?.carveRadiusPx).toBe(5.5);
    expect(def.hitscan?.aimWhileFiring).toBe(true);
    expect(def.ammo).toBe(-1);
  });

  it('shotgun: 2 shots of 25 with 47 px craters, turn ends after the second shot', () => {
    const def = WEAPONS.shotgun;
    expect(def.shotsPerTurn).toBe(2);
    expect(def.endsTurnOnFire).toBe(false);
    expect(def.hitscan?.damagePerPellet).toBe(25);
    expect(def.hitscan?.carveRadiusPx).toBe(23.5);
    expect(def.hitscan?.burstCount).toBe(1);
    expect(def.ammo).toBe(-1);
  });

  it('uzi: 10 bullets one every 6 source frames; minigun: 20 bullets one every 3 frames', () => {
    expect(WEAPONS.uzi.hitscan?.burstCount).toBe(10);
    expect(WEAPONS.uzi.hitscan?.burstIntervalMs).toBeCloseTo(ticksToMs(sourceFramesToTicks(6)), 9);
    expect(WEAPONS.uzi.hitscan?.burstIntervalMs).toBeCloseTo(120, 9);
    expect(WEAPONS.minigun.hitscan?.burstCount).toBe(20);
    expect(WEAPONS.minigun.hitscan?.burstIntervalMs).toBeCloseTo(60, 9);
    expect(WEAPONS.minigun.ammo).toBe(0);
    expect(WEAPONS.minigun.crateWeight).toBe(2);
    expect(WEAPONS.uzi.hitscan?.damagePerPellet).toBe(5);
    expect(WEAPONS.minigun.hitscan?.damagePerPellet).toBe(5);
  });
});

describe('canonical numbers: melee', () => {
  it('fire punch: 30 damage, cuts the land above, infinite, upward knockback', () => {
    const def = WEAPONS.fire_punch;
    expect(def.melee?.damage).toBe(30);
    expect(def.ammo).toBe(-1);
    expect(def.melee?.carveRadiusPx ?? 0).toBeGreaterThan(0);
    expect(def.melee?.knockback.y ?? 0).toBeGreaterThan(def.melee?.knockback.x ?? 0);
  });

  it('baseball bat: 30 damage, ammo 1, calibrated to throw 643 px at 45 degrees', () => {
    const def = WEAPONS.baseball_bat;
    expect(def.melee?.damage).toBe(30);
    expect(def.ammo).toBe(1);
    expect(def.melee?.throwRangePx).toBe(643);
    const { x, y } = def.melee?.knockback ?? { x: 0, y: 0 };
    expect(x).toBeCloseTo(y, 9);
    const gravityPxPerS2 = SOURCE_GRAVITY_PX_PER_FRAME_SQ * 50 * 50;
    expect((2 * x * y) / gravityPxPerS2).toBeCloseTo(643, 6);
  });
});

describe('canonical numbers: placed, animal, strike', () => {
  it('dynamite: 75 damage, 147 px crater, fixed 5 s fuse, 5 s retreat, ammo 1', () => {
    const def = WEAPONS.dynamite;
    expect(def.blast?.maxDamage).toBe(75);
    expect(def.blast?.radiusPx).toBe(73.5);
    expect(def.fuse?.selectable).toBe(false);
    expect(def.fuse?.defaultMs).toBe(5000);
    expect(def.fuse?.optionsMs).toEqual([5000]);
    expect(def.retreatMs).toBe(5000);
    expect(def.ammo).toBe(1);
    expect(def.projectile?.bounce).toBe(0);
  });

  it('mine: placed fuse fixed 3 s after a 48 px trigger, bounces like a MAX grenade, 5 s retreat', () => {
    const def = WEAPONS.mine;
    expect(def.spawn?.entityType).toBe('mine');
    expect(def.spawn?.armDelayMs).toBe(3000);
    expect(def.spawn?.armDelayMs).toBe(GAME_CONFIG.mines.placedFuseMs);
    expect(def.spawn?.proximityPx).toBe(48);
    expect(def.projectile?.bounce).toBe(0.6);
    expect(def.projectile?.friction).toBe(0.96);
    expect(def.projectile?.bounceMode).toBe('max');
    expect(def.projectile?.chainReaction).toBe(true);
    expect(def.retreatMs).toBe(5000);
    expect(def.ammo).toBe(2);
    expect(def.blast?.maxDamage).toBe(50);
    expect(def.blast?.radiusPx).toBe(48.5);
  });

  it('sheep: 75 damage, 147 px crater, manual or 20 s, ammo 1', () => {
    const def = WEAPONS.sheep;
    expect(def.spawn?.entityType).toBe('sheep');
    expect(def.spawn?.lifetimeMs).toBe(20_000);
    expect(def.spawn?.detonateOnSecondFire).toBe(true);
    expect(def.blast?.maxDamage).toBe(75);
    expect(def.blast?.radiusPx).toBe(73.5);
    expect(def.ammo).toBe(1);
  });

  it('air strike: 5 bombs of 30 with 61 px craters, cursor target, ammo 1', () => {
    const def = WEAPONS.air_strike;
    expect(def.requiresTargetSelect).toBe(true);
    expect(def.strike?.count).toBe(5);
    expect(def.strike?.childBlast.maxDamage).toBe(30);
    expect(def.strike?.childBlast.radiusPx).toBe(30.5);
    expect(def.strike?.childProjectile.bounce).toBe(0);
    expect(def.ammo).toBe(1);
    expect(def.heldSprite).toBeNull();
  });
});

describe('canonical numbers: utilities and turn flow', () => {
  it('ammo 2, 1, 2, 3, inf and a 2 turn jetpack delay', () => {
    expect(WEAPONS.parachute.ammo).toBe(2);
    expect(WEAPONS.jetpack.ammo).toBe(1);
    expect(WEAPONS.jetpack.delayTurns).toBe(2);
    expect(WEAPONS.teleport.ammo).toBe(2);
    expect(WEAPONS.girder.ammo).toBe(3);
    expect(WEAPONS.skip_go.ammo).toBe(-1);
  });

  it('only Skip Go and Teleport end the turn among the utilities; the parachute rides the wind', () => {
    const enders = WEAPON_IDS.filter((id) => WEAPONS[id].kind === 'UTILITY' && WEAPONS[id].endsTurnOnFire);
    expect(enders).toEqual(['teleport', 'skip_go']);
    expect(WEAPONS.parachute.windAffected).toBe(true);
    expect(WEAPONS.jetpack.utility?.fuelMs).toBe(5000);
    expect(WEAPONS.girder.utility?.girderSizePx).toEqual({ w: 64, h: 16 });
  });

  it('every combat weapon ends the turn except the two shot shotgun and longbow', () => {
    const combat = WEAPON_IDS.filter((id) => WEAPONS[id].kind !== 'UTILITY');
    const keepers = combat.filter((id) => !WEAPONS[id].endsTurnOnFire);
    expect(keepers).toEqual(['longbow', 'shotgun']);
  });

  it('overrides the retreat window only where the roster says so', () => {
    const overrides = WEAPON_IDS.filter((id) => WEAPONS[id].retreatMs !== undefined).map((id) => [id, WEAPONS[id].retreatMs]);
    expect(overrides).toEqual([
      ['dynamite', 5000],
      ['mine', 5000],
      ['teleport', 0],
      ['skip_go', 0],
    ]);
  });

  it('never lets an infinite weapon into a crate', () => {
    for (const id of WEAPON_IDS) {
      if (WEAPONS[id].ammo === -1) expect(WEAPONS[id].crateWeight, id).toBe(0);
    }
  });
});
