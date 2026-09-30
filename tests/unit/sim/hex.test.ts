import { describe, expect, it } from 'vitest';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { BURST_DAMAGE, HEX_SOUNDS, LAUGH_TICK, cancelHexes, flightTicksFor, heldByHexes, hexLight, hexTicks, pulseTicks } from '@/sim/hex.ts';
import { WORM_HEIGHT } from '@/sim/constants.ts';
import { addWorm, stepWorld, worldAtRest, type SimWorld } from '@/sim/world.ts';
import type { HexBeat, SimEvent } from '@/sim/types.ts';
import { setSpan, SOLID } from '@/terrain/mask.ts';
import { flatWorld, type FlatWorldOptions } from './fixture.ts';

const FREEZER = WEAPONS.freezer;
const SPEC = FREEZER.hex!;
const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));

function arena(options: Partial<FlatWorldOptions> = {}) {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480, ...options });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  return { world, hero };
}

/** Steps until the hex is gone (or a cap), returning every event on the way. */
function playOut(world: SimWorld, cap = 2000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < cap && world.hexes.length > 0; i += 1) events.push(...stepWorld(world));
  return events;
}

function beats(events: readonly SimEvent[]): HexBeat[] {
  return events.flatMap((e) => (e.type === 'hexBeat' ? [e.beat] : []));
}

function damageTo(events: readonly SimEvent[], wormId: string): number[] {
  return events.flatMap((e) => (e.type === 'damage' && e.wormId === wormId ? [e.amount] : []));
}

describe('freezer: the row', () => {
  it('is a hitscan super off a bare finger, one per worm, late to unlock and never in a crate', () => {
    expect(FREEZER.kind).toBe('HITSCAN');
    expect(FREEZER.category).toBe('firearm');
    expect(FREEZER.heldSprite).toBeNull();
    expect(FREEZER.hitscan?.rangePx).toBe(SPEC.rangePx);
    expect(FREEZER.ammo).toBe(1);
    expect(FREEZER.delayTurns).toBe(5);
    expect(FREEZER.crateWeight).toBe(0);
    expect(FREEZER.beam).toBeUndefined();
    expect(SPEC.burst.carve).toBe(true);
  });
});

describe('freezer: the point', () => {
  it('holds both worms, even one in the air, and keeps the light on the fingertip until the point is over', () => {
    const { world, hero } = arena();
    hero.y = 300;
    hero.motion = 'falling';
    hero.onGround = false;
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 480, y: 349 });
    const result = fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(world.hexes).toHaveLength(1);
    expect(world.events.some((e) => e.type === 'hexStart' && e.victimId === 'enemy')).toBe(true);
    const hex = world.hexes[0]!;
    const pointing: SimEvent[] = [];
    for (let i = 0; i < ticks(SPEC.pointMs) - 1; i += 1) pointing.push(...stepWorld(world));
    expect(beats(pointing)).toEqual([]);
    expect(hexLight(hex)).toBeNull();
    expect(hero.y).toBe(300);
    expect(enemy.x).toBe(480);
    expect(heldByHexes(world.hexes)).toEqual(new Set(['hero', 'enemy']));
    expect(beats(stepWorld(world))).toEqual(['shot']);
    expect(hex.stage).toBe('shot');
  });

  it('turns to point at the victim, and the light leaves from the fingertip held out toward it', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 200, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    const hex = world.hexes[0]!;
    // Behind the worm, so it turns round to point at it.
    expect(hex.facing).toBe(-1);
    expect(hero.facing).toBe(-1);
    expect(hex.tipX).toBeLessThan(hero.x);
    expect(hex.targetX).toBe(200);
    expect(hex.targetY).toBe(349 - WORM_HEIGHT / 2);
  });
});

describe('freezer: the light', () => {
  it('bows up over the straight line on its way, and arrives in the time its speed gives', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 560, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    const hex = world.hexes[0]!;
    expect(hex.flightTicks).toBe(flightTicksFor(SPEC, Math.hypot(hex.targetX - hex.tipX, hex.targetY - hex.tipY)));
    while (hex.stage === 'point') stepWorld(world);
    let highest = Infinity;
    let flown = 0;
    while (hex.stage === 'shot') {
      const light = hexLight(hex)!;
      const chordY = hex.tipY + ((light.x - hex.tipX) / (hex.targetX - hex.tipX)) * (hex.targetY - hex.tipY);
      highest = Math.min(highest, light.y - chordY);
      stepWorld(world);
      flown += 1;
    }
    expect(flown).toBe(hex.flightTicks);
    expect(highest).toBeLessThan(-hex.arcPx * 0.8);
    expect(hex.stage).toBe('rise');
  });
});

