import { describe, expect, it } from 'vitest';
import { fire, type FireAim } from '@/weapons/fire.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';
import { addWorm, stepWorld, type SimWorld } from '@/sim/world.ts';
import { flatWorld } from '../sim/fixture.ts';

const AIM: FireAim = { angleDeg: 45, power: 1 };

function world(): { world: SimWorld; wormId: string } {
  const w = flatWorld({ width: 900, floorY: 200 });
  addWorm(w, { id: 'shooter', teamId: 'a', x: 400, y: 199, facing: 1 });
  addWorm(w, { id: 'enemy', teamId: 'b', x: 414, y: 199 });
  return { world: w, wormId: 'shooter' };
}

function shooter(w: SimWorld) {
  const s = w.worms.find((x) => x.id === 'shooter');
  if (s === undefined) throw new Error('no shooter');
  return s;
}

describe('fire dispatch', () => {
  it('every weapon fires without throwing and reports whether the turn ends', () => {
    for (const id of WEAPON_IDS) {
      const { world: w } = world();
      const aim: FireAim = id === 'air_strike' || id === 'teleport' || id === 'girder' ? { ...AIM, targetPoint: { x: 500, y: 150 } } : AIM;
      const result = fire(w, shooter(w), WEAPONS[id], aim);
      expect(typeof result.endsTurn).toBe('boolean');
      expect(result.shotsRemaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('a bazooka spawns a moving shell in the facing direction and ends the turn', () => {
    const { world: w } = world();
    const result = fire(w, shooter(w), WEAPONS.bazooka, AIM);
    expect(w.projectiles).toHaveLength(1);
    expect(w.projectiles[0]?.vx).toBeGreaterThan(0);
    expect(w.projectiles[0]?.vy).toBeLessThan(0);
    expect(result.endsTurn).toBe(true);
    expect(w.events.some((e) => e.type === 'sound' && e.id === 'wpn_bazooka_launch')).toBe(true);
  });

  it('a charged shell flies farther at full power than at low power', () => {
    const low = world();
    const high = world();
    fire(low.world, shooter(low.world), WEAPONS.bazooka, { angleDeg: 30, power: 0.2 });
    fire(high.world, shooter(high.world), WEAPONS.bazooka, { angleDeg: 30, power: 1 });
    const lowSpeed = Math.hypot(low.world.projectiles[0]?.vx ?? 0, low.world.projectiles[0]?.vy ?? 0);
    const highSpeed = Math.hypot(high.world.projectiles[0]?.vx ?? 0, high.world.projectiles[0]?.vy ?? 0);
    expect(highSpeed).toBeGreaterThan(lowSpeed * 2);
  });

  it('the shotgun keeps the turn for its second barrel then ends it, and hits the enemy', () => {
    const { world: w } = world();
    const first = fire(w, shooter(w), WEAPONS.shotgun, { angleDeg: 0, power: 1 }, 0);
    expect(first.endsTurn).toBe(false);
    expect(first.shotsRemaining).toBe(1);
    const second = fire(w, shooter(w), WEAPONS.shotgun, { angleDeg: 0, power: 1 }, 1);
    expect(second.endsTurn).toBe(true);
    expect(w.events.some((e) => e.type === 'damage' && e.wormId === 'enemy')).toBe(true);
    // The hit is visible: a small burst where the round lands, so a gun that connects looks
    // different from one that misses.
    expect(w.events.some((e) => e.type === 'explosion' && e.shake === 0)).toBe(true);
  });

  it('a gun that hits nothing still shows where the round landed', () => {
    const { world: w } = world();
    fire(w, shooter(w), WEAPONS.handgun, { angleDeg: -60, power: 1 });
    expect(w.events.some((e) => e.type === 'explosion')).toBe(true);
  });

  it('teleport snaps a click on the ground to a standing spot and refuses solid rock without ending the turn', () => {
    const onGround = world();
    const s = shooter(onGround.world);
    // The floor starts at y 200, so a click ON the surface is inside solid terrain.
    const landed = fire(onGround.world, s, WEAPONS.teleport, { ...AIM, targetPoint: { x: 600, y: 200 } });
    expect(landed.endsTurn).toBe(true);
    expect(s.x).toBe(600);
    expect(s.y).toBe(199);
    const inRock = world();
    const r = shooter(inRock.world);
    const refused = fire(inRock.world, r, WEAPONS.teleport, { ...AIM, targetPoint: { x: 600, y: 260 } });
    expect(refused.endsTurn).toBe(false);
    expect(r.x).toBe(400);
    expect(r.y).toBe(199);
  });

  it('the baseball bat throws the enemy sideways', () => {
    const { world: w } = world();
    fire(w, shooter(w), WEAPONS.baseball_bat, { angleDeg: 45, power: 1 });
    const enemy = w.worms.find((x) => x.id === 'enemy');
    expect(enemy?.vx).toBeGreaterThan(0);
    expect(enemy?.motion).toBe('flying');
    expect(w.events.some((e) => e.type === 'damage' && e.cause === 'melee')).toBe(true);
  });

  it('a placed mine and dynamite drop at the feet', () => {
    const mineWorld = world();
    fire(mineWorld.world, shooter(mineWorld.world), WEAPONS.mine, AIM);
    expect(mineWorld.world.mines).toHaveLength(1);
    const dynWorld = world();
    fire(dynWorld.world, shooter(dynWorld.world), WEAPONS.dynamite, AIM);
    expect(dynWorld.world.projectiles).toHaveLength(1);
    expect(dynWorld.world.projectiles[0]?.vx).toBe(0);
  });

  it('an air strike drops the whole flight and a sheep starts walking', () => {
    const strikeWorld = world();
    fire(strikeWorld.world, shooter(strikeWorld.world), WEAPONS.air_strike, { ...AIM, targetPoint: { x: 500, y: 150 } });
    expect(strikeWorld.world.projectiles.length).toBe(WEAPONS.air_strike.strike?.count);
    const sheepWorld = world();
    fire(sheepWorld.world, shooter(sheepWorld.world), WEAPONS.sheep, AIM);
    expect(sheepWorld.world.sheep).toHaveLength(1);
  });

  it('teleport moves the worm to a free target and ends the turn; girder adds land and keeps it', () => {
    const { world: w } = world();
    const s = shooter(w);
    const result = fire(w, s, WEAPONS.teleport, { ...AIM, targetPoint: { x: 600, y: 150 } });
    expect(s.x).toBe(600);
    expect(s.y).toBe(150);
    expect(result.endsTurn).toBe(true);
    const gWorld = world();
    const girder = fire(gWorld.world, shooter(gWorld.world), WEAPONS.girder, { ...AIM, targetPoint: { x: 500, y: 150 } });
    expect(girder.endsTurn).toBe(false);
    expect(gWorld.world.events.some((e) => e.type === 'activity' && e.kind === 'carve')).toBe(true);
  });

  it('parachute and jetpack start a controlled descent that keeps the turn', () => {
    const { world: w } = world();
    const s = shooter(w);
    const chute = fire(w, s, WEAPONS.parachute, AIM);
    expect(chute.controlledDescent).toBe(true);
    expect(s.motion).toBe('parachuting');
    const jet = fire(w, s, WEAPONS.jetpack, AIM);
    expect(jet.controlledDescent).toBe(true);
    expect(s.fuelMs).toBeGreaterThan(0);
  });

  it('a fired bazooka eventually explodes when stepped', () => {
    // A steep, modest lob so the shell lands inside the 900 px test map (full power at 25 px/frame flies off).
    const { world: w } = world();
    fire(w, shooter(w), WEAPONS.bazooka, { angleDeg: 75, power: 0.6 });
    let exploded = false;
    for (let i = 0; i < 600 && !exploded; i += 1) exploded = stepWorld(w).some((e) => e.type === 'explosion');
    expect(exploded).toBe(true);
  });
});
