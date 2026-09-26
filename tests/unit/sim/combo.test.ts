import { describe, expect, it } from 'vitest';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { lockTarget } from '@/weapons/behaviors/combo.ts';
import { comboTicks, heldWormIds } from '@/sim/combo.ts';
import { addWorm, stepWorld, worldAtRest, type SimWorld } from '@/sim/world.ts';
import type { SimEvent } from '@/sim/types.ts';
import { flatWorld } from './fixture.ts';

const SUPER = WEAPONS.ryuko_ranbu;
const COMBO = SUPER.combo!;

function arena(options: { wall?: { x: number; height: number } } = {}) {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480, ...(options.wall === undefined ? {} : { wall: options.wall }) });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  return { world, hero };
}

/** Steps until the combo is gone (or a cap), returning every event on the way. */
function playOut(world: SimWorld, cap = 1200): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < cap && world.combos.length > 0; i += 1) events.push(...stepWorld(world));
  return events;
}

describe('ryuko ranbu: the row', () => {
  it('is a melee row with a combo block worth the dynamite figure', () => {
    expect(SUPER.kind).toBe('MELEE');
    expect(SUPER.category).toBe('melee');
    expect(COMBO.hits * COMBO.damagePerHit + COMBO.finisherDamage).toBe(75);
    expect(SUPER.melee?.damage).toBe(75);
    expect(SUPER.melee?.reachPx).toBe(COMBO.rangePx);
    expect(SUPER.ammo).toBe(1);
    expect(SUPER.delayTurns).toBe(2);
    expect(SUPER.endsTurnOnFire).toBe(true);
  });
});

describe('ryuko ranbu: the lock', () => {
  it('locks the nearest enemy in sight and in reach, never a team mate', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'mate', teamId: 'a', x: 320, y: 349 });
    const near = addWorm(world, { id: 'near', teamId: 'b', x: 380, y: 349 });
    addWorm(world, { id: 'far', teamId: 'b', x: 440, y: 349 });
    expect(lockTarget(world, hero, COMBO.rangePx)?.id).toBe(near.id);
  });

  it('prefers the enemy in front over a slightly closer one behind', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'behind', teamId: 'b', x: 230, y: 349 });
    const ahead = addWorm(world, { id: 'ahead', teamId: 'b', x: 390, y: 349 });
    expect(lockTarget(world, hero, COMBO.rangePx)?.id).toBe(ahead.id);
  });

  it('ignores an enemy out of reach or behind a wall', () => {
    const far = arena();
    addWorm(far.world, { id: 'far', teamId: 'b', x: 300 + COMBO.rangePx + 20, y: 349 });
    expect(lockTarget(far.world, far.hero, COMBO.rangePx)).toBeNull();
    const walled = arena({ wall: { x: 340, height: 40 } });
    addWorm(walled.world, { id: 'hidden', teamId: 'b', x: 380, y: 349 });
    expect(lockTarget(walled.world, walled.hero, COMBO.rangePx)).toBeNull();
  });
});

describe('ryuko ranbu: the beating', () => {
  it('lands every blow and the finisher, 75 in all, then throws the victim up and away', () => {
    const { world, hero } = arena();
    const victim = addWorm(world, { id: 'victim', teamId: 'b', x: 400, y: 349 });
    const result = fire(world, hero, SUPER, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(world.combos).toHaveLength(1);
    expect(world.events.some((e) => e.type === 'comboStart')).toBe(true);

    const events = playOut(world);
    const blows = events.filter((e) => e.type === 'damage' && e.wormId === victim.id);
    expect(blows).toHaveLength(COMBO.hits + 1);
    expect(blows.reduce((sum, e) => sum + (e.type === 'damage' ? e.amount : 0), 0)).toBe(75);
    // Every blow carries where it landed and which way it pushed, for the blood.
    for (const blow of blows) expect(blow.type === 'damage' && blow.at !== undefined).toBe(true);
    const hits = events.filter((e) => e.type === 'comboHit');
    expect(hits).toHaveLength(COMBO.hits + 1);
    expect(hits.at(-1)).toMatchObject({ finisher: true, hit: COMBO.hits + 1 });
    expect(events.some((e) => e.type === 'comboEnd')).toBe(true);
    expect(world.combos).toHaveLength(0);
    // Thrown by the finisher: it left the spot where it was held, upward and along the rush.
    expect(victim.x).toBeGreaterThan(400);
    expect(victim.y).toBeLessThan(349);
  });

  it('takes the time its timeline says, and holds both fighters still while it plays', () => {
    const { world, hero } = arena();
    const victim = addWorm(world, { id: 'victim', teamId: 'b', x: 400, y: 349 });
    fire(world, hero, SUPER, { angleDeg: 0, power: 1 });
    let ticks = 0;
    let landings = 0;
    while (world.combos.length > 0 && ticks < 1000) {
      const events = stepWorld(world);
      landings += events.filter((e) => e.type === 'landed').length;
      ticks += 1;
      const combo = world.combos[0];
      if (combo !== undefined && combo.stage === 'flurry') {
        expect(victim.x).toBe(400);
        expect(victim.y).toBe(349);
        expect(hero.x).toBe(400 - 12);
        expect(heldWormIds(world.combos).has(victim.id)).toBe(true);
      }
    }
    expect(ticks).toBe(comboTicks(COMBO));
    // Held worms never touched the physics: no landing was spammed while they hung in place.
    expect(landings).toBe(0);
  });

  it('is not at rest while the combo plays, and settles after', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'victim', teamId: 'b', x: 400, y: 349 });
    fire(world, hero, SUPER, { angleDeg: 0, power: 1 });
    stepWorld(world);
    expect(worldAtRest(world)).toBe(false);
    playOut(world);
    let settled = false;
    for (let i = 0; i < 1200 && !settled; i += 1) {
      stepWorld(world);
      settled = worldAtRest(world);
    }
    expect(settled).toBe(true);
    // The attacker is left standing on the ground beside where the victim was.
    expect(hero.onGround).toBe(true);
    expect(Math.abs(hero.x - 388)).toBeLessThan(2);
  });

  it('whiffs with nobody in reach: no damage, the rush still plays and ends', () => {
    const { world, hero } = arena();
    const result = fire(world, hero, SUPER, { angleDeg: 0, power: 1 });
    expect(result.sequence).toBe(true);
    expect(world.combos[0]?.victimId).toBeNull();
    const events = playOut(world);
    expect(events.some((e) => e.type === 'damage')).toBe(false);
    expect(events.find((e) => e.type === 'comboEnd')).toMatchObject({ hits: 0, victimId: null });
    expect(hero.x).toBeGreaterThan(300);
  });

  it('never rushes through a wall when it whiffs', () => {
    const { world, hero } = arena({ wall: { x: 330, height: 40 } });
    fire(world, hero, SUPER, { angleDeg: 0, power: 1 });
    playOut(world);
    expect(hero.x).toBeLessThan(330);
  });
});
