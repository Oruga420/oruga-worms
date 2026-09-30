import { describe, expect, it } from 'vitest';
import { REST_TICKS, WORM_HEIGHT } from '@/sim/constants.ts';
import { crackTicks, cancelSprouts, heldBySprouts, plantSpot, sproutTicks, SPROUT_SOUNDS } from '@/sim/sprout.ts';
import type { SimEvent, SproutBody } from '@/sim/types.ts';
import { stepHorizontal } from '@/sim/worm-controller.ts';
import { wormHalfWidth, wormHeight, wormMiddleY } from '@/sim/worm-size.ts';
import { addWorm, stepWorld, worldAtRest, type SimWorld } from '@/sim/world.ts';
import { SOLID, setSpan } from '@/terrain/mask.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

const SEED = WEAPONS.saibaman;
const SPEC = SEED.sprout!;

function plantFrom(world: SimWorld, x = 200, facing: 1 | -1 = 1) {
  const planter = addWorm(world, { id: 'a-worm-1', teamId: 'a', x, y: 199, facing });
  const result = fire(world, planter, SEED, { angleDeg: 0, power: 1 });
  return { planter, result, sprout: world.sprouts[0] as SproutBody };
}

/** Steps until the seed is done, collecting every event on the way. */
function playOut(world: SimWorld, maxTicks = 600): SimEvent[] {
  const events: SimEvent[] = [...world.events.splice(0)];
  for (let i = 0; i < maxTicks && world.sprouts.some((s) => s.alive); i += 1) events.push(...stepWorld(world));
  return events;
}

