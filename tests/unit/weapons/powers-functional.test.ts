import { describe, expect, it } from 'vitest';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { validateUtilityTarget } from '@/weapons/behaviors/utility.ts';
import { addWorm, stepWorld } from '@/sim/world.ts';
import { stepProjectile } from '@/sim/projectile.ts';
import { TICK_S } from '@/sim/constants.ts';
import { flatWorld } from '../sim/fixture.ts';

function arena() {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480 });
  const worm = addWorm(world, { id: 'shooter', teamId: 'a', x: 100, y: 349 });
  return { world, worm };
}

describe('functional power regressions', () => {
  it('dynamite stays on the ground for its entire fuse, then explodes', () => {
    const { world, worm } = arena();
    fire(world, worm, WEAPONS.dynamite, { angleDeg: 0, power: 1 });
    const body = world.projectiles[0]!;
    const duration = body.fuseTicks;
    for (let i = 0; i < duration - 1; i += 1) stepProjectile(world, body, TICK_S);
    expect(body.alive).toBe(true);
    expect(body.vx).toBe(0);
    expect(body.vy).toBe(0);
    expect(world.events.some((e) => e.type === 'explosion')).toBe(false);
    stepProjectile(world, body, TICK_S);
    expect(body.alive).toBe(false);
    expect(world.events.some((e) => e.type === 'explosion')).toBe(true);
  });

  it.each(['fire_punch', 'baseball_bat'] as const)('%s launches its victim upward and away', (id) => {
    const { world, worm } = arena();
    const victim = addWorm(world, { id: 'target', teamId: 'b', x: 114, y: 349 });
    fire(world, worm, WEAPONS[id], { angleDeg: 45, power: 1 });
    expect(victim.vy).toBeLessThan(0);
    expect(victim.vx).toBeGreaterThan(0);
    expect(world.events.some((e) => e.type === 'damage' && e.wormId === victim.id)).toBe(true);
    stepWorld(world);
    expect(victim.y).toBeLessThan(349);
  });

  it.each(['bazooka', 'homing_missile', 'longbow', 'tank'] as const)('%s damages a directly hit worm', (id) => {
    const { world, worm } = arena();
    addWorm(world, { id: 'target', teamId: 'b', x: 135, y: 349 });
    fire(world, worm, WEAPONS[id], { angleDeg: 0, power: 1, targetPoint: { x: 135, y: 340 } });
    const body = world.projectiles[0]!;
    for (let i = 0; i < 20 && body.alive; i += 1) stepProjectile(world, body, TICK_S);
    expect(world.events.some((e) => e.type === 'damage' && e.wormId === 'target')).toBe(true);
  });

  it.each(['mortar', 'cluster_bomb', 'banana_bomb', 'napalm'] as const)('%s emits its configured child payload', (id) => {
    const { world, worm } = arena();
    fire(world, worm, WEAPONS[id], { angleDeg: -60, power: 0.05, fuseMs: 1000 });
    const body = world.projectiles[0]!;
    for (let i = 0; i < 900 && body.alive; i += 1) stepProjectile(world, body, TICK_S);
    expect(body.alive).toBe(false);
    expect(world.projectiles.filter((p) => p.kind === 'cluster_child')).toHaveLength(WEAPONS[id].cluster!.count);
  });

  it.each(['handgun', 'shotgun', 'uzi', 'minigun', 'sonic_blast'] as const)('%s applies damage and displacement', (id) => {
    const { world, worm } = arena();
    const victim = addWorm(world, { id: 'target', teamId: 'b', x: 120, y: 349 });
    fire(world, worm, WEAPONS[id], { angleDeg: 0, power: 1 });
    expect(world.events.some((e) => e.type === 'damage' && e.amount > 0 && e.wormId === victim.id)).toBe(true);
    expect(victim.vx).toBeGreaterThan(0);
  });

  it.each(['grenade', 'holy_hand_grenade'] as const)('%s eventually detonates after landing', (id) => {
    const { world, worm } = arena();
    fire(world, worm, WEAPONS[id], { angleDeg: 80, power: 0.05 });
    const body = world.projectiles[0]!;
    for (let i = 0; i < 1500 && body.alive; i += 1) stepProjectile(world, body, TICK_S);
    expect(world.events.some((e) => e.type === 'projectileGone' && e.reason === 'exploded')).toBe(true);
  });

  it('rejects girders beyond reach, inside terrain, underwater, or overlapping a worm', () => {
    const { world, worm } = arena();
    for (const targetPoint of [{ x: 1000, y: 150 }, { x: 200, y: 360 }, { x: 200, y: 490 }, { x: 100, y: 345 }]) {
      const ctx = { world, worm, def: WEAPONS.girder, aim: { angleDeg: 0, power: 1, targetPoint }, shotIndex: 0 };
      expect(validateUtilityTarget(ctx)).toBe(false);
      const before = world.terrain.mask.data.slice();
      expect(fire(world, worm, ctx.def, ctx.aim).endsTurn).toBe(false);
      expect(world.terrain.mask.data).toEqual(before);
    }
    expect(validateUtilityTarget({ world, worm, def: WEAPONS.girder, aim: { angleDeg: 0, power: 1, targetPoint: { x: 200, y: 250 } }, shotIndex: 0 })).toBe(true);
  });

  it('a placed mine arms near a worm and explodes after its warning fuse', () => {
    const { world, worm } = arena();
    fire(world, worm, WEAPONS.mine, { angleDeg: 0, power: 1 });
    const mine = world.mines[0]!;
    let exploded = false;
    for (let i = 0; i < 400; i += 1) {
      exploded ||= stepWorld(world).some((event) => event.type === 'explosion');
      if (exploded) break;
    }
    expect(mine.armed).toBe(true);
    expect(exploded).toBe(true);
  });

  it('sheep moves and obeys a manual detonation request', () => {
    const { world, worm } = arena();
    fire(world, worm, WEAPONS.sheep, { angleDeg: 0, power: 1 });
    const sheep = world.sheep[0]!;
    const initialX = sheep.x;
    for (let i = 0; i < 30; i += 1) stepWorld(world);
    expect(sheep.x).toBeGreaterThan(initialX);
    sheep.detonateRequested = true;
    expect(stepWorld(world).some((e) => e.type === 'explosion')).toBe(true);
    expect(world.sheep).toHaveLength(0);
  });

  it('air strike bombs reach terrain and produce explosions', () => {
    const { world, worm } = arena();
    fire(world, worm, WEAPONS.air_strike, { angleDeg: 0, power: 1, targetPoint: { x: 600, y: 350 } });
    let explosions = 0;
    for (let i = 0; i < 600 && world.projectiles.length > 0; i += 1) {
      explosions += stepWorld(world).filter((e) => e.type === 'explosion').length;
    }
    expect(explosions).toBe(WEAPONS.air_strike.strike!.count);
    expect(world.projectiles).toHaveLength(0);
  });

  it('utilities grant fuel, controlled descent, safe relocation, terrain, and an explicit pass', () => {
    const { world, worm } = arena();
    const aim = { angleDeg: 0, power: 1 };
    expect(fire(world, worm, WEAPONS.jetpack, aim).controlledDescent).toBe(true);
    expect(worm.fuelMs).toBe(WEAPONS.jetpack.utility!.fuelMs);
    expect(fire(world, worm, WEAPONS.parachute, aim).controlledDescent).toBe(true);
    expect(worm.motion).toBe('parachuting');
    expect(fire(world, worm, WEAPONS.teleport, { ...aim, targetPoint: { x: 200, y: 350 } }).endsTurn).toBe(true);
    expect([worm.x, worm.y]).toEqual([200, 349]);
    fire(world, worm, WEAPONS.girder, { ...aim, targetPoint: { x: 300, y: 250 } });
    expect(world.terrain.mask.data[250 * world.terrain.width + 300]).not.toBe(0);
    expect(fire(world, worm, WEAPONS.skip_go, aim).endsTurn).toBe(true);
  });
});
