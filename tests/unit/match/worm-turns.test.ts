import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';

/**
 * The scheme delays are each worm's own (WormState.turns): a weapon with delayTurns 2 opens on a
 * worm's second turn, whenever in the match that is, and a worm on its first turn is locked out
 * of it however late the match is. Before, they counted the match turn, so from turn 2 everyone
 * was open at once.
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

const banner: MatchEvent = { type: 'BannerDone' };
const rest: MatchEvent = { type: 'AllBodiesAtRest' };
const skip: MatchEvent = { type: 'SkipTurn', reason: 'skip' };

function start(): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(42, GAME_CONFIG);
  const result = buildInitialState(setup(), GAME_CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  return { state: reduce(result.value, banner, deps), deps };
}

function run(state: MatchState, deps: MatchDeps, events: readonly MatchEvent[]): MatchState {
  return events.reduce((current, event) => reduce(current, event, deps), state);
}

/** Skips the active turn, to the next worm's Active. */
function pass(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [skip, rest, banner, banner, banner]);
}

function refused(state: MatchState, deps: MatchDeps, weapon: WeaponId): boolean {
  const tried = reduce(state, { type: 'FireStarted', weaponId: weapon, shotsRemaining: 0 }, deps);
  return tried.phase === 'Active' && tried.log.at(-1)?.kind === 'fire.rejected';
}

function turnsOf(state: MatchState, wormId: string): number | undefined {
  return state.teams.flatMap((team) => team.worms).find((worm) => worm.id === wormId)?.turns;
}

describe('a worm counts its own turns', () => {
  it('from its first, the turn it is up included, and only its own', () => {
    const { state, deps } = start();
    expect(state.phase).toBe('Active');
    expect(activeWormOf(state)?.id).toBe('team-1-worm-1');
    expect(turnsOf(state, 'team-1-worm-1')).toBe(1);
    expect(turnsOf(state, 'team-1-worm-2')).toBe(0);
    expect(turnsOf(state, 'team-2-worm-1')).toBe(0);
    let s = pass(state, deps);
    expect(activeWormOf(s)?.id).toBe('team-2-worm-1');
    expect(turnsOf(s, 'team-2-worm-1')).toBe(1);
    s = pass(pass(pass(s, deps), deps), deps);
    expect(s.turn).toBe(5);
    expect(activeWormOf(s)?.id).toBe('team-1-worm-1');
    expect(turnsOf(s, 'team-1-worm-1')).toBe(2);
    expect(turnsOf(s, 'team-1-worm-2')).toBe(1);
    expect(turnsOf(s, 'team-2-worm-2')).toBe(1);
  });

  it('opens a delayed weapon on its second own turn and not before, whatever the match turn', () => {
    expect(WEAPONS.kamehameha.delayTurns).toBe(2);
    expect(WEAPONS.air_strike.delayTurns).toBe(2);
    expect(WEAPONS.jetpack.delayTurns).toBe(2);
    const { state, deps } = start();
    // A1 on its first turn: locked, and the ammo untouched.
    expect(refused(state, deps, 'kamehameha')).toBe(true);
    expect(activeWormOf(state)?.ammo.kamehameha).toBe(1);
    // B2 on its first turn at match turn 4: still locked, though the match is well past turn 2.
    let s = pass(pass(pass(state, deps), deps), deps);
    expect(s.turn).toBe(4);
    expect(activeWormOf(s)?.id).toBe('team-2-worm-2');
    expect(refused(s, deps, 'air_strike')).toBe(true);
    expect(refused(s, deps, 'kamehameha')).toBe(true);
    expect(refused(s, deps, 'bazooka')).toBe(false);
    // A1 on its second own turn: open.
    s = pass(s, deps);
    expect(activeWormOf(s)?.id).toBe('team-1-worm-1');
    expect(refused(s, deps, 'kamehameha')).toBe(false);
    const fired = reduce(s, { type: 'FireStarted', weaponId: 'kamehameha', shotsRemaining: 0 }, deps);
    expect(fired.phase).toBe('Firing');
    expect(activeWormOf(fired)?.ammo.kamehameha).toBe(0);
  });
});
