import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchConfig, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';

/**
 * The scheduled supply crate. Random crate odds are zeroed so the only
 * crate that can appear is the forced one, which keeps these tests deterministic.
 */
const NO_RANDOM_CRATES: MatchConfig = {
  ...GAME_CONFIG,
  crates: { ...GAME_CONFIG.crates, weaponPct: 0, healthPct: 0, utilityPct: 0, dropEveryTurns: 3 },
};

const SETUP: MatchSetup = {
  seed: 42,
  teams: [
    { name: 'Reds', colorIndex: 0, controller: 'cpu', wormNames: ['R1', 'R2'] },
    { name: 'Blues', colorIndex: 1, controller: 'cpu', wormNames: ['B1', 'B2'] },
  ],
  worldSize: { w: 1920, h: 696 },
  waterY: 640,
  startingTeamIndex: 0,
};

function start(config: MatchConfig = NO_RANDOM_CRATES): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(42, config);
  const result = buildInitialState(SETUP, config);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.value, deps };
}

function run(state: MatchState, deps: MatchDeps, events: readonly MatchEvent[]): MatchState {
  return events.reduce((current, event) => reduce(current, event, deps), state);
}

const BANNER: MatchEvent = { type: 'BannerDone' };

/** One full bazooka turn: TurnStart -> Active -> Firing -> Retreat -> Resolving -> TurnEnd. */
function fireOneTurn(state: MatchState, deps: MatchDeps): MatchState {
  const active = reduce(state, BANNER, deps);
  expect(active.phase).toBe('Active');
  const ended = run(active, deps, [
    { type: 'FireStarted', weaponId: 'bazooka', shotsRemaining: 0 },
    { type: 'FireCompleted' },
    { type: 'RetreatDone' },
    { type: 'AllBodiesAtRest' },
  ]);
  expect(ended.phase).toBe('TurnEnd');
  return ended;
}

/** TurnEnd -> SuddenDeathCheck -> next TurnStart. */
function nextTurn(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [BANNER, BANNER]);
}

describe('scheduled supply drops every N completed turns', () => {
  it('counts completed turns and delivers a crate on the third TurnEnd', () => {
    const { state, deps } = start();
    expect(state.turnsSinceCrateDrop).toBe(0);

    const t1 = fireOneTurn(state, deps);
    expect(t1.turnsSinceCrateDrop).toBe(1);
    expect(t1.crateDrop).toBeNull();

    const t2 = fireOneTurn(nextTurn(t1, deps), deps);
    expect(t2.turnsSinceCrateDrop).toBe(2);
    expect(t2.crateDrop).toBeNull();

    const t3 = fireOneTurn(nextTurn(t2, deps), deps);
    expect(t3.crateDrop).toBe('weapon');
    expect(t3.turnsSinceCrateDrop).toBe(0);
    // Random odds are zero, so the one crate.drop entry in the whole log is the forced one.
    expect(t3.log.filter((entry) => entry.kind === 'crate.drop')).toHaveLength(1);
  });

  it('counts a timeout even when nothing was fired', () => {
    const { state, deps } = start();
    const active = reduce(state, BANNER, deps);
    // Let the turn timer expire with no shot.
    const expired = run(active, deps, [{ type: 'TimerTick', dtMs: NO_RANDOM_CRATES.turnMs + 1 }, { type: 'AllBodiesAtRest' }]);
    expect(expired.phase).toBe('TurnEnd');
    expect(expired.turnsSinceCrateDrop).toBe(1);
    expect(expired.crateDrop).toBeNull();
  });

  it('keeps the counter instead of losing the crate when the map is full', () => {
    const full: MatchConfig = { ...NO_RANDOM_CRATES, crates: { ...NO_RANDOM_CRATES.crates, maxOnMap: 0 } };
    const { state, deps } = start(full);
    let current = state;
    for (let i = 0; i < 3; i += 1) current = i === 0 ? fireOneTurn(current, deps) : fireOneTurn(nextTurn(current, deps), deps);
    // Three completed turns, no room: nothing drops and the debt is remembered.
    expect(current.crateDrop).toBeNull();
    expect(current.turnsSinceCrateDrop).toBe(3);
  });

  it('is disabled by dropEveryTurns 0', () => {
    const off: MatchConfig = { ...NO_RANDOM_CRATES, crates: { ...NO_RANDOM_CRATES.crates, dropEveryTurns: 0 } };
    const { state, deps } = start(off);
    let current = state;
    for (let i = 0; i < 4; i += 1) current = i === 0 ? fireOneTurn(current, deps) : fireOneTurn(nextTurn(current, deps), deps);
    expect(current.crateDrop).toBeNull();
    expect(current.turnsSinceCrateDrop).toBe(4);
  });

  it('does not count an unfinished two barrel shotgun turn', () => {
    const { state, deps } = start();
    const active = reduce(state, BANNER, deps);
    const afterFirst = run(active, deps, [{ type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 1 }, { type: 'FireCompleted' }]);
    expect(afterFirst.phase).toBe('Active');
    expect(afterFirst.turnsSinceCrateDrop).toBe(0);
    const afterSecond = run(afterFirst, deps, [{ type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 0 }, { type: 'FireCompleted' }]);
    expect(afterSecond.turnsSinceCrateDrop).toBe(0);
  });
});


it('drops after three skips and waits for a pending parachute before announcing another', () => {
  const { state, deps } = start();
  let current = state;
  for (let i = 1; i <= 6; i += 1) {
    current = run(current, deps, [BANNER, { type: 'SkipTurn' }, { type: 'AllBodiesAtRest' }]);
    expect(current.crateDrop).toBe(i < 3 ? null : 'weapon');
    if (i < 6) current = nextTurn(current, deps);
  }
  expect(current.turnsSinceCrateDrop).toBe(3);
  expect(current.log.filter((entry) => entry.kind === 'crate.drop')).toHaveLength(1);
  current = reduce(current, { type: 'CrateLanded', crate: 'weapon' }, deps);
  current = run(nextTurn(current, deps), deps, [BANNER, { type: 'SkipTurn' }, { type: 'AllBodiesAtRest' }]);
  expect(current.crateDrop).toBe('weapon');
  expect(current.turnsSinceCrateDrop).toBe(0);
});
