import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_DEFAULT } from '@/config/constants.ts';
import { buildGame, quickGame } from '@/game/setup.ts';
import { solidCount } from '@/terrain/terrain.ts';
import { SCENARIO_IDS } from '@/terrain/scenarios.ts';
import { DEFAULT_TEAM_SETUP, toMatchSetup, type TeamSetupState } from '@/ui/screens/team-setup.ts';
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

  it.each(Array.from({ length: 12 }, (_, index) => index + 1))('fits four teams of six on island seed %i with safe spacing', (seed) => {
    const four: TeamSetupState = { teams: [0, 1, 2, 3].map((nameIndex) => ({ nameIndex, controller: 'cpu' as const, difficulty: 'normal' as const })), scenario: 'island' };
    const result = buildGame({ setup: toMatchSetup(four, seed, WORLD_SIZE_DEFAULT), createContext: createFakeFactory().factory });
    expect(result.ok, result.ok ? '' : `seed ${seed}: ${result.error.message}`).toBe(true);
    if (!result.ok) return;
    const xs = result.value.state.teams.flatMap((team) => team.worms.map((worm) => worm.x)).sort((a, b) => a - b);
    expect(xs).toHaveLength(24);
    const gap = Math.min(...xs.slice(1).map((x, i) => x - (xs[i] ?? 0)));
    expect(gap).toBeGreaterThanOrEqual(24);
    // Measured seed1 exercises the narrower-spacing fallback (43px), retaining the old aggregate check.
    if (seed === 1) expect(gap).toBeLessThan(48);
  });

  const scenarios = SCENARIO_IDS.flatMap((scenario) => [2, 4].flatMap((teamCount) =>
    [1, 2, 3, 4].map((seed) => ({ scenario, teamCount, seed }))));
  it.each(scenarios)('$scenario seed$seed: builds $teamCount teams on land above water', ({ scenario, teamCount, seed }) => {
    const four: TeamSetupState = { teams: [0, 1, 2, 3].map((nameIndex) => ({ nameIndex, controller: 'cpu' as const, difficulty: 'normal' as const })), scenario };
    const state: TeamSetupState = teamCount === 4 ? four : { ...DEFAULT_TEAM_SETUP, scenario };
    const result = buildGame({ setup: toMatchSetup(state, seed, WORLD_SIZE_DEFAULT), createContext: createFakeFactory().factory });
    expect(result.ok, result.ok ? '' : `${scenario} seed ${seed} with ${state.teams.length} teams: ${result.error.message}`).toBe(true);
    if (!result.ok) return;
    expect(result.value.terrain.scenery?.id).toBe(scenario);
    expect(result.value.world.worms).toHaveLength(state.teams.length * 6);
    for (const body of result.value.world.worms) {
      expect(body.y).toBeLessThan(result.value.terrain.water.y);
      expect(body.x).toBeGreaterThan(0);
      expect(body.x).toBeLessThan(WORLD_SIZE_DEFAULT.w);
    }
  });
});
