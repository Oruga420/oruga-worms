import { describe, expect, it } from 'vitest';
import { buildGame, quickGame } from '@/game/setup.ts';
import { solidCount } from '@/terrain/terrain.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

describe('buildGame / quickGame', () => {
  it('builds a 2 team game with terrain, spawned worms mirrored into the sim', () => {
    const result = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    const game = result.value;
    expect(game.state.teams).toHaveLength(2);
    expect(game.state.teams[0]?.controller).toBe('human');
    expect(game.state.teams[1]?.controller).toBe('cpu');
    const totalWorms = game.state.teams.reduce((n, t) => n + t.worms.length, 0);
    expect(game.world.worms).toHaveLength(totalWorms);
    expect(solidCount(game.terrain)).toBeGreaterThan(0);
    // Every worm body id matches a match worm id.
    const matchIds = new Set(game.state.teams.flatMap((t) => t.worms.map((w) => w.id)));
    for (const body of game.world.worms) expect(matchIds.has(body.id)).toBe(true);
  });

  it('is deterministic for the same seed', () => {
    const a = quickGame(11, createFakeFactory().factory, { w: 1000, h: 400 });
    const b = quickGame(11, createFakeFactory().factory, { w: 1000, h: 400 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.world.worms.map((w) => [Math.round(w.x), Math.round(w.y)])).toEqual(b.value.world.worms.map((w) => [Math.round(w.x), Math.round(w.y)]));
    }
  });

  it('places worms above the water line', () => {
    const result = buildGame({
      setup: {
        seed: 3,
        worldSize: { w: 1000, h: 400 },
        waterY: 376,
        teams: [
          { name: 'A', colorIndex: 0, controller: 'human', wormNames: ['a1', 'a2'] },
          { name: 'B', colorIndex: 1, controller: 'cpu', wormNames: ['b1', 'b2'] },
        ],
      },
      createContext: createFakeFactory().factory,
    });
    expect(result.ok).toBe(true);
    if (result.ok) for (const body of result.value.world.worms) expect(body.y).toBeLessThan(result.value.terrain.water.y);
  });
});
