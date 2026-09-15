import { describe, expect, it } from 'vitest';
import { spawnProjectile, stepProjectile } from '@/sim/projectile.ts';
import { addWorm, type SimWorld } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

/**
 * The sweep only knows the terrain mask, so a shell used to pass straight through a worm and
 * crater on the ground behind it (measured: a rocket at 600 px/s through a torso at x 300 died
 * at x 670 by the bounds rule). Contact shells now detonate on the worm they cross; grenades,
 * which bounce and burn a fuse, still do not.
 */

function arena(): SimWorld {
  // Floor far below so nothing but a worm can stop a level shot.
  const world = flatWorld({ width: 900, height: 400, floorY: 350, waterY: 390 });
  addWorm(world, { id: 'shooter', teamId: 'a', x: 100, y: 120, facing: 1 });
  addWorm(world, { id: 'target', teamId: 'b', x: 300, y: 120 });
  return world;
}

function rocket(world: SimWorld, x: number, vx: number): ReturnType<typeof spawnProjectile> {
  const def = WEAPONS.bazooka;
  if (def.projectile === undefined || def.blast === undefined) throw new Error('bazooka has no projectile spec');
  return spawnProjectile(world, {
    weaponId: 'bazooka',
    ownerTeamId: 'a',
    ownerWormId: 'shooter',
    x,
    y: 112,
    vx,
    vy: 0,
    spec: def.projectile,
    blast: def.blast,
    windAffected: false,
    gravityScale: 0,
  });
}

function stepUntilGone(world: SimWorld, p: { alive: boolean; x: number }, cap = 400): number {
  let ticks = 0;
  while (p.alive && ticks < cap) {
    stepProjectile(world, p as never, 1 / 60);
    ticks += 1;
  }
  return ticks;
}

describe('projectiles and worms', () => {
  it('hits the nearest crossed worm regardless of entity array order', () => {
    const world = arena();
    addWorm(world, { id: 'nearer', teamId: 'b', x: 260, y: 120 });
    const shell = rocket(world, 240, 6000);
    stepProjectile(world, shell, 1 / 60);
    expect(shell.alive).toBe(false);
    expect(shell.x).toBe(260);
  });
  it('a level rocket detonates on the worm it crosses instead of flying past it', () => {
    const world = arena();
    const shell = rocket(world, 140, 600);
    stepUntilGone(world, shell);
    expect(shell.alive).toBe(false);
    // Detonated at the target, not 370 px further on at the map edge.
    expect(shell.x).toBeGreaterThan(280);
    expect(shell.x).toBeLessThan(320);
    expect(world.events.some((e) => e.type === 'damage' && e.wormId === 'target')).toBe(true);
    expect(world.events.some((e) => e.type === 'projectileGone' && e.reason === 'bounds')).toBe(false);
  });

  it('spawning at the shooter does not blow up in the shooter, but the shooter is a target later', () => {
    const world = arena();
    // Launched from inside the shooter's own hitbox, leaving to the right at walking pace.
    const shell = rocket(world, 100, 60);
    for (let i = 0; i < 3; i += 1) stepProjectile(world, shell, 1 / 60);
    expect(shell.alive).toBe(true);
    // A second shell fired back at the shooter after the grace period hits home.
    const back = rocket(world, 200, -600);
    back.ageTicks = 60;
    stepUntilGone(world, back);
    expect(back.alive).toBe(false);
    expect(world.events.some((e) => e.type === 'damage' && e.wormId === 'shooter')).toBe(true);
  });

  it('a grenade flies through a worm and keeps its fuse', () => {
    const world = arena();
    const def = WEAPONS.grenade;
    if (def.projectile === undefined || def.blast === undefined) throw new Error('grenade has no projectile spec');
    const grenade = spawnProjectile(world, {
      weaponId: 'grenade',
      ownerTeamId: 'a',
      ownerWormId: 'shooter',
      x: 140,
      y: 112,
      vx: 600,
      vy: 0,
      spec: def.projectile,
      blast: def.blast,
      windAffected: false,
      gravityScale: 0,
      fuseMs: 3000,
    });
    for (let i = 0; i < 30; i += 1) stepProjectile(world, grenade, 1 / 60);
    expect(grenade.alive).toBe(true);
    expect(grenade.x).toBeGreaterThan(320);
  });
});
