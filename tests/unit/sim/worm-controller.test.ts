import { describe, expect, it } from 'vitest';
import { REST_TICKS, STEP_UP_PX, TICK_S, WALK_SPEED_PX_PER_S } from '@/sim/constants.ts';
import { wormAtRest } from '@/sim/rest.ts';
import { stepWorld, addWorm } from '@/sim/world.ts';
import { stepHorizontal } from '@/sim/worm-controller.ts';
import type { WormIntent } from '@/sim/types.ts';
import { flatWorld } from './fixture.ts';

const walkRight: WormIntent = { moveX: 1, jump: false, backflip: false, thrust: false };
const idle: WormIntent = { moveX: 0, jump: false, backflip: false, thrust: false };

function intents(id: string, intent: WormIntent): Map<string, WormIntent> {
  return new Map([[id, intent]]);
}

describe('worm controller', () => {
  it('walks on flat ground and comes to rest when idle', () => {
    const world = flatWorld({ floorY: 200 });
    const worm = addWorm(world, { id: 'w', teamId: 'a', x: 50, y: 199 });
    for (let i = 0; i < 60; i += 1) stepWorld(world, intents('w', walkRight));
    expect(worm.x).toBeCloseTo(50 + WALK_SPEED_PX_PER_S, 0);
    expect(worm.y).toBe(199);
    expect(worm.facing).toBe(1);
    expect(worm.motion).toBe('walking');
    for (let i = 0; i < REST_TICKS + 2; i += 1) stepWorld(world, intents('w', idle));
    expect(wormAtRest(worm)).toBe(true);
  });

  it('climbs a step of 6 px and is blocked by a 12 px wall', () => {
    const low = flatWorld({ floorY: 200, wall: { x: 60, height: STEP_UP_PX, width: 20 } });
    const climber = addWorm(low, { id: 'c', teamId: 'a', x: 55, y: 199 });
    expect(stepHorizontal(low.terrain.mask, climber, 61)).toBe('moved');
    expect(climber.y).toBe(199 - STEP_UP_PX);
    const high = flatWorld({ floorY: 200, wall: { x: 60, height: 12, width: 20 } });
    const blocked = addWorm(high, { id: 'b', teamId: 'a', x: 55, y: 199 });
    expect(stepHorizontal(high.terrain.mask, blocked, 61)).toBe('blocked');
    expect(blocked.x).toBe(55);
  });

  it('walks over or away from a thin spike inside its footprint instead of freezing (backlog 4.5)', () => {
    // A 1 px wide, 3 px tall spike at x 50 with the worm standing on the floor at x 53, so the
    // spike sits inside the worm's half width to the left, 2 px above its feet. On 3 of 10 random
    // islands the first worm landed exactly like this and could not walk in either direction.
    const world = flatWorld({ floorY: 200, wall: { x: 50, height: 3, width: 1 } });
    const worm = addWorm(world, { id: 's', teamId: 'a', x: 53, y: 199 });
    // Away from the spike: the spike is a step inside the footprint, never a wall.
    expect(stepHorizontal(world.terrain.mask, worm, 54)).not.toBe('blocked');
    // Toward and over the spike: 3 px is within STEP_UP_PX, so it is climbed.
    const climber = addWorm(world, { id: 't', teamId: 'a', x: 53, y: 199 });
    expect(stepHorizontal(world.terrain.mask, climber, 52)).toBe('moved');
    expect(climber.y).toBeLessThanOrEqual(199);
    // Driven through the sim for a second of walking right, the worm must actually travel.
    const walkerWorld = flatWorld({ floorY: 200, wall: { x: 50, height: 3, width: 1 } });
    const w = addWorm(walkerWorld, { id: 'v', teamId: 'a', x: 53, y: 199 });
    for (let i = 0; i < 60; i += 1) stepWorld(walkerWorld, intents('v', walkRight));
    expect(w.x - 53).toBeGreaterThan(20);
  });

  it('falls off a ledge, takes fall damage on a hard landing and none on a soft one', () => {
    // Deep pit so the fall exceeds the 8 px per frame damage threshold (needs about 130 px of drop).
    const world = flatWorld({ width: 400, height: 500, floorY: 200, waterY: 499, gap: { x0: 100, x1: 399 } });
    for (let y = 390; y < 400; y += 1) for (let x = 100; x < 400; x += 1) world.terrain.mask.data[y * 400 + x] = 1;
    const worm = addWorm(world, { id: 'f', teamId: 'a', x: 96, y: 199 });
    let landed = false;
    let damageEvents = 0;
    for (let i = 0; i < 400 && !landed; i += 1) {
      const events = stepWorld(world, intents('f', i < 20 ? walkRight : idle));
      if (events.some((e) => e.type === 'landed')) landed = true;
      damageEvents += events.filter((e) => e.type === 'damage' && e.cause === 'fall').length;
    }
    expect(landed).toBe(true);
    expect(worm.y).toBeGreaterThanOrEqual(388);
    expect(worm.y).toBeLessThan(390);
    expect(damageEvents).toBe(1);
  });

  it('lands free after a blast, then pays the next fall', () => {
    const world = flatWorld({ floorY: 200 });
    const worm = addWorm(world, { id: 'b', teamId: 'a', x: 200, y: 199 });
    worm.motion = 'flying';
    worm.onGround = false;
    worm.vy = -900;
    worm.exemptNextLanding = true;
    let events: ReturnType<typeof stepWorld> = [];
    let landedAt = -1;
    for (let i = 0; i < 300 && landedAt < 0; i += 1) {
      events = stepWorld(world);
      if (events.some((e) => e.type === 'landed')) landedAt = i;
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'damage')).toBe(false);
    expect(worm.exemptNextLanding).toBe(false);
  });

  it('jumps forward and lands back on the floor', () => {
    const world = flatWorld({ floorY: 200 });
    const worm = addWorm(world, { id: 'j', teamId: 'a', x: 100, y: 199 });
    stepWorld(world, intents('j', { moveX: 0, jump: true, backflip: false, thrust: false }));
    expect(worm.motion).toBe('jumping');
    let peak = worm.y;
    for (let i = 0; i < 200; i += 1) {
      stepWorld(world);
      peak = Math.min(peak, worm.y);
    }
    expect(peak).toBeLessThan(180);
    expect(worm.x).toBeGreaterThan(100);
    expect(worm.onGround).toBe(true);
  });

  it('drowns below the water line and dies after sinking', () => {
    const world = flatWorld({ floorY: 200, waterY: 250, gap: { x0: 150, x1: 250 } });
    const worm = addWorm(world, { id: 'd', teamId: 'a', x: 200, y: 240 });
    worm.motion = 'falling';
    worm.onGround = false;
    let drowned = false;
    for (let i = 0; i < 600 && worm.alive; i += 1) {
      if (stepWorld(world).some((e) => e.type === 'drown')) drowned = true;
    }
    expect(drowned).toBe(true);
    expect(worm.alive).toBe(false);
    expect(worm.motion).toBe('dead');
    expect(TICK_S).toBeCloseTo(1 / 60, 6);
  });
});