describe('freezer: the float, the swell and the burst', () => {
  it('floats the victim up, throbs faster and faster, and bursts it: all its health, credited to the attacker', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    const hex = world.hexes[0]!;
    const flight = hex.flightTicks;
    const events: SimEvent[] = [];
    let ticksUsed = 0;
    let top = 349;
    while (world.hexes.length > 0 && ticksUsed < 2000) {
      events.push(...stepWorld(world));
      ticksUsed += 1;
      if (enemy.alive) top = Math.min(top, enemy.y);
    }
    expect(beats(events)).toEqual(['shot', 'enter', 'pulse', 'pulse', 'pulse', 'pulse', 'pulse', 'burst']);
    expect(events.flatMap((e) => (e.type === 'hexBeat' && e.beat === 'pulse' ? [e.n] : []))).toEqual([1, 2, 3, 4, 5]);
    expect(349 - top).toBeCloseTo(SPEC.liftPx);
    expect(damageTo(events, 'enemy')).toEqual([BURST_DAMAGE]);
    const blow = events.find((e) => e.type === 'damage' && e.wormId === 'enemy');
    expect(blow).toMatchObject({ sourceTeamId: 'a', sourceWormId: 'hero', cause: 'blast' });
    // Burst: the body is out of the world, where it floated, and the blast went off at its middle.
    expect(enemy.alive).toBe(false);
    expect(enemy.motion).toBe('dead');
    expect(enemy.y).toBeCloseTo(349 - SPEC.liftPx);
    expect(events.find((e) => e.type === 'explosion')).toMatchObject({ x: 520, y: enemy.y - WORM_HEIGHT / 2, radius: SPEC.burst.radiusPx });
    expect(events.find((e) => e.type === 'hexEnd')).toMatchObject({ burst: true, victimId: 'enemy' });
    expect(ticksUsed).toBe(hexTicks(SPEC, flight));
    expect(hero.alive).toBe(true);
    // The scream for the victim with the burst, and the emperor's laugh a moment later.
    const cues = events.flatMap((e) => (e.type === 'sound' ? [e.id] : []));
    expect(cues).toContain(HEX_SOUNDS.krilin);
    expect(cues.indexOf(HEX_SOUNDS.laugh)).toBeGreaterThan(cues.indexOf(HEX_SOUNDS.krilin));
    expect(LAUGH_TICK).toBeLessThan(ticks(SPEC.recoverMs));
  });

  it('throbs closer and closer together, the last just before the burst', () => {
    const at = pulseTicks(SPEC);
    expect(at).toHaveLength(SPEC.pulses);
    const gaps = at.slice(1).map((t, i) => t - (at[i] ?? 0));
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] ?? 0);
    expect(at[at.length - 1]).toBeLessThan(ticks(SPEC.swellMs));
  });

  it('hurts and throws the neighbours in reach of the burst, and lets nobody be held after it', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    const friend = addWorm(world, { id: 'friend', teamId: 'b', x: 545, y: 349 });
    const far = addWorm(world, { id: 'far', teamId: 'b', x: 800, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    let heldAfterBurst: ReadonlySet<string> | null = null;
    let thrown = false;
    let restedWhileHexed = false;
    const events: SimEvent[] = [];
    while (world.hexes.length > 0) {
      const tick = stepWorld(world);
      events.push(...tick);
      if (beats(tick).includes('burst')) {
        heldAfterBurst = heldByHexes(world.hexes);
        thrown = friend.motion === 'flying';
      }
      // The laugh after the burst is part of the shot: the world is not at rest until it is over.
      if (world.hexes.length > 0) restedWhileHexed ||= worldAtRest(world);
    }
    expect(heldAfterBurst).toEqual(new Set());
    expect(thrown).toBe(true);
    expect(restedWhileHexed).toBe(false);
    const hurt = damageTo(events, 'friend');
    expect(hurt).toHaveLength(1);
    expect(hurt[0]).toBeGreaterThan(0);
    expect(hurt[0]).toBeLessThan(SPEC.burst.maxDamage);
    expect(friend.alive).toBe(true);
    expect(damageTo(events, 'far')).toEqual([]);
    expect(far.x).toBe(800);
    for (let i = 0; i < 600 && !worldAtRest(world); i += 1) stepWorld(world);
    expect(worldAtRest(world)).toBe(true);
  });

  it('catches the attacker in its own burst when the victim stood right beside it', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 322, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    const events: SimEvent[] = [];
    while (world.hexes.length > 0 && !beats(events).includes('burst')) events.push(...stepWorld(world));
    // Let go before the blast, so the blast throws it like anyone else.
    expect(hero.motion).toBe('flying');
    events.push(...playOut(world));
    const own = damageTo(events, 'hero');
    expect(own).toHaveLength(1);
    expect(own[0]).toBeGreaterThan(0);
  });

  it('floats less under a low ceiling, never into the rock', () => {
    const { world, hero } = arena();
    // A slab 22 px over the victim's head.
    for (let y = 349 - WORM_HEIGHT - 30; y < 349 - WORM_HEIGHT - 22; y += 1) setSpan(world.terrain.mask, y, 440, 600, SOLID);
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 20, power: 1 });
    const hex = world.hexes[0]!;
    expect(hex.victimId).toBe('enemy');
    expect(hex.liftPx).toBeLessThan(SPEC.liftPx);
    expect(hex.liftPx).toBeGreaterThan(0);
    let top = 349;
    while (world.hexes.length > 0 && enemy.alive) {
      stepWorld(world);
      if (enemy.alive) top = Math.min(top, enemy.y);
    }
    expect(top - WORM_HEIGHT).toBeGreaterThanOrEqual(349 - WORM_HEIGHT - 22);
  });
});

