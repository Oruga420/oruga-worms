import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { frozenWorms, takeFrozenTurn } from '@/match/freeze.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';

function setup(): MatchSetup {
  return {
    seed: 7,
    teams: [
      { name: 'Reds', colorIndex: 0, controller: 'cpu', wormNames: ['R1', 'R2'] },
      { name: 'Blues', colorIndex: 1, controller: 'cpu', wormNames: ['B1', 'B2'] },
    ],
    worldSize: { w: 1920, h: 696 },
    waterY: 640,
    startingTeamIndex: 0,
  };
}

function start(): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(7, GAME_CONFIG);
  const result = buildInitialState(setup(), GAME_CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.value, deps };
}

function run(state: MatchState, deps: MatchDeps, events: readonly MatchEvent[]): MatchState {
  return events.reduce((current, event) => reduce(current, event, deps), state);
}

/** Sets every living worm's frozenTurns to `turns`. */
function freezeEveryone(state: MatchState, turns: number): MatchState {
  return { ...state, teams: state.teams.map((t) => ({ ...t, worms: t.worms.map((w) => ({ ...w, frozenTurns: turns })) })) };
}

const banner: MatchEvent = { type: 'BannerDone' };
const rest: MatchEvent = { type: 'AllBodiesAtRest' };

/** From a TurnStart whose active worm is frozen, all the way to the next TurnStart. */
function skipOneFrozenTurn(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [banner, rest, banner, banner]);
}

describe('frozenWorms', () => {
  it('holds a living worm with frozenTurns > 0, nobody else', () => {
    const { state } = start();
    const frozen = { ...state, teams: state.teams.map((t, i) => (i === 0 ? { ...t, worms: t.worms.map((w, j) => (j === 0 ? { ...w, frozenTurns: 1 } : w)) } : t)) };
    const held = frozenWorms(frozen);
    expect(held('team-1-worm-1')).toBe(true);
    expect(held('team-1-worm-2')).toBe(false);
    expect(held('team-2-worm-1')).toBe(false);
  });
});

describe('takeFrozenTurn', () => {
  it('is null when the active worm is free', () => {
    const { state } = start();
    expect(takeFrozenTurn(state).taken).toBeNull();
  });

  it('spends exactly one frozenTurns from the active worm and logs the skip', () => {
    const { state } = start();
    const active = activeWormOf(state);
    expect(active).toBeDefined();
    if (active === undefined) return;
    const frozen = { ...state, teams: state.teams.map((t) => ({ ...t, worms: t.worms.map((w) => (w.id === active.id ? { ...w, frozenTurns: 2 } : w)) })) };
    const { taken } = takeFrozenTurn(frozen);
    expect(taken).not.toBeNull();
    if (taken === null) return;
    expect(taken.teams.flatMap((t) => t.worms).find((w) => w.id === active.id)?.frozenTurns).toBe(1);
    expect(taken.log.at(-1)).toMatchObject({ kind: 'turn.skip' });
  });
});

describe('time_stop landing (FreezeApplied)', () => {
  it('freezes every living worm but the caster, friend and foe alike', () => {
    const { state, deps } = start();
    const casterId = 'team-1-worm-1';
    const frozen = reduce(state, { type: 'FreezeApplied', casterId, turns: 1 }, deps);
    const byId = new Map(frozen.teams.flatMap((t) => t.worms).map((w) => [w.id, w]));
    expect(byId.get(casterId)?.frozenTurns).toBe(0);
    expect(byId.get('team-1-worm-2')?.frozenTurns).toBe(1);
    expect(byId.get('team-2-worm-1')?.frozenTurns).toBe(1);
    expect(byId.get('team-2-worm-2')?.frozenTurns).toBe(1);
  });

  it('stacks on a worm already owed a turn from an earlier cast', () => {
    const { state, deps } = start();
    const once = reduce(state, { type: 'FreezeApplied', casterId: 'team-1-worm-1', turns: 1 }, deps);
    const twice = reduce(once, { type: 'FreezeApplied', casterId: 'team-1-worm-2', turns: 1 }, deps);
    const byId = new Map(twice.teams.flatMap((t) => t.worms).map((w) => [w.id, w]));
    // team-1-worm-1 was frozen by the second cast; team-1-worm-2 was frozen by the first: both owe one.
    expect(byId.get('team-1-worm-1')?.frozenTurns).toBe(1);
    expect(byId.get('team-1-worm-2')?.frozenTurns).toBe(1);
    // Hit by both casts (the other team is never the caster of either): owes two.
    expect(byId.get('team-2-worm-1')?.frozenTurns).toBe(2);
  });
});

describe('the rotation never stalls, even with everyone frozen at once', () => {
  it('returns every worm to play when one free teammate would otherwise bypass frozen slots', () => {
    const { state, deps } = start();
    let current = reduce(state, { type: 'FreezeApplied', casterId: 'team-1-worm-1', turns: 1 }, deps);
    const played = new Set<string>();
    for (let step = 0; step < 100; step += 1) {
      if (current.phase === 'Active') {
        played.add(activeWormOf(current)?.id ?? '');
        current = reduce(current, { type: 'SkipTurn' }, deps);
      } else if (current.phase === 'Resolving') current = reduce(current, rest, deps);
      else current = reduce(current, banner, deps);
    }
    expect(played).toEqual(new Set(state.teams.flatMap((team) => team.worms.map((worm) => worm.id))));
    expect(current.teams.flatMap((team) => team.worms).every((worm) => worm.frozenTurns === 0)).toBe(true);
  });
  it('skips every frozen worm in turn, one real turn at a time, until somebody is free to play', () => {
    const { state, deps } = start();
    // Every worm on the field owes one turn: nobody can act yet, but the match must still progress.
    let current = freezeEveryone(state, 1);
    const totalWorms = current.teams.flatMap((t) => t.worms).length;
    for (let i = 0; i < totalWorms; i += 1) {
      const before = activeWormOf(current);
      expect(before).toBeDefined();
      current = skipOneFrozenTurn(current, deps);
      const after = current.teams.flatMap((t) => t.worms).find((w) => w.id === before?.id);
      expect(after?.frozenTurns).toBe(0);
      expect(current.phase).toBe('TurnStart');
    }
    // Every worm has had its one owed turn taken: the next one is free to actually play.
    const active = reduce(current, banner, deps);
    expect(active.phase === 'Active' || active.phase === 'HotSeat').toBe(true);
  });
});
