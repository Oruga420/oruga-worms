import { describe, expect, it } from 'vitest';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { cancelDevours, devourHand, devourTicks, drumTicks, heldByDevours, SWALLOW_DAMAGE } from '@/sim/devour.ts';
import { WORM_HEIGHT } from '@/sim/constants.ts';
import { addWorm, stepWorld, worldAtRest, type SimWorld } from '@/sim/world.ts';
import type { DevourBeat, SimEvent } from '@/sim/types.ts';
import { flatWorld, type FlatWorldOptions } from './fixture.ts';

const GEAR = WEAPONS.gear_five;
const SPEC = GEAR.devour!;
const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));

function arena(options: Partial<FlatWorldOptions> = {}) {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480, ...options });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  return { world, hero };
}

/** Steps until the devour is gone (or a cap), returning every event on the way. */
function playOut(world: SimWorld, cap = 2000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < cap && world.devours.length > 0; i += 1) events.push(...stepWorld(world));
  return events;
}

function beats(events: readonly SimEvent[]): DevourBeat[] {
  return events.flatMap((e) => (e.type === 'devourBeat' ? [e.beat] : []));
}

function damageTo(events: readonly SimEvent[], wormId: string): number[] {
  return events.flatMap((e) => (e.type === 'damage' && e.wormId === wormId ? [e.amount] : []));
}

describe('gear 5: the row', () => {
  it('is a melee super, bare handed, one per worm, the last to unlock and never in a crate', () => {
    expect(GEAR.kind).toBe('MELEE');
    expect(GEAR.category).toBe('melee');
    expect(GEAR.heldSprite).toBeNull();
    expect(GEAR.melee?.reachPx).toBe(SPEC.rangePx);
    expect(GEAR.melee?.damage).toBe(SPEC.chomps * SPEC.chompDamage);
    expect(GEAR.ammo).toBe(1);
    expect(GEAR.delayTurns).toBe(4);
    expect(GEAR.crateWeight).toBe(0);
    expect(GEAR.combo).toBeUndefined();
  });
});

describe('gear 5: the awakening', () => {
  it('holds both worms, even one in the air, and beats the drums before anything else happens', () => {
    const { world, hero } = arena();
    hero.y = 300;
    hero.motion = 'falling';
    hero.onGround = false;
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 400, y: 349 });
    const result = fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(world.devours).toHaveLength(1);
    expect(world.events.some((e) => e.type === 'devourStart' && e.victimId === 'enemy')).toBe(true);
    const awakening: SimEvent[] = [];
    for (let i = 0; i < ticks(SPEC.awakenMs) - 1; i += 1) awakening.push(...stepWorld(world));
    expect(beats(awakening)).toEqual(Array.from({ length: SPEC.drums }, () => 'drum'));
    expect(awakening.flatMap((e) => (e.type === 'devourBeat' ? [e.n] : []))).toEqual([1, 2, 3, 4]);
    expect(damageTo(awakening, 'enemy')).toEqual([]);
    expect(hero.y).toBe(300);
    expect(enemy.x).toBe(400);
    expect(heldByDevours(world.devours)).toEqual(new Set(['hero', 'enemy']));
    expect(beats(stepWorld(world))).toEqual(['awake', 'stretch']);
  });

  it('spreads the drums evenly and keeps the last one a beat before the awakening', () => {
    const at = drumTicks(SPEC);
    expect(at).toHaveLength(SPEC.drums);
    const gaps = at.slice(1).map((t, i) => t - (at[i] ?? 0));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(at[at.length - 1]).toBeLessThan(ticks(SPEC.awakenMs));
  });
});

describe('gear 5: the meal', () => {
  it('grabs the enemy, reels it into the mouth, bites it four times, swallows it and burps', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 450, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    const events: SimEvent[] = [];
    let ticksUsed = 0;
    let inMouth = false;
    while (world.devours.length > 0 && ticksUsed < 2000) {
      events.push(...stepWorld(world));
      ticksUsed += 1;
      const devour = world.devours[0];
      if (devour?.stage === 'chew') inMouth ||= enemy.x === devour.mouthX && enemy.y === devour.mouthY;
    }
    expect(beats(events)).toEqual(['drum', 'drum', 'drum', 'drum', 'awake', 'stretch', 'grab', 'chomp', 'chomp', 'chomp', 'chomp', 'gulp', 'burp']);
    expect(damageTo(events, 'enemy')).toEqual([...Array.from({ length: SPEC.chomps }, () => SPEC.chompDamage), SWALLOW_DAMAGE]);
    expect(inMouth).toBe(true);
    // Swallowed: the body is out of the world, the eater let go where it stood.
    expect(enemy.alive).toBe(false);
    expect(enemy.motion).toBe('dead');
    expect(hero.x).toBe(300);
    expect(hero.motion).toBe('falling');
    expect(events.find((e) => e.type === 'devourEnd')).toMatchObject({ eaten: true, victimId: 'enemy' });
    expect(ticksUsed).toBe(devourTicks(SPEC));
  });

  it('credits every bite and the swallow to the eater, with the blood going out of the mouth', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 250, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    // Behind the worm, so it turns round to face its meal.
    expect(hero.facing).toBe(-1);
    const events = playOut(world);
    // The eater pays for the move first (its toll), then every bite and the swallow are its.
    const toll = events.filter((e) => e.type === 'damage' && e.cause === 'toll');
    expect(toll).toEqual([expect.objectContaining({ wormId: 'hero', amount: GEAR.toll, sourceTeamId: null, sourceWormId: null })]);
    const bites = events.filter((e) => e.type === 'damage' && e.cause !== 'toll');
    expect(bites.length).toBe(SPEC.chomps + 1);
    for (const e of bites) {
      if (e.type !== 'damage') continue;
      expect(e).toMatchObject({ sourceTeamId: 'a', sourceWormId: 'hero', cause: 'melee' });
      expect(e.at?.dx).toBeLessThan(0);
      expect(e.at?.dy).toBeLessThan(0);
    }
  });

  it('lets the victim go once it is swallowed, and holds the eater to the end', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 420, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    let heldAfterGulp: ReadonlySet<string> | null = null;
    while (world.devours.length > 0) {
      const events = stepWorld(world);
      if (beats(events).includes('gulp')) heldAfterGulp = heldByDevours(world.devours);
    }
    expect(heldAfterGulp).toEqual(new Set(['hero']));
    expect(worldAtRest(world)).toBe(false);
    for (let i = 0; i < 300 && !worldAtRest(world); i += 1) stepWorld(world);
    expect(worldAtRest(world)).toBe(true);
    expect(hero.alive).toBe(true);
  });
});

