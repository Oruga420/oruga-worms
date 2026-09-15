import { describe, expect, it } from 'vitest';
import { spawnProjectile } from '@/sim/projectile.ts';
import { stepWorld } from '@/sim/world.ts';
import { blast, contactProjectile, grenadeProjectile } from '@/weapons/defs/shared.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

function runUntil(world: ReturnType<typeof flatWorld>, predicate: (events: ReturnType<typeof stepWorld>) => boolean, maxTicks = 1200): { ticks: number; events: ReturnType<typeof stepWorld> } {
  const all: ReturnType<typeof stepWorld> = [];
  for (let i = 0; i < maxTicks; i += 1) {
    const events = stepWorld(world);
    all.push(...events);
    if (predicate(events)) return { ticks: i + 1, events: all };
  }
  return { ticks: maxTicks, events: all };
}

describe('projectiles', () => {
  it('a contact shell detonates on the floor and is gone', () => {
    const world = flatWorld({ floorY: 200 });
    const shell = spawnProjectile(world, { weaponId: 'bazooka', ownerTeamId: 'a', ownerWormId: 'w', x: 100, y: 100, vx: 60, vy: 0, spec: contactProjectile('proj_rocket', 3), blast: blast(97, 50, 10, 'medium'), windAffected: true, gravityScale: 1 });
    const { events } = runUntil(world, (e) => e.some((x) => x.type === 'explosion'));
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(shell.alive).toBe(false);
    expect(world.projectiles).toHaveLength(0);
  });

  it('wind pushes a shell sideways', () => {
    const still = flatWorld({ floorY: 290 });
    const windy = flatWorld({ floorY: 290, wind: 1 });
    const a = spawnProjectile(still, { weaponId: 'bazooka', ownerTeamId: null, ownerWormId: null, x: 100, y: 50, vx: 0, vy: 0, spec: contactProjectile('proj_rocket', 3), blast: blast(97, 50, 10, 'medium'), windAffected: true, gravityScale: 1 });
    const b = spawnProjectile(windy, { weaponId: 'bazooka', ownerTeamId: null, ownerWormId: null, x: 100, y: 50, vx: 0, vy: 0, spec: contactProjectile('proj_rocket', 3), blast: blast(97, 50, 10, 'medium'), windAffected: true, gravityScale: 1 });
    for (let i = 0; i < 20; i += 1) {
      stepWorld(still);
      stepWorld(windy);
    }
    expect(a.x).toBeCloseTo(100, 6);
    expect(b.x).toBeGreaterThan(100);
  });

  it('a grenade bounces, waits for its fuse and explodes', () => {
    const world = flatWorld({ floorY: 200 });
    const grenade = spawnProjectile(world, { weaponId: 'grenade', ownerTeamId: 'a', ownerWormId: 'w', x: 100, y: 150, vx: 30, vy: 0, spec: grenadeProjectile('proj_grenade', 3, 'max', 8000), blast: blast(97, 50, 10, 'medium'), windAffected: false, gravityScale: 1, fuseMs: 2000 });
    const { ticks, events } = runUntil(world, (e) => e.some((x) => x.type === 'explosion'));
    expect(events.some((e) => e.type === 'activity' && e.kind === 'bounce')).toBe(true);
    expect(ticks).toBeGreaterThanOrEqual(120);
    expect(ticks).toBeLessThanOrEqual(122);
    expect(grenade.alive).toBe(false);
  });

  it('a cluster bomb spawns its children at detonation', () => {
    // Wide map so the sideways-fanning children land instead of leaving the world (they carry 400 px/s).
    const world = flatWorld({ width: 900, floorY: 200 });
    const def = WEAPONS.cluster_bomb;
    spawnProjectile(world, { weaponId: 'cluster_bomb', ownerTeamId: 'a', ownerWormId: 'w', x: 450, y: 150, vx: 0, vy: 0, spec: def.projectile!, blast: def.blast!, cluster: def.cluster!, windAffected: false, gravityScale: 1, fuseMs: 1000 });
    runUntil(world, (e) => e.some((x) => x.type === 'explosion'));
    expect(world.projectiles.length).toBe(def.cluster!.count);
    expect(world.projectiles.every((p) => p.kind === 'cluster_child' && p.cluster === null)).toBe(true);
    const { events } = runUntil(world, () => world.projectiles.length === 0);
    expect(events.filter((e) => e.type === 'explosion').length).toBe(def.cluster!.count);
  });

  it('splashes into the water and a homing missile self destructs', () => {
    const world = flatWorld({ floorY: 200, waterY: 250, gap: { x0: 150, x1: 250 } });
    const shell = spawnProjectile(world, { weaponId: 'bazooka', ownerTeamId: null, ownerWormId: null, x: 200, y: 100, vx: 0, vy: 100, spec: contactProjectile('proj_rocket', 3), blast: blast(97, 50, 10, 'medium'), windAffected: false, gravityScale: 1 });
    const { events } = runUntil(world, (e) => e.some((x) => x.type === 'projectileGone'));
    expect(events.some((e) => e.type === 'projectileGone' && e.reason === 'water')).toBe(true);
    expect(shell.alive).toBe(false);
    // A big map with the target near the middle: the missile orbits the target and self destructs
    // at 10 s rather than leaving the world.
    const sky = flatWorld({ width: 2000, height: 400, floorY: 390 });
    const homing = WEAPONS.homing_missile;
    spawnProjectile(sky, { weaponId: 'homing_missile', ownerTeamId: null, ownerWormId: null, x: 50, y: 50, vx: 0, vy: -200, spec: homing.projectile!, blast: homing.blast!, windAffected: false, gravityScale: 0, homingTarget: { x: 1000, y: 50 } });
    const result = runUntil(sky, (e) => e.some((x) => x.type === 'explosion'), 2000);
    const selfDestruct = Math.round((homing.projectile!.homing!.selfDestructMs / 1000) * 60);
    expect(result.ticks).toBeLessThanOrEqual(selfDestruct + 1);
  });
});