describe('the Saibaman seed', () => {
  it('goes in a stride in front, the ground cracks three times, and a half size worm leaps out on the team', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    const { planter, result, sprout } = plantFrom(world);
    expect(result).toMatchObject({ endsTurn: true, shotsRemaining: 0, sequence: true });
    expect(sprout).toMatchObject({ spotX: 200 + SPEC.plantAheadPx, spotY: 199, fertile: true, facing: 1 });
    const events = playOut(world);
    const beats = events.flatMap((e) => (e.type === 'sproutBeat' ? [`${e.beat}${e.n > 0 ? e.n : ''}`] : []));
    expect(beats).toEqual(['plant', 'crack1', 'crack2', 'crack3', 'pop']);
    const spawned = events.find((e) => e.type === 'wormSpawned');
    expect(spawned).toMatchObject({ type: 'wormSpawned', wormId: 'a-saiba-1', teamId: 'a', size: 0.5, hpShare: 0.5 });
    const saibaman = world.worms.find((w) => w.id === 'a-saiba-1');
    expect(saibaman).toMatchObject({ teamId: 'a', size: 0.5, facing: 1, alive: true });
    expect(events.at(-1)).toMatchObject({ type: 'sproutEnd', wormId: 'a-saiba-1' });
    // The cackle rides the leap; the planter never moved.
    expect(events.some((e) => e.type === 'sound' && e.id === SPROUT_SOUNDS.cackle)).toBe(true);
    expect(planter.x).toBe(200);
  });

  it('holds the planter while it plants and the ground shakes, and lets it go for the recovery', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    const { planter, sprout } = plantFrom(world);
    const walkRight = new Map([[planter.id, { moveX: 1 as const, jump: false, backflip: false, thrust: false }]]);
    for (let i = 0; i < 30; i += 1) stepWorld(world, walkRight);
    expect(heldBySprouts(world.sprouts).has(planter.id)).toBe(true);
    expect(planter.x).toBe(200);
    while (sprout.stage !== 'recover') stepWorld(world);
    expect(heldBySprouts(world.sprouts).has(planter.id)).toBe(false);
  });

  it('takes the planting, the shaking and the recovery, and cracks evenly before the ground gives', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    plantFrom(world);
    let ticks = 0;
    while (world.sprouts.some((s) => s.alive) && ticks < 1000) {
      stepWorld(world);
      ticks += 1;
    }
    expect(ticks).toBe(sproutTicks(SPEC));
    const cracks = crackTicks(SPEC);
    expect(cracks).toHaveLength(SPEC.cracks);
    expect([...cracks].sort((a, b) => a - b)).toEqual(cracks);
  });

  it('the Saibaman leaps out, lands where it came out without a scratch, and settles', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    plantFrom(world);
    const events: SimEvent[] = [];
    let peak = Infinity;
    for (let i = 0; i < 600 && !(worldAtRest(world) && world.worms.length === 2); i += 1) {
      events.push(...stepWorld(world));
      const out = world.worms.find((w) => w.id === 'a-saiba-1');
      if (out !== undefined) peak = Math.min(peak, out.y);
    }
    const saibaman = world.worms.find((w) => w.id === 'a-saiba-1')!;
    expect(worldAtRest(world)).toBe(true);
    expect(saibaman.restTicks).toBeGreaterThanOrEqual(REST_TICKS);
    expect(saibaman.onGround).toBe(true);
    // A leap out of a little crater, well over its own height, and no fall damage for it.
    expect(peak).toBeLessThan(199 - 30);
    expect(events.filter((e) => e.type === 'damage')).toEqual([]);
    expect(Math.abs(saibaman.x - (200 + SPEC.plantAheadPx))).toBeLessThanOrEqual(1);
  });

  it('plants nearer, or behind, when the ground in front falls away, and withers with no ground at all', () => {
    // The sea starts right in front of the worm: the seed goes in behind it, and the worm turns to it.
    const world = flatWorld({ floorY: 200, waterY: 280, gap: { x0: 206, x1: 399 } });
    const { planter, sprout } = plantFrom(world);
    expect(sprout.fertile).toBe(true);
    expect(sprout.spotX).toBe(200 - SPEC.plantAheadPx);
    expect(planter.facing).toBe(-1);
    // Nowhere at all: a worm on a one pixel wide pillar over the sea.
    const lonely = flatWorld({ floorY: 200, waterY: 280, gap: { x0: 0, x1: 399 } });
    setSpan(lonely.terrain.mask, 200, 200, 200, SOLID);
    expect(plantSpot(lonely.terrain.mask, 280, 200, 199, 1, SPEC)).toBeNull();
    const withered = plantFrom(lonely);
    expect(withered.sprout.fertile).toBe(false);
    const events = playOut(lonely);
    expect(events.flatMap((e) => (e.type === 'sproutBeat' ? [e.beat] : []))).toEqual(['plant', 'wither']);
    expect(events.some((e) => e.type === 'wormSpawned')).toBe(false);
    expect(lonely.worms).toHaveLength(1);
  });

  it('withers when the team is already at its cap', () => {
    const world = flatWorld({ width: 600, floorY: 200, waterY: 280 });
    for (let i = 1; i < SPEC.maxTeamWorms; i += 1) addWorm(world, { id: `a-worm-${i + 1}`, teamId: 'a', x: 300 + i * 30, y: 199 });
    const { sprout } = plantFrom(world, 100);
    expect(sprout.fertile).toBe(false);
    expect(playOut(world).some((e) => e.type === 'wormSpawned')).toBe(false);
  });

  it('numbers each team\'s Saibamen over the whole match, the dead included', () => {
    const world = flatWorld({ width: 600, floorY: 200, waterY: 280 });
    plantFrom(world, 100);
    playOut(world);
    world.worms.find((w) => w.id === 'a-saiba-1')!.alive = false;
    const again = world.worms.find((w) => w.id === 'a-worm-1')!;
    fire(world, again, SEED, { angleDeg: 0, power: 1 });
    playOut(world);
    expect(world.worms.map((w) => w.id)).toEqual(['a-worm-1', 'a-saiba-1', 'a-saiba-2']);
  });

  it('a match that ends mid planting lets the planter go', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    const { planter } = plantFrom(world);
    for (let i = 0; i < 20; i += 1) stepWorld(world);
    cancelSprouts(world);
    expect(world.sprouts).toHaveLength(0);
    expect(heldBySprouts(world.sprouts).has(planter.id)).toBe(false);
    expect(world.events.some((e) => e.type === 'sproutEnd')).toBe(true);
  });
});

describe('half size worms', () => {
  it('have half the hitbox: half as tall, half as wide, their middle lower', () => {
    const small = { size: 0.5, y: 199 };
    expect(wormHeight(small)).toBe(WORM_HEIGHT / 2);
    expect(wormHalfWidth(small)).toBe(2);
    expect(wormMiddleY(small)).toBe(199 - WORM_HEIGHT / 4);
    expect(wormHeight({})).toBe(WORM_HEIGHT);
  });

  it('walk through a tunnel a worm has to stop at', () => {
    // A roof 11 px over the floor from x = 220 on: a worm is 16 tall, a Saibaman 8.
    const world = flatWorld({ floorY: 200, waterY: 280 });
    setSpan(world.terrain.mask, 188, 220, 399, SOLID);
    const worm = { x: 210, y: 199, size: 1 };
    const saibaman = { x: 210, y: 199, size: 0.5 };
    for (let i = 0; i < 40; i += 1) {
      stepHorizontal(world.terrain.mask, worm, worm.x + 1);
      stepHorizontal(world.terrain.mask, saibaman, saibaman.x + 1);
    }
    expect(worm.x).toBeLessThan(220);
    expect(saibaman.x).toBe(250);
  });
});
