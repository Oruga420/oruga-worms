import { describe, expect, it } from 'vitest';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { BEAM_SOUNDS, beamReach, beamTicks, cancelBeams, heldByBeams } from '@/sim/beam.ts';
import { addWorm, stepWorld, worldAtRest, type SimWorld } from '@/sim/world.ts';
import type { SimEvent } from '@/sim/types.ts';
import { isSolid } from '@/terrain/queries.ts';
import { flatWorld, type FlatWorldOptions } from './fixture.ts';

const KAME = WEAPONS.kamehameha;
const BEAM = KAME.beam!;
const CHARGE_TICKS = Math.round((BEAM.chargeMs * 60) / 1000);

function arena(options: Partial<FlatWorldOptions> = {}) {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480, ...options });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  return { world, hero };
}

/** Steps until the beam is gone (or a cap), returning every event on the way. */
function playOut(world: SimWorld, cap = 1200): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < cap && world.beams.length > 0; i += 1) events.push(...stepWorld(world));
  return events;
}

function beamDamage(events: readonly SimEvent[], wormId: string): number[] {
  return events.flatMap((e) => (e.type === 'damage' && e.wormId === wormId && e.cause === 'blast' ? [e.amount] : []));
}

describe('kamehameha: the row', () => {
  it('is an aimed hitscan row, bare handed, one per worm and never in a crate', () => {
    expect(KAME.kind).toBe('HITSCAN');
    expect(KAME.category).toBe('firearm');
    expect(KAME.heldSprite).toBeNull();
    expect(KAME.hitscan?.rangePx).toBe(BEAM.rangePx);
    expect(KAME.hitscan?.damagePerPellet).toBe(BEAM.damage);
    expect(KAME.ammo).toBe(1);
    expect(KAME.delayTurns).toBe(3);
    expect(KAME.crateWeight).toBe(0);
  });
});

