import { describe, expect, it } from 'vitest';
import { REST_TICKS } from '@/sim/constants.ts';
import { spawnCrate } from '@/sim/crate.ts';
import { spawnMine } from '@/sim/mine.ts';
import { spawnProjectile } from '@/sim/projectile.ts';
import { allAtRest } from '@/sim/rest.ts';
import { spawnSheep } from '@/sim/sheep.ts';
import { bombColumns, launchStrike } from '@/sim/strike.ts';
import { addWorm, settle, stepWorld, worldAtRest } from '@/sim/world.ts';
import { blast, contactProjectile } from '@/weapons/defs/shared.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

describe('world stepping and rest', () => {
  it('is at rest with idle worms on the ground and no live bodies, and settle converges', () => {
    const world = flatWorld({ floorY: 200 });
    addWorm(world, { id: 'a', teamId: 't', x: 50, y: 199 });
    expect(worldAtRest(world)).toBe(false);
    const { ticks } = settle(world, 600);
    expect(ticks).toBeGreaterThanOrEqual(REST_TICKS);
    expect(worldAtRest(world)).toBe(true);
    spawnProjectile(world, { weaponId: 'bazooka', ownerTeamId: null, ownerWormId: null, x: 100, y: 50, vx: 0, vy: 0, spec: contactProjectile('proj_rocket', 3), blast: blast(97, 50, 10, 'medium'), windAffected: false, gravityScale: 1 });
    expect(allAtRest(world)).toBe(false);
    settle(world, 600);
    expect(worldAtRest(world)).toBe(true);
    expect(world.projectiles).toHaveLength(0);
  });

  it('drops a crate that lands, then a worm picks it up', () => {
    const world = flatWorld({ floorY: 200 });
    const worm = addWorm(world, { id: 'w', teamId: 't', x: 300, y: 199 });
    const crate = spawnCrate(world, 'health', 120);
    let landed = false;
    for (let i = 0; i < 600 && !landed; i += 1) landed = stepWorld(world).some((e) => e.type === 'crateLanded');
    expect(landed).toBe(true);
    expect(crate.landed).toBe(true);
    expect(crate.y).toBe(199);
    worm.x = 121;
    const events = stepWorld(world);
    expect(events.some((e) => e.type === 'cratePicked' && e.wormId === 'w')).toBe(true);
    expect(world.crates).toHaveLength(0);
  });

  it('arms a mine when an enemy comes close and explodes it after the fuse', () => {
    const world = flatWorld({ floorY: 200 });
    const mine = spawnMine(world, { ownerTeamId: 'a', x: 100, y: 195, spec: WEAPONS.mine.spawn!, blast: WEAPONS.mine.blast! });
    for (let i = 0; i < 30; i += 1) stepWorld(world);
    expect(mine.armed).toBe(false);
    addWorm(world, { id: 'e', teamId: 'b', x: 110, y: 199 });
    stepWorld(world);
    expect(mine.armed).toBe(true);
    let exploded = false;
    for (let i = 0; i < 400 && !exploded; i += 1) exploded = stepWorld(world).some((e) => e.type === 'explosion');
    expect(exploded).toBe(true);
    expect(world.mines).toHaveLength(0);
  });

  it('walks a sheep forward and detonates it on request', () => {
    const world = flatWorld({ floorY: 200 });
    const sheep = spawnSheep(world, { ownerTeamId: 'a', ownerWormId: 'w', x: 100, y: 199, facing: 1, spec: WEAPONS.sheep.spawn!, blast: WEAPONS.sheep.blast! });
    for (let i = 0; i < 60; i += 1) stepWorld(world);
    expect(sheep.x).toBeGreaterThan(100);
    sheep.detonateRequested = true;
    const events = stepWorld(world);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(world.sheep).toHaveLength(0);
  });

  it('launches an air strike of five bombs centered on the target', () => {
    expect(bombColumns(200, 5, 20, 1)).toEqual([160, 180, 200, 220, 240]);
    expect(bombColumns(200, 5, 20, -1)).toEqual([240, 220, 200, 180, 160]);
    const world = flatWorld({ floorY: 200 });
    const bombs = launchStrike(world, { weaponId: 'air_strike', ownerTeamId: 'a', ownerWormId: 'w', targetX: 200, direction: 1, strike: WEAPONS.air_strike.strike! });
    expect(bombs).toHaveLength(WEAPONS.air_strike.strike!.count);
    const { events } = settle(world, 900);
    expect(events.filter((e) => e.type === 'explosion').length).toBe(bombs.length);
  });
});
