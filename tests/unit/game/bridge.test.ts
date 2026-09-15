import { describe, expect, it } from 'vitest';
import { isSimPhase, snapshotPositions, syncMatchToSim, translateSimEvents } from '@/game/bridge.ts';
import type { SimEvent } from '@/sim/types.ts';
import { addWorm, createWorld } from '@/sim/world.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import { createMask } from '@/terrain/mask.ts';
import { createTiles } from '@/terrain/tiles.ts';
import { createWater } from '@/terrain/water.ts';
import { DEFAULT_THEME } from '@/terrain/terrain.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

function terrain() {
  return {
    width: 400,
    height: 300,
    mask: createMask(400, 300),
    tiles: createTiles(400, 300, createFakeFactory().factory),
    water: createWater(280),
    theme: DEFAULT_THEME,
    seed: 1,
    source: 'procedural' as const,
  };
}

function setup(): MatchSetup {
  return {
    seed: 1,
    worldSize: { w: 400, h: 300 },
    waterY: 280,
    teams: [
      { name: 'Reds', colorIndex: 0, controller: 'human', wormNames: ['r1'] },
      { name: 'Blues', colorIndex: 1, controller: 'cpu', wormNames: ['b1'] },
    ],
  };
}

describe('translateSimEvents', () => {
  it('maps damage, drown, activity and crate events to match events', () => {
    const events: SimEvent[] = [
      { type: 'damage', wormId: 'w', amount: 30, sourceTeamId: 't1', sourceWormId: 's1', cause: 'blast' },
      { type: 'drown', wormId: 'w2' },
      { type: 'activity', kind: 'bounce' },
      { type: 'crateLanded', crateId: 1, kind: 'health', x: 0, y: 0 },
      { type: 'sound', id: 'boom', x: 0, y: 0 },
      { type: 'explosion', x: 0, y: 0, radius: 40, particle: 'medium', shake: 4 },
    ];
    const matchEvents = translateSimEvents(events);
    expect(matchEvents.map((e) => e.type)).toEqual(['DamageApplied', 'WormDrowned', 'ActivityPing', 'CrateLanded']);
    expect(matchEvents[0]).toMatchObject({ wormId: 'w', amount: 30, sourceTeamId: 't1' });
  });
});

describe('syncMatchToSim', () => {
  it('kills the sim body of a worm the match marked dead', () => {
    const state = buildInitialState(setup());
    if (!state.ok) throw new Error('setup failed');
    const world = createWorld(terrain(), { seed: 1 });
    const body = addWorm(world, { id: 'team-1-worm-1', teamId: 'team-1', x: 10, y: 10 });
    const dead = {
      ...state.value,
      teams: state.value.teams.map((team, i) => (i === 0 ? { ...team, worms: team.worms.map((w) => ({ ...w, alive: false, hp: 0 })) } : team)),
    };
    syncMatchToSim(dead, world);
    expect(body.alive).toBe(false);
    expect(body.motion).toBe('dead');
  });
});

describe('snapshotPositions', () => {
  it('copies sim body positions back into the match ledger', () => {
    const state = buildInitialState(setup());
    if (!state.ok) throw new Error('setup failed');
    const world = createWorld(terrain(), { seed: 1 });
    const body = addWorm(world, { id: 'team-1-worm-1', teamId: 'team-1', x: 123, y: 88 });
    body.x = 200;
    body.y = 150;
    const snapped = snapshotPositions(state.value, world);
    expect(snapped.teams[0]?.worms[0]).toMatchObject({ x: 200, y: 150 });
    expect(state.value.teams[0]?.worms[0]?.x).not.toBe(200);
  });
});

describe('isSimPhase', () => {
  it('is true only for the motion phases', () => {
    expect(isSimPhase('Active')).toBe(true);
    expect(isSimPhase('Firing')).toBe(true);
    expect(isSimPhase('Retreat')).toBe(true);
    expect(isSimPhase('Resolving')).toBe(true);
    expect(isSimPhase('TurnStart')).toBe(false);
    expect(isSimPhase('TurnEnd')).toBe(false);
    expect(isSimPhase('MatchEnd')).toBe(false);
  });
});
