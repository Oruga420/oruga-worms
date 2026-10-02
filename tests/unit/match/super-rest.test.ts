import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { activeTeamOf } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';
import { SUPER_REST_TURNS, restAfterSuper, restTurnEnded, superResting } from '@/match/super-rest.ts';
import { isSuper } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';

/**
 * The rest between a team's supers in the ledger: a team that uses one sits out supers for its next
 * turn, so with three teams A uses one, B and C play, A plays without one, B and C play again, and
 * only then may A use another. Every other weapon stays open.
 */

function setup(): MatchSetup {
  return {
    seed: 42,
    teams: [
      { name: 'A', colorIndex: 0, controller: 'cpu', wormNames: ['A1', 'A2'] },
      { name: 'B', colorIndex: 1, controller: 'cpu', wormNames: ['B1', 'B2'] },
      { name: 'C', colorIndex: 2, controller: 'cpu', wormNames: ['C1', 'C2'] },
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

/** Fires `weapon` in the active turn and plays the turn out, to the next team's Active. */
function fireAndPass(state: MatchState, deps: MatchDeps, weapon: WeaponId): MatchState {
  const fired = reduce(state, { type: 'FireStarted', weaponId: weapon, shotsRemaining: 0 }, deps);
  expect(fired.phase, `${weapon} refused: ${fired.log.at(-1)?.text ?? ''}`).toBe('Firing');
  return run(fired, deps, [{ type: 'FireCompleted' }, { type: 'RetreatDone' }, rest, banner, banner, banner]);
}

/** Skips the active turn, to the next team's Active. */
function pass(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [skip, rest, banner, banner, banner]);
}

function refused(state: MatchState, deps: MatchDeps, weapon: WeaponId): boolean {
  const tried = reduce(state, { type: 'FireStarted', weaponId: weapon, shotsRemaining: 0 }, deps);
  return tried.phase === 'Active' && tried.log.at(-1)?.kind === 'fire.rejected';
}

describe('super rest: the count on the team', () => {
  it('sits the team out for one of its turns after a super, counted down at its turn ends', () => {
    expect(SUPER_REST_TURNS).toBe(1);
    const { state } = start();
    const team = state.teams[0];
    if (team === undefined) throw new Error('no team');
    expect(superResting(team)).toBe(false);
    const rested = restAfterSuper(team);
    expect(superResting(rested)).toBe(true);
    const afterThisTurn = restTurnEnded(rested);
    expect(superResting(afterThisTurn)).toBe(true);
    const afterNext = restTurnEnded(afterThisTurn);
    expect(superResting(afterNext)).toBe(false);
    expect(restTurnEnded(afterNext).superRest).toBe(0);
  });
});

describe('super rest: in the match', () => {
  it('A uses one, B and C play, A may not, B and C play again, and A may', () => {
    const { state, deps } = start();
    expect(activeTeamOf(state)?.name).toBe('A');
    expect(isSuper('kamehameha')).toBe(true);
    let s = fireAndPass(state, deps, 'kamehameha');
    expect(s.teams[0]?.superRest).toBe(1);
    expect(s.log.some((entry) => entry.kind === 'super.rest')).toBe(true);
    expect(activeTeamOf(s)?.name).toBe('B');
    s = pass(s, deps);
    expect(activeTeamOf(s)?.name).toBe('C');
    s = pass(s, deps);
    expect(activeTeamOf(s)?.name).toBe('A');
    // A's turn without a super: a super is refused, a plain weapon is not.
    expect(refused(s, deps, 'ryuko_ranbu')).toBe(true);
    expect(refused(s, deps, 'gear_five')).toBe(true);
    expect(refused(s, deps, 'bazooka')).toBe(false);
    s = fireAndPass(s, deps, 'bazooka');
    expect(s.teams[0]?.superRest).toBe(0);
    s = pass(s, deps);
    s = pass(s, deps);
    expect(activeTeamOf(s)?.name).toBe('A');
    expect(refused(s, deps, 'ryuko_ranbu')).toBe(false);
  });

  it('is each team\'s own: B\'s super does not rest A, and a refused super spends no ammo', () => {
    const { state, deps } = start();
    let s = pass(state, deps);
    s = fireAndPass(s, deps, 'freezer');
    expect(s.teams[1]?.superRest).toBe(1);
    expect(s.teams[0]?.superRest).toBe(0);
    s = pass(s, deps);
    expect(activeTeamOf(s)?.name).toBe('A');
    expect(refused(s, deps, 'antares')).toBe(false);
    s = fireAndPass(s, deps, 'antares');
    expect(activeTeamOf(s)?.name).toBe('B');
    const before = s.teams[1]?.worms[s.teams[1]?.activeWormIndex ?? 0]?.ammo['gear_five'];
    expect(refused(s, deps, 'gear_five')).toBe(true);
    const tried = reduce(s, { type: 'FireStarted', weaponId: 'gear_five', shotsRemaining: 0 }, deps);
    expect(tried.teams[1]?.worms[tried.teams[1]?.activeWormIndex ?? 0]?.ammo['gear_five']).toBe(before);
  });

  it('counts the Saibaman seed and every technique as a super, and a plain weapon never starts a rest', () => {
    const { state, deps } = start();
    const after = fireAndPass(state, deps, 'saibaman');
    expect(after.teams[0]?.superRest).toBe(1);
    const plain = fireAndPass(state, deps, 'grenade');
    expect(plain.teams[0]?.superRest).toBe(0);
    for (const id of ['zoltraak', 'meteor', 'santoryu'] as const) expect(fireAndPass(state, deps, id).teams[0]?.superRest).toBe(1);
  });
});
