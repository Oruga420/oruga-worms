import { describe, expect, it } from 'vitest';
import { collectCrates, pickCrateColumn, spawnCrate, stepCrate } from '@/sim/crate.ts';
import { TICK_S } from '@/sim/constants.ts';
import { translateSimEvents } from '@/game/bridge.ts';
import { markBorderBedrock } from '@/terrain/mask.ts';
import { addWorm } from '@/sim/world.ts';
import { flatWorld } from './fixture.ts';

describe('crate landing accounting', () => {
  it('reports a lost incoming drop without claiming it was a landed crate', () => {
    const world = flatWorld({ floorY: 290, waterY: 280 });
    const crate = spawnCrate(world, 'weapon', 200);
    for (let i = 0; i < 1000 && crate.alive; i += 1) stepCrate(world, crate, TICK_S);
    expect(crate.alive).toBe(false);
    expect(world.events.some((e) => e.type === 'crateLanded')).toBe(false);
    expect(translateSimEvents(world.events)).toContainEqual({ type: 'CrateDestroyed', wasCounted: false });
  });

  it('registers only once when terrain destruction makes it fall onto a lower surface', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    const crate = spawnCrate(world, 'health', 200);
    for (let i = 0; i < 1000 && !crate.landed; i += 1) stepCrate(world, crate, TICK_S);
    expect(crate.counted).toBe(true);
    // Remove the original support, leaving a lower shelf.
    for (let y = 200; y < 230; y += 1) world.terrain.mask.data[y * world.terrain.width + 200] = 0;
    stepCrate(world, crate, TICK_S);
    expect(crate.landed).toBe(false);
    for (let i = 0; i < 1000 && !crate.landed; i += 1) stepCrate(world, crate, TICK_S);
    expect(crate.y).toBe(229);
    expect(world.events.filter((e) => e.type === 'crateLanded')).toHaveLength(1);
    // Removing the shelf sends the registered crate to water; it must decrement map count.
    for (let y = 230; y < world.terrain.height; y += 1) world.terrain.mask.data[y * world.terrain.width + 200] = 0;
    for (let i = 0; i < 1000 && crate.alive; i += 1) stepCrate(world, crate, TICK_S);
    expect(translateSimEvents(world.events)).toContainEqual({ type: 'CrateDestroyed', wasCounted: true });
  });
});

describe('the power orb', () => {
  it('shimmers in instead of a parachute, lands like any crate, and sings when a worm takes it', () => {
    const world = flatWorld({ floorY: 200, waterY: 280 });
    const orb = spawnCrate(world, 'power', 200);
    const sounds = (): (string | undefined)[] => world.events.flatMap((e) => (e.type === 'sound' ? [e.id] : []));
    expect(sounds()).toEqual(['wpn_teleport_zap']);
    for (let i = 0; i < 1000 && !orb.landed; i += 1) stepCrate(world, orb, TICK_S);
    expect(translateSimEvents(world.events)).toContainEqual({ type: 'CrateLanded', crate: 'power' });
    addWorm(world, { id: 'w', teamId: 'a', x: 204, y: 199 });
    world.events.length = 0;
    collectCrates(world);
    expect(orb.alive).toBe(false);
    expect(sounds()).toEqual(['wpn_holy_choir']);
    expect(translateSimEvents(world.events)).toContainEqual({ type: 'CratePicked', wormId: 'w', crate: 'power' });
  });
});

describe('crates under the bedrock ceiling', () => {
  it('pick a column and come down through the ceiling onto the land, not onto the ceiling', () => {
    // A real level: the bedrock ring closes the top of the world with 2 px of rock.
    const world = flatWorld({ floorY: 200, waterY: 280 });
    markBorderBedrock(world.terrain.mask);
    const x = pickCrateColumn(world);
    expect(x).not.toBeNull();
    const crate = spawnCrate(world, 'power', x ?? 200);
    for (let i = 0; i < 1000 && !crate.landed; i += 1) stepCrate(world, crate, TICK_S);
    expect(crate.landed).toBe(true);
    expect(crate.y).toBe(199);
    expect(world.events.filter((e) => e.type === 'crateLanded')).toHaveLength(1);
  });

  it('skip a column whose land reaches up to the ceiling', () => {
    const world = flatWorld({ floorY: 2, waterY: 280 });
    markBorderBedrock(world.terrain.mask);
    expect(pickCrateColumn(world)).toBeNull();
  });
});
