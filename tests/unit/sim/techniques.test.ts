import { describe, expect, it } from 'vitest';
import { WORM_HEIGHT } from '@/sim/constants.ts';
import { cancelTechniques, heldByTechniques, techniquePlaying } from '@/sim/technique.ts';
import { KILL_DAMAGE } from '@/sim/techniques/common.ts';
import { diceSquare } from '@/sim/techniques/dice.ts';
import { meteorPath } from '@/sim/techniques/meteor.ts';
import { needleTicks, stingTicks } from '@/sim/techniques/needle.ts';
import { spawnTreasureStrike, strikeLandTick } from '@/sim/techniques/treasure.ts';
import { circleSpots } from '@/sim/techniques/zoltraak.ts';
import type { SimEvent, TechniqueBeat } from '@/sim/types.ts';
import { wormMiddleY } from '@/sim/worm-size.ts';
import { addWorm, stepWorld, worldAtRest, type SimWorld } from '@/sim/world.ts';
import { BORDER_BEDROCK_PX, SOLID, countSolid, setSpan } from '@/terrain/mask.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld, type FlatWorldOptions } from './fixture.ts';

function arena(options: Partial<FlatWorldOptions> = {}) {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480, ...options });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  return { world, hero };
}

/** Steps until no technique is left (or a cap), returning every event on the way. */
function playOut(world: SimWorld, cap = 3000): SimEvent[] {
  const events: SimEvent[] = [...world.events.splice(0)];
  for (let i = 0; i < cap && world.techniques.length > 0; i += 1) events.push(...stepWorld(world));
  return events;
}

function beats(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'techniqueBeat' ? [`${e.beat}${e.n > 0 ? e.n : ''}`] : []));
}

function beatsOf(events: readonly SimEvent[], kind: TechniqueBeat): Extract<SimEvent, { type: 'techniqueBeat' }>[] {
  return events.flatMap((e) => (e.type === 'techniqueBeat' && e.beat === kind ? [e] : []));
}

/** What a technique did to a worm, not counting the price its user paid for it. */
function damageTo(events: readonly SimEvent[], wormId: string): number[] {
  return events.flatMap((e) => (e.type === 'damage' && e.wormId === wormId && e.cause !== 'toll' ? [e.amount] : []));
}

function tolls(events: readonly SimEvent[], wormId: string): Extract<SimEvent, { type: 'damage' }>[] {
  return events.flatMap((e) => (e.type === 'damage' && e.wormId === wormId && e.cause === 'toll' ? [e] : []));
}

describe('techniques: the rows', () => {
  it('are eight supers of the anime row, one per worm, open from the second turn, never in a crate, aimed by their kind', () => {
    const ids = ['antares', 'galaxian', 'tenbu_horin', 'hiken', 'meteor', 'santoryu', 'zoltraak', 'final_explosion'] as const;
    for (const id of ids) {
      const def = WEAPONS[id];
      expect(def.category).toBe('anime');
      expect(def.technique).toBeDefined();
      expect(def.ammo).toBe(1);
      expect(def.crateWeight).toBe(0);
      expect(def.delayTurns).toBe(2);
    }
    expect(WEAPONS.meteor.kind).toBe('TARGETED');
    expect(WEAPONS.meteor.requiresTargetSelect).toBe(true);
    expect(WEAPONS.santoryu.kind).toBe('MELEE');
    expect(WEAPONS.antares.tollShare).toBe(0.5);
    expect(WEAPONS.galaxian.toll).toBe(50);
    expect(WEAPONS.tenbu_horin.toll).toBeUndefined();
  });
});

