import { describe, expect, it } from 'vitest';
import { spawnCrate, stepCrate } from '@/sim/crate.ts';
import { TICK_S } from '@/sim/constants.ts';
import { translateSimEvents } from '@/game/bridge.ts';
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
