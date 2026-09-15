import { describe, expect, it } from 'vitest';
import { explode } from '@/sim/explosion.ts';
import { spawnMine } from '@/sim/mine.ts';
import { spawnProjectile } from '@/sim/projectile.ts';
import { addWorm } from '@/sim/world.ts';
import { solidCount } from '@/terrain/terrain.ts';
import { blast, contactProjectile, grenadeProjectile } from '@/weapons/defs/shared.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

describe('explode', () => {
  it('carves the terrain, damages worms by distance and knocks them into the air', () => {
    const world = flatWorld({ floorY: 200 });
    const near = addWorm(world, { id: 'near', teamId: 'a', x: 100, y: 199 });
    const far = addWorm(world, { id: 'far', teamId: 'b', x: 130, y: 199 });
    addWorm(world, { id: 'safe', teamId: 'b', x: 300, y: 199 });
    const before = solidCount(world.terrain);
    explode(world, { x: 100, y: 195, blast: blast(97, 50, 10, 'medium'), sourceTeamId: 'a', sourceWormId: 'near' });
    expect(solidCount(world.terrain)).toBeLessThan(before);
    const damage = world.events.filter((e) => e.type === 'damage');
    const nearHit = damage.find((e) => e.type === 'damage' && e.wormId === 'near');
    const farHit = damage.find((e) => e.type === 'damage' && e.wormId === 'far');
    expect(nearHit?.type === 'damage' && nearHit.amount).toBeGreaterThan(farHit?.type === 'damage' ? farHit.amount : 0);
    expect(damage.some((e) => e.type === 'damage' && e.wormId === 'safe')).toBe(false);
    expect(near.motion).toBe('flying');
    expect(near.exemptNextLanding).toBe(true);
    expect(Math.hypot(near.vx, near.vy)).toBeGreaterThan(Math.hypot(far.vx, far.vy));
    expect(world.events.some((e) => e.type === 'explosion')).toBe(true);
    expect(world.events.some((e) => e.type === 'activity' && e.kind === 'carve')).toBe(true);
  });

  it('does not carve when the blast says so', () => {
    const world = flatWorld();
    const before = solidCount(world.terrain);
    explode(world, { x: 100, y: 195, blast: { ...blast(97, 30, 4, 'small'), carve: false }, sourceTeamId: null, sourceWormId: null });
    expect(solidCount(world.terrain)).toBe(before);
  });

  it('chain triggers nearby mines and chain reaction projectiles only', () => {
    const world = flatWorld();
    const mine = spawnMine(world, { ownerTeamId: 'a', x: 110, y: 195, spec: WEAPONS.mine.spawn!, blast: WEAPONS.mine.blast! });
    const grenade = spawnProjectile(world, {
      weaponId: 'grenade',
      ownerTeamId: 'a',
      ownerWormId: null,
      x: 115,
      y: 190,
      vx: 0,
      vy: 0,
      spec: grenadeProjectile('proj_grenade', 3, 'max', 8000, { chainReaction: true }),
      blast: blast(97, 50, 10, 'medium'),
      windAffected: false,
      gravityScale: 1,
      fuseMs: 3000,
    });
    const shell = spawnProjectile(world, {
      weaponId: 'bazooka',
      ownerTeamId: 'a',
      ownerWormId: null,
      x: 120,
      y: 190,
      vx: 0,
      vy: 0,
      spec: contactProjectile('proj_rocket', 3),
      blast: blast(97, 50, 10, 'medium'),
      windAffected: true,
      gravityScale: 1,
    });
    explode(world, { x: 100, y: 195, blast: blast(97, 50, 10, 'medium'), sourceTeamId: null, sourceWormId: null });
    expect(mine.armed).toBe(true);
    expect(mine.fuseTicks).toBe(1);
    expect(grenade.chainTriggered).toBe(true);
    expect(shell.chainTriggered).toBe(false);
  });
});