describe('Antares', () => {
  const ANTARES = WEAPONS.antares;
  const SPEC = ANTARES.technique!.kind === 'needle' ? ANTARES.technique! : null;

  it('stings the first worm on the aim fourteen times, then Antares takes all it has left', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 500, y: 349 });
    const result = fire(world, hero, ANTARES, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    // Half of what the user has: a toll by share, the ledger works it out.
    expect(tolls(world.events, 'hero')).toEqual([expect.objectContaining({ share: 0.5 })]);
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['hero', 'enemy']));
    const events = playOut(world);
    expect(beats(events)).toEqual([...Array.from({ length: 14 }, (_, k) => `sting${k + 1}`), 'antares']);
    expect(damageTo(events, 'enemy')).toEqual([...Array.from({ length: 14 }, () => 2), KILL_DAMAGE]);
    // Held through the stings: it shook on the spot, and the shooter never moved.
    expect(enemy.x).toBe(500);
    expect(hero.x).toBe(300);
  });

  it('takes its time: the point, the stings, the breath and the recovery', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 500, y: 349 });
    fire(world, hero, ANTARES, { angleDeg: 0, power: 1 });
    world.events.splice(0);
    let ticks = 0;
    while (world.techniques.length > 0 && ticks < 3000) {
      stepWorld(world);
      ticks += 1;
    }
    expect(SPEC).not.toBeNull();
    if (SPEC === null) return;
    expect(ticks).toBe(needleTicks(SPEC));
    expect(stingTicks(SPEC)).toHaveLength(14);
  });

  it('stops at a wall: the needles fly into it and die out, nobody is hurt but the price is paid', () => {
    const { world, hero } = arena({ wall: { x: 400, height: 40, width: 6 } });
    addWorm(world, { id: 'enemy', teamId: 'b', x: 500, y: 349 });
    fire(world, hero, ANTARES, { angleDeg: 0, power: 1 });
    const events = playOut(world);
    expect(beats(events)).toEqual(['fizzle']);
    expect(damageTo(events, 'enemy')).toEqual([]);
    expect(tolls(events, 'hero')).toHaveLength(1);
  });

  it('misses a worm off the aim line', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 500, y: 349 });
    fire(world, hero, ANTARES, { angleDeg: 40, power: 1 });
    expect(beats(playOut(world))).toEqual(['fizzle']);
  });
});

describe('the Galaxian Explosion', () => {
  const GALAXIAN = WEAPONS.galaxian;

  it('flies to the first worm on the aim and kills every worm near where it goes off, and only them', () => {
    const { world, hero } = arena();
    const near = addWorm(world, { id: 'near', teamId: 'b', x: 520, y: 349 });
    const beside = addWorm(world, { id: 'beside', teamId: 'b', x: 545, y: 349 });
    const far = addWorm(world, { id: 'far', teamId: 'b', x: 620, y: 349 });
    const solidBefore = countSolid(world.terrain.mask);
    fire(world, hero, GALAXIAN, { angleDeg: 0, power: 1 });
    expect(tolls(world.events, 'hero')).toEqual([expect.objectContaining({ amount: 50 })]);
    const events = playOut(world);
    expect(beats(events)).toEqual(['release', 'burst2']);
    expect(damageTo(events, near.id)).toEqual([KILL_DAMAGE]);
    expect(damageTo(events, beside.id)).toEqual([KILL_DAMAGE]);
    expect(damageTo(events, far.id)).toEqual([]);
    expect(damageTo(events, 'hero')).toEqual([]);
    // The land under the burst went with them.
    expect(countSolid(world.terrain.mask)).toBeLessThan(solidBefore);
  });

  it('takes the thrower too when it goes off at its own feet', () => {
    const { world, hero } = arena();
    fire(world, hero, GALAXIAN, { angleDeg: -80, power: 1 });
    const events = playOut(world);
    expect(damageTo(events, 'hero')).toEqual([KILL_DAMAGE]);
  });

  it('flies off a worm standing at the foot of a rise, instead of going off in its face', () => {
    // The ground climbs a pixel every three right in front of the thrower.
    const { world, hero } = arena();
    for (let x = 304; x < 420; x += 1) for (let y = 350 - Math.floor((x - 304) / 3); y < 350; y += 1) world.terrain.mask.data[y * world.terrain.mask.width + x] = SOLID;
    addWorm(world, { id: 'enemy', teamId: 'b', x: 560, y: 349 });
    fire(world, hero, GALAXIAN, { angleDeg: 12, power: 1 });
    const events = playOut(world);
    expect(damageTo(events, 'hero')).toEqual([]);
    const burst = beatsOf(events, 'burst')[0];
    expect(Math.abs((burst?.x ?? 300) - 300)).toBeGreaterThan(GALAXIAN.technique!.kind === 'galaxy' ? 44 : 0);
  });

  it('holds the thrower while the stars gather, and lets it go as the galaxy flies off', () => {
    const { world, hero } = arena();
    fire(world, hero, GALAXIAN, { angleDeg: 0, power: 1 });
    expect(heldByTechniques(world.techniques).has('hero')).toBe(true);
    expect(worldAtRest(world)).toBe(false);
    playOut(world);
    expect(heldByTechniques(world.techniques).has('hero')).toBe(false);
  });
});