describe('gear 5: the arm', () => {
  it('flies out from the shoulder to the victim and comes back with it, holding its middle', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 460, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    const devour = world.devours[0]!;
    expect(devourHand(devour)).toBeNull();
    while (devour.stage === 'awaken') stepWorld(world);
    // The arm leaves from the shoulder on the stretch's first tick.
    expect(devourHand(devour)).toEqual({ x: devour.shoulderX, y: devour.shoulderY });
    stepWorld(world);
    const first = devourHand(devour)!;
    expect(first.x).toBeGreaterThan(devour.shoulderX);
    expect(first.x).toBeLessThan(devour.reachX);
    while (devour.stage === 'stretch') stepWorld(world);
    stepWorld(world);
    expect(devour.stage).toBe('reel');
    const hand = devourHand(devour)!;
    expect(hand.x).toBeCloseTo(enemy.x);
    expect(hand.y).toBeCloseTo(enemy.y - WORM_HEIGHT / 2);
    expect(enemy.x).toBeLessThan(460);
    while (devour.stage === 'reel') stepWorld(world);
    expect(devourHand(devour)).toBeNull();
  });

  it('grabs at the air when nobody is in reach: no bites, no swallow, and a shorter turn', () => {
    const { world, hero } = arena();
    const far = addWorm(world, { id: 'far', teamId: 'b', x: 300 + SPEC.rangePx + 40, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    const devour = world.devours[0]!;
    expect(devour.victimId).toBeNull();
    expect(devour.reachX).toBeCloseTo(300 + SPEC.rangePx);
    let ticksUsed = 0;
    const events: SimEvent[] = [];
    while (world.devours.length > 0) {
      events.push(...stepWorld(world));
      ticksUsed += 1;
    }
    expect(beats(events)).toEqual(['drum', 'drum', 'drum', 'drum', 'awake', 'stretch', 'snap']);
    // Nobody bitten; the price is paid all the same.
    expect(events.some((e) => e.type === 'damage' && e.cause !== 'toll')).toBe(false);
    expect(events.filter((e) => e.type === 'damage' && e.cause === 'toll')).toHaveLength(1);
    expect(events.find((e) => e.type === 'devourEnd')).toMatchObject({ eaten: false, victimId: null });
    expect(far.alive).toBe(true);
    expect(ticksUsed).toBe(devourTicks(SPEC, false));
  });

  it('never reaches through a wall: an enemy behind one is out of sight, and the arm stops at it', () => {
    const { world, hero } = arena({ wall: { x: 360, height: 60, width: 8 } });
    addWorm(world, { id: 'hidden', teamId: 'b', x: 420, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    const devour = world.devours[0]!;
    expect(devour.victimId).toBeNull();
    expect(devour.reachX).toBeLessThan(360);
    expect(devour.reachX).toBeGreaterThan(300);
  });
});

describe('gear 5: cut short', () => {
  it('lets both worms go, the victim alive and uneaten, when the match ends mid meal', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 420, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    while (world.devours[0]?.stage !== 'chew') stepWorld(world);
    stepWorld(world);
    cancelDevours(world);
    expect(world.devours).toHaveLength(0);
    expect(world.events.find((e) => e.type === 'devourEnd')).toMatchObject({ eaten: false });
    expect(enemy.alive).toBe(true);
    expect(enemy.motion).toBe('falling');
    expect(hero.motion).toBe('falling');
  });

  it('ends when the eater dies, and drops the victim it was holding', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 420, y: 349 });
    fire(world, hero, GEAR, { angleDeg: 0, power: 1 });
    for (let i = 0; i < 10; i += 1) stepWorld(world);
    hero.alive = false;
    const events = stepWorld(world);
    expect(world.devours).toHaveLength(0);
    expect(events.find((e) => e.type === 'devourEnd')).toMatchObject({ eaten: false });
    expect(enemy.alive).toBe(true);
    expect(enemy.motion).toBe('falling');
  });
});