describe('freezer: a whiff', () => {
  it('sends the light straight ahead to the end of its reach when nobody is in sight: no damage, a shorter turn', () => {
    const { world, hero } = arena();
    const far = addWorm(world, { id: 'far', teamId: 'b', x: 300 + SPEC.rangePx + 60, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    const hex = world.hexes[0]!;
    expect(hex.victimId).toBeNull();
    expect(hex.targetX).toBeCloseTo(300 + SPEC.rangePx);
    expect(hex.arcPx).toBe(0);
    const flight = hex.flightTicks;
    let ticksUsed = 0;
    const events: SimEvent[] = [];
    while (world.hexes.length > 0) {
      events.push(...stepWorld(world));
      ticksUsed += 1;
    }
    expect(beats(events)).toEqual(['shot', 'fizzle']);
    expect(events.some((e) => e.type === 'damage' || e.type === 'explosion')).toBe(false);
    // Nobody burst: no scream, and nothing to laugh about.
    expect(events.some((e) => e.type === 'sound' && (e.id === HEX_SOUNDS.krilin || e.id === HEX_SOUNDS.laugh))).toBe(false);
    expect(events.find((e) => e.type === 'hexEnd')).toMatchObject({ burst: false, victimId: null });
    expect(far.alive).toBe(true);
    expect(ticksUsed).toBe(hexTicks(SPEC, flight, false));
  });

  it('never goes through a wall: an enemy behind one is out of sight, and the light goes out at it', () => {
    const { world, hero } = arena({ wall: { x: 380, height: 60, width: 8 } });
    addWorm(world, { id: 'hidden', teamId: 'b', x: 440, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    const hex = world.hexes[0]!;
    expect(hex.victimId).toBeNull();
    expect(hex.targetX).toBeLessThan(380);
    expect(hex.targetX).toBeGreaterThan(300);
  });
});

describe('freezer: cut short', () => {
  it('lets both worms go, the victim alive and whole, when the match ends mid swell', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 480, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    while (world.hexes[0]?.stage !== 'swell') stepWorld(world);
    stepWorld(world);
    cancelHexes(world);
    expect(world.hexes).toHaveLength(0);
    expect(world.events.find((e) => e.type === 'hexEnd')).toMatchObject({ burst: false });
    expect(enemy.alive).toBe(true);
    expect(enemy.motion).toBe('falling');
    expect(hero.motion).toBe('falling');
  });

  it('ends when the attacker dies, and drops the victim it was holding', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 480, y: 349 });
    fire(world, hero, FREEZER, { angleDeg: 0, power: 1 });
    for (let i = 0; i < 10; i += 1) stepWorld(world);
    hero.alive = false;
    const events = stepWorld(world);
    expect(world.hexes).toHaveLength(0);
    expect(events.find((e) => e.type === 'hexEnd')).toMatchObject({ burst: false });
    expect(enemy.alive).toBe(true);
    expect(enemy.motion).toBe('falling');
  });
});