describe('the Explosión Final', () => {
  const FINAL = WEAPONS.final_explosion;

  it('is a melee row with no aim and no toll: the worm is the price', () => {
    expect(FINAL.kind).toBe('MELEE');
    expect(FINAL.toll).toBeUndefined();
    expect(FINAL.tollShare).toBeUndefined();
    expect(FINAL.technique?.kind).toBe('final');
  });

  it('goes off where the worm stands and takes every worm in reach, the worm first of all, and the land', () => {
    const { world, hero } = arena();
    const near = addWorm(world, { id: 'near', teamId: 'b', x: 350, y: 349 });
    const friend = addWorm(world, { id: 'friend', teamId: 'a', x: 260, y: 349 });
    const far = addWorm(world, { id: 'far', teamId: 'b', x: 420, y: 349 });
    const solidBefore = countSolid(world.terrain.mask);
    fire(world, hero, FINAL, { angleDeg: 0, power: 1 });
    expect(tolls(world.events, 'hero')).toEqual([]);
    expect(heldByTechniques(world.techniques).has('hero')).toBe(true);
    const events = playOut(world);
    expect(beats(events)).toEqual(['burst3']);
    expect(damageTo(events, 'hero')).toEqual([KILL_DAMAGE]);
    expect(damageTo(events, near.id)).toEqual([KILL_DAMAGE]);
    expect(damageTo(events, friend.id)).toEqual([KILL_DAMAGE]);
    expect(damageTo(events, far.id)).toEqual([]);
    expect(beatsOf(events, 'burst')[0]?.x).toBe(300);
    expect(countSolid(world.terrain.mask)).toBeLessThan(solidBefore);
    expect(heldByTechniques(world.techniques).has('hero')).toBe(false);
  });

  it('comes to nothing when its worm is gone before it lets go', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'near', teamId: 'b', x: 350, y: 349 });
    fire(world, hero, FINAL, { angleDeg: 0, power: 1 });
    stepWorld(world);
    hero.alive = false;
    const events = playOut(world);
    expect(beats(events)).toEqual([]);
    expect(damageTo(events, 'near')).toEqual([]);
    expect(world.techniques).toEqual([]);
  });
});

describe('the Tesoro del Cielo', () => {
  const TREASURE = WEAPONS.tenbu_horin;
  const SPEC = TREASURE.technique!.kind === 'treasure' ? TREASURE.technique! : null;

  it('seals the nearest enemy in sight: the sim tells the ledger, three strikes of 15 each, and hurts nobody yet', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    addWorm(world, { id: 'farther', teamId: 'b', x: 700, y: 349 });
    fire(world, hero, TREASURE, { angleDeg: 0, power: 1 });
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['hero']));
    const events = playOut(world);
    expect(beats(events)).toEqual(['wheel', 'seal3']);
    expect(events.filter((e) => e.type === 'sealed')).toEqual([{ type: 'sealed', weaponId: 'tenbu_horin', casterId: 'hero', casterTeamId: 'a', targetId: 'enemy', hits: 3, hitToll: 15 }]);
    expect(events.filter((e) => e.type === 'damage')).toEqual([]);
  });

  it('turns over nothing when nobody is in reach and in sight', () => {
    const { world, hero } = arena({ wall: { x: 400, height: 60, width: 8 } });
    addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    fire(world, hero, TREASURE, { angleDeg: 0, power: 1 });
    const events = playOut(world);
    expect(beats(events)).toEqual(['miss']);
    expect(events.some((e) => e.type === 'sealed')).toBe(false);
  });

  it('a strike takes a sense and 15 from the caster; the last one also takes the sealed worm\'s life', () => {
    expect(SPEC).not.toBeNull();
    if (SPEC === null) return;
    const { world } = arena();
    const target = addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    spawnTreasureStrike(world, { weaponId: 'tenbu_horin', casterId: 'hero', casterTeamId: 'a', target, spec: SPEC, hit: 1, fatal: false });
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['enemy']));
    const first = playOut(world);
    expect(beats(first)).toEqual(['sense1']);
    expect(tolls(first, 'hero').map((e) => e.amount)).toEqual([15]);
    expect(damageTo(first, 'enemy')).toEqual([]);
    spawnTreasureStrike(world, { weaponId: 'tenbu_horin', casterId: 'hero', casterTeamId: 'a', target, spec: SPEC, hit: 3, fatal: true });
    const last = playOut(world);
    expect(beats(last)).toEqual(['nirvana3']);
    expect(tolls(last, 'hero').map((e) => e.amount)).toEqual([15]);
    expect(last.filter((e) => e.type === 'damage' && e.wormId === 'enemy')).toEqual([expect.objectContaining({ amount: KILL_DAMAGE, sourceTeamId: 'a', sourceWormId: 'hero' })]);
    // The bite lands part way into the strike, after the wheel has turned a while.
    expect(strikeLandTick(SPEC)).toBeGreaterThan(30);
  });
});

