import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';
import { SUPER_REST_TURNS, restAfterSuper, restTurnEnded, superResting } from '@/match/super-rest.ts';
import { isSuper } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';

/**
 * The rest between a worm's supers in the ledger: a worm that uses one sits out supers for its own
 * next turn, its team mates play on as they like, and every other weapon stays open to it.
 */

function setup(): MatchSetup {
  return {
    seed: 42,
    teams: [
      { name: 'A', colorIndex: 0, controller: 'cpu', wormNames: ['A1', 'A2'] },
      { name: 'B', colorIndex: 1, controller: 'cpu', wormNames: ['B1', 'B2'] },
    ],
    worldSize: { w: 1920, h: 696 },
    waterY: 640,
    startingTeamIndex: 0,
  };
}

function start(): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(42, GAME_CONFIG);
  const result = buildInitialState(setup(), GAME_CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  // Past every super's scheme delay, and into the first turn.
  return { state: reduce({ ...result.value, turn: 10 }, { type: 'BannerDone' }, deps), deps };
}

function run(state: MatchState, deps: MatchDeps, events: readonly MatchEvent[]): MatchState {
  return events.reduce((current, event) => reduce(current, event, deps), state);
}

const banner: MatchEvent = { type: 'BannerDone' };
const rest: MatchEvent = { type: 'AllBodiesAtRest' };
const skip: MatchEvent = { type: 'SkipTurn', reason: 'skip' };

/** Fires `weapon` in the active turn and plays the turn out, to the next worm's Active. */
function fireAndPass(state: MatchState, deps: MatchDeps, weapon: WeaponId): MatchState {
  const fired = reduce(state, { type: 'FireStarted', weaponId: weapon, shotsRemaining: 0 }, deps);
  expect(fired.phase, `${weapon} refused: ${fired.log.at(-1)?.text ?? ''}`).toBe('Firing');
  return run(fired, deps, [{ type: 'FireCompleted' }, { type: 'RetreatDone' }, rest, banner, banner, banner]);
}

/** Skips the active turn, to the next worm's Active. */
function pass(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [skip, rest, banner, banner, banner]);
}

function refused(state: MatchState, deps: MatchDeps, weapon: WeaponId): boolean {
  const tried = reduce(state, { type: 'FireStarted', weaponId: weapon, shotsRemaining: 0 }, deps);
  return tried.phase === 'Active' && tried.log.at(-1)?.kind === 'fire.rejected';
}

function restOf(state: MatchState, wormId: string): number | undefined {
  return state.teams.flatMap((team) => team.worms).find((worm) => worm.id === wormId)?.superRest;
}

describe('super rest: the count on the worm', () => {
  it('sits the worm out for one of its turns after a super, counted down at its own turn ends', () => {
    expect(SUPER_REST_TURNS).toBe(1);
    const { state } = start();
    const worm = activeWormOf(state);
    if (worm === undefined) throw new Error('no worm');
    expect(superResting(worm)).toBe(false);
    const rested = restAfterSuper(worm);
    expect(superResting(rested)).toBe(true);
    const afterThisTurn = restTurnEnded(rested);
    expect(superResting(afterThisTurn)).toBe(true);
    const afterNext = restTurnEnded(afterThisTurn);
    expect(superResting(afterNext)).toBe(false);
    expect(restTurnEnded(afterNext).superRest).toBe(0);
  });
});

describe('super rest: in the match', () => {
  it('A1 uses one; B1 and A2 play as they like; A1 may not on its next turn, and may on the one after', () => {
    const { state, deps } = start();
    expect(activeWormOf(state)?.id).toBe('team-1-worm-1');
    expect(isSuper('kamehameha')).toBe(true);
    let s = fireAndPass(state, deps, 'kamehameha');
    expect(restOf(s, 'team-1-worm-1')).toBe(1);
    expect(restOf(s, 'team-1-worm-2')).toBe(0);
    expect(s.log.some((entry) => entry.kind === 'super.rest')).toBe(true);
    // B1 is free, and so is A2, A1's team mate.
    expect(activeTeamOf(s)?.name).toBe('B');
    expect(refused(s, deps, 'freezer')).toBe(false);
    s = pass(s, deps);
    expect(activeWormOf(s)?.id).toBe('team-1-worm-2');
    expect(refused(s, deps, 'ryuko_ranbu')).toBe(false);
    s = pass(s, deps);
    s = pass(s, deps);
    // A1's own next turn: a super is refused, a plain weapon is not.
    expect(activeWormOf(s)?.id).toBe('team-1-worm-1');
    expect(refused(s, deps, 'ryuko_ranbu')).toBe(true);
    expect(refused(s, deps, 'gear_five')).toBe(true);
    expect(refused(s, deps, 'bazooka')).toBe(false);
    s = fireAndPass(s, deps, 'bazooka');
    expect(restOf(s, 'team-1-worm-1')).toBe(0);
    s = pass(s, deps);
    s = pass(s, deps);
    s = pass(s, deps);
    expect(activeWormOf(s)?.id).toBe('team-1-worm-1');
    expect(refused(s, deps, 'ryuko_ranbu')).toBe(false);
  });

  it('is each worm\'s own: a refused super spends no ammo, and a team mate\'s super does not rest the worm', () => {
    const { state, deps } = start();
    let s = fireAndPass(state, deps, 'antares');
    s = pass(s, deps);
    // A2 fires one too: A1 and A2 each rest on their own count.
    s = fireAndPass(s, deps, 'freezer');
    expect(restOf(s, 'team-1-worm-1')).toBe(1);
    expect(restOf(s, 'team-1-worm-2')).toBe(1);
    s = pass(s, deps);
    expect(activeWormOf(s)?.id).toBe('team-1-worm-1');
    const before = activeWormOf(s)?.ammo['gear_five'];
    expect(refused(s, deps, 'gear_five')).toBe(true);
    const tried = reduce(s, { type: 'FireStarted', weaponId: 'gear_five', shotsRemaining: 0 }, deps);
    expect(activeWormOf(tried)?.ammo['gear_five']).toBe(before);
  });

  it('counts the Saibaman seed and every technique as a super, and a plain weapon never starts a rest', () => {
    const { state, deps } = start();
    expect(restOf(fireAndPass(state, deps, 'saibaman'), 'team-1-worm-1')).toBe(1);
    expect(restOf(fireAndPass(state, deps, 'grenade'), 'team-1-worm-1')).toBe(0);
    for (const id of ['zoltraak', 'meteor', 'santoryu', 'final_explosion'] as const) expect(restOf(fireAndPass(state, deps, id), 'team-1-worm-1')).toBe(1);
  });
});