describe('kamehameha: the charge', () => {
  it('holds the worm still, even in the air, and fires only once the charge is spent', () => {
    const { world, hero } = arena();
    hero.y = 300;
    hero.motion = 'falling';
    hero.onGround = false;
    const result = fire(world, hero, KAME, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(world.beams).toHaveLength(1);
    expect(world.beams[0]?.stage).toBe('charge');
    expect(world.events.some((e) => e.type === 'beamStart')).toBe(true);
    const early: SimEvent[] = [];
    for (let i = 0; i < CHARGE_TICKS - 1; i += 1) early.push(...stepWorld(world));
    expect(early.some((e) => e.type === 'beamFire' || e.type === 'damage')).toBe(false);
    expect(hero.y).toBe(300);
    expect(heldByBeams(world.beams).has('hero')).toBe(true);
    expect(stepWorld(world).some((e) => e.type === 'beamFire')).toBe(true);
    playOut(world);
    // Let go at the end: it falls from where it hung.
    expect(hero.motion).toBe('falling');
  });
});

describe('kamehameha: the voice', () => {
  it('chants as the charge starts and shouts as the beam leaves the hands', () => {
    const { world, hero } = arena();
    fire(world, hero, KAME, { angleDeg: 0, power: 1 });
    const cues = (events: readonly SimEvent[]): string[] => events.flatMap((e) => (e.type === 'sound' ? [e.id] : []));
    expect(cues(world.events)).toContain(BEAM_SOUNDS.chant);
    const charging: SimEvent[] = [];
    for (let i = 0; i < CHARGE_TICKS - 1; i += 1) charging.push(...stepWorld(world));
    expect(cues(charging)).not.toContain(BEAM_SOUNDS.shout);
    const release = stepWorld(world);
    expect(release.some((e) => e.type === 'beamFire')).toBe(true);
    expect(cues(release)).toContain(BEAM_SOUNDS.shout);
  });
});

describe('kamehameha: the beam', () => {
  it('bores through a wall and hits the worm behind it, once, throwing it along the beam', () => {
    const { world, hero } = arena({ wall: { x: 380, height: 40, width: 8 } });
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 460, y: 349 });
    expect(isSolid(world.terrain.mask, 384, 339)).toBe(true);
    fire(world, hero, KAME, { angleDeg: 0, power: 1 });
    let thrown = false;
    const events: SimEvent[] = [];
    while (world.beams.length > 0) {
      events.push(...stepWorld(world));
      if (beamDamage(events, 'enemy').length > 0 && !thrown) thrown = enemy.vx > 0 && enemy.motion === 'flying';
    }
    expect(beamDamage(events, 'enemy')).toEqual([BEAM.damage]);
    expect(thrown).toBe(true);
    // The tunnel: the wall is open where the beam went through, at the worm's chest height.
    expect(isSolid(world.terrain.mask, 384, 339)).toBe(false);
    // Blood goes the way the beam went.
    const hit = events.find((e) => e.type === 'damage' && e.wormId === 'enemy');
    expect(hit?.type === 'damage' && hit.at?.dx).toBeCloseTo(1, 6);
  });

  it('hits every worm on its line once, a team mate too, and leaves one off the line alone', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'mate', teamId: 'a', x: 420, y: 349 });
    addWorm(world, { id: 'near', teamId: 'b', x: 520, y: 349 });
    addWorm(world, { id: 'far', teamId: 'b', x: 640, y: 349 });
    const events = (fire(world, hero, KAME, { angleDeg: 0, power: 1 }), playOut(world));
    for (const id of ['mate', 'near', 'far']) expect(beamDamage(events, id)).toEqual([BEAM.damage]);
    const aloft = arena();
    addWorm(aloft.world, { id: 'below', teamId: 'b', x: 500, y: 349 });
    fire(aloft.world, aloft.hero, KAME, { angleDeg: 30, power: 1 });
    expect(beamDamage(playOut(aloft.world), 'below')).toEqual([]);
  });

  it('bursts at full reach, but not where the edge of the world cuts it short', () => {
    const { world, hero } = arena();
    fire(world, hero, KAME, { angleDeg: 0, power: 1 });
    const blast = playOut(world).find((e) => e.type === 'explosion' && e.radius === BEAM.tipBlast.radiusPx);
    expect(blast?.type === 'explosion' && blast.x).toBeCloseTo(306 + BEAM.rangePx, 6);
    const edge = arena();
    edge.hero.x = 1000;
    fire(edge.world, edge.hero, KAME, { angleDeg: 0, power: 1 });
    expect(edge.world.beams[0]?.maxLength).toBeCloseTo(1200 - 1006, 6);
    expect(playOut(edge.world).some((e) => e.type === 'explosion' && e.radius === BEAM.tipBlast.radiusPx)).toBe(false);
  });

  it('takes the time its timeline says, is never at rest while it plays, and settles after', () => {
    const { world, hero } = arena();
    fire(world, hero, KAME, { angleDeg: 0, power: 1 });
    const length = world.beams[0]?.maxLength ?? 0;
    let ticks = 0;
    while (world.beams.length > 0 && ticks < 1000) {
      stepWorld(world);
      ticks += 1;
      if (world.beams.length > 0) expect(worldAtRest(world)).toBe(false);
    }
    expect(ticks).toBe(beamTicks(BEAM, length));
    let settled = false;
    for (let i = 0; i < 1200 && !settled; i += 1) {
      stepWorld(world);
      settled = worldAtRest(world);
    }
    expect(settled).toBe(true);
  });

  it('never bores away the ground under its own feet, even aimed down', () => {
    const { world, hero } = arena();
    fire(world, hero, KAME, { angleDeg: -60, power: 1 });
    playOut(world);
    for (let i = 0; i < 600 && !worldAtRest(world); i += 1) stepWorld(world);
    expect(isSolid(world.terrain.mask, 300, 350)).toBe(true);
    expect(hero.onGround).toBe(true);
    expect(Math.abs(hero.y - 349)).toBeLessThan(1.5);
  });

  it('a cancelled beam ends on the spot and lets its worm go', () => {
    const { world, hero } = arena();
    fire(world, hero, KAME, { angleDeg: 0, power: 1 });
    for (let i = 0; i < 10; i += 1) stepWorld(world);
    cancelBeams(world);
    expect(world.beams).toHaveLength(0);
    expect(world.events.some((e) => e.type === 'beamEnd')).toBe(true);
    expect(hero.motion).toBe('falling');
  });

  it('runs to its reach or to the edge of the world, whichever comes first', () => {
    expect(beamReach(100, 100, 1, 0, 640, 500, 300)).toBe(400);
    expect(beamReach(100, 100, -1, 0, 640, 500, 300)).toBe(100);
    expect(beamReach(100, 100, 0, -1, 640, 500, 300)).toBe(100);
    expect(beamReach(250, 150, 1, 0, 100, 500, 300)).toBe(100);
    expect(beamReach(100, 100, Math.SQRT1_2, Math.SQRT1_2, 640, 500, 300)).toBeCloseTo(200 * Math.SQRT2, 6);
  });
});