describe('the Hiken', () => {
  it('throws a fist of fire that bursts on the first worm it meets and flings burning blobs', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 520, y: 349 });
    fire(world, hero, WEAPONS.hiken, { angleDeg: 0, power: 1 });
    // Up to the burst: the blobs are flung out of it on the same tick.
    const events: SimEvent[] = [...world.events.splice(0)];
    for (let i = 0; i < 600 && !events.some((e) => e.type === 'techniqueBeat' && e.beat === 'burst'); i += 1) events.push(...stepWorld(world));
    expect(world.projectiles.filter((p) => p.weaponId === 'napalm_blob')).toHaveLength(9);
    events.push(...playOut(world));
    expect(beats(events)).toEqual(['flare', 'release', 'burst']);
    // On the worm, not past it: the burst throws it, so measure from where it stood.
    const burst = beatsOf(events, 'burst')[0];
    expect(Math.abs((burst?.x ?? 0) - 520)).toBeLessThan(20);
    expect(damageTo(events, 'enemy').reduce((a, b) => a + b, 0)).toBeGreaterThan(40);
  });
});

describe('Fujitora\'s meteor', () => {
  const METEOR = WEAPONS.meteor;
  const SPEC = METEOR.technique!.kind === 'meteor' ? METEOR.technique! : null;

  it('starts its fall under the ceiling on a slant through the spot clicked', () => {
    expect(SPEC).not.toBeNull();
    if (SPEC === null) return;
    const path = meteorPath(SPEC, 600, 340, 1);
    expect(path.startY).toBeGreaterThan(BORDER_BEDROCK_PX + SPEC.radiusPx);
    expect(path.startX).toBeLessThan(600);
    // The line from the start along the fall passes through the target.
    const t = (340 - path.startY) / path.dy;
    expect(path.startX + path.dx * t).toBeCloseTo(600, 5);
  });

  it('comes down on the spot and leaves the biggest crater in the game', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 640, y: 349 });
    const solidBefore = countSolid(world.terrain.mask);
    fire(world, hero, METEOR, { angleDeg: 0, power: 1, targetPoint: { x: 640, y: 349 } });
    expect(heldByTechniques(world.techniques).has('hero')).toBe(true);
    const events = playOut(world);
    expect(beats(events)).toEqual(['call', 'fall', 'burst']);
    const burst = beatsOf(events, 'burst')[0];
    expect(Math.abs((burst?.x ?? 0) - 640)).toBeLessThan(30);
    expect(damageTo(events, enemy.id).reduce((a, b) => a + b, 0)).toBeGreaterThan(50);
    expect(solidBefore - countSolid(world.terrain.mask)).toBeGreaterThan(10_000);
  });
});

describe('the Santoryu', () => {
  const SANTORYU = WEAPONS.santoryu;
  const SPEC = SANTORYU.technique!.kind === 'dice' ? SANTORYU.technique! : null;

  it('cuts the square ahead into cubes: the land in it is gone and the worm in it is cut and thrown', () => {
    expect(SPEC).not.toBeNull();
    if (SPEC === null) return;
    // A hill ahead of the swordsman, with a worm standing on it.
    const { world, hero } = arena();
    for (let y = 300; y < 350; y += 1) setSpan(world.terrain.mask, y, 340, 420, SOLID);
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 372, y: 299 });
    fire(world, hero, SANTORYU, { angleDeg: 10, power: 1 });
    const square = diceSquare(SPEC, hero, 1, 10);
    const events = playOut(world);
    expect(beats(events)).toEqual(['draw', 'slash1', 'slash2', 'slash3', 'slash4', 'slash5', 'slash6', 'cut1']);
    const cut = beatsOf(events, 'cut')[0];
    expect(cut?.cells?.length ?? 0).toBeGreaterThan(10);
    let left = 0;
    for (let y = square.y; y < square.y + square.side; y += 1) for (let x = square.x; x < square.x + square.side; x += 1) if (world.terrain.mask.data[y * world.terrain.mask.width + x] === SOLID) left += 1;
    expect(left).toBe(0);
    expect(damageTo(events, enemy.id)).toEqual([SPEC.damage]);
    expect(damageTo(events, 'hero')).toEqual([]);
  });

  it('aimed down, cuts the ground from under the swordsman\'s own feet', () => {
    const { world, hero } = arena();
    fire(world, hero, SANTORYU, { angleDeg: -90, power: 1 });
    playOut(world);
    expect(world.terrain.mask.data[(hero.y + 20) * world.terrain.mask.width + Math.round(hero.x)]).not.toBe(SOLID);
  });
});

describe('Zoltraak', () => {
  const ZOLTRAAK = WEAPONS.zoltraak;
  const SPEC = ZOLTRAAK.technique!.kind === 'zoltraak' ? ZOLTRAAK.technique! : null;

  it('opens five circles over the mage, then five beams meet on the first worm along the aim', () => {
    const { world, hero } = arena();
    const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 560, y: 349 });
    const middle = wormMiddleY(enemy);
    fire(world, hero, ZOLTRAAK, { angleDeg: 0, power: 1 });
    const events = playOut(world);
    expect(beats(events)).toEqual(['circle1', 'circle2', 'circle3', 'circle4', 'circle5', 'beam1', 'beam2', 'beam3', 'beam4', 'beam5']);
    for (const beam of beatsOf(events, 'beam')) expect(Math.hypot(beam.x - 560, beam.y - middle)).toBeLessThan(10);
    // Light, not a blast: the first beam does not throw the worm out of the way of the other four.
    expect(damageTo(events, enemy.id)).toHaveLength(5);
    expect(damageTo(events, 'hero')).toEqual([]);
  });

  it('hangs its circles over the mage\'s head, and does not open one inside the land', () => {
    expect(SPEC).not.toBeNull();
    if (SPEC === null) return;
    for (const spot of circleSpots(SPEC, 300, 349, 1)) expect(spot.y).toBeLessThan(349 - WORM_HEIGHT);
    // A low ceiling right over the mage: the circles that would sit in it stay shut.
    const { world, hero } = arena();
    for (let y = 300; y < 322; y += 1) setSpan(world.terrain.mask, y, 250, 350, SOLID);
    addWorm(world, { id: 'enemy', teamId: 'b', x: 560, y: 349 });
    fire(world, hero, ZOLTRAAK, { angleDeg: 0, power: 1 });
    expect(world.techniques[0]?.kind === 'zoltraak' ? world.techniques[0].circles.length : -1).toBeLessThan(5);
  });
});

describe('techniques in the world', () => {
  it('keep the world from rest while they play, and end on the spot when the match does', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 500, y: 349 });
    fire(world, hero, WEAPONS.antares, { angleDeg: 0, power: 1 });
    for (let i = 0; i < 80; i += 1) stepWorld(world);
    expect(techniquePlaying(world)).toBe(true);
    expect(worldAtRest(world)).toBe(false);
    cancelTechniques(world);
    expect(world.techniques).toHaveLength(0);
    expect(heldByTechniques(world.techniques).size).toBe(0);
    expect(world.events.some((e) => e.type === 'techniqueEnd')).toBe(true);
  });
});
