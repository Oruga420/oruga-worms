import { describe, expect, it } from 'vitest';
import { aliveTeams, isDraw, isTeamAlive, matchDecided, outcome, winner } from '@/match/win.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';

const SETUP: MatchSetup = {
  seed: 1,
  worldSize: { w: 400, h: 300 },
  waterY: 280,
  startingTeamIndex: 0,
  teams: [
    { name: 'A', colorIndex: 0, controller: 'human', wormNames: ['a1', 'a2'] },
    { name: 'B', colorIndex: 1, controller: 'cpu', wormNames: ['b1'] },
  ],
};

function freshState(): MatchState {
  const result = buildInitialState(SETUP);
  if (!result.ok) throw new Error(`setup failed: ${result.error.message}`);
  return result.value;
}

function killTeam(state: MatchState, index: number): MatchState {
  return {
    ...state,
    teams: state.teams.map((team, i) => (i === index ? { ...team, worms: team.worms.map((worm) => ({ ...worm, alive: false })) } : team)),
  };
}

describe('win detection', () => {
  it('reports a team alive while any worm lives', () => {
    const state = freshState();
    expect(isTeamAlive(state.teams[0]!)).toBe(true);
    const oneDown = { ...state.teams[0]!, worms: state.teams[0]!.worms.map((w, i) => (i === 0 ? { ...w, alive: false } : w)) };
    expect(isTeamAlive(oneDown)).toBe(true);
  });

  it('both teams alive: ongoing, not decided, no winner, not a draw', () => {
    const state = freshState();
    expect(aliveTeams(state)).toHaveLength(2);
    expect(matchDecided(state)).toBe(false);
    expect(outcome(state)).toEqual({ kind: 'ongoing' });
    expect(winner(state)).toBeNull();
    expect(isDraw(state)).toBe(false);
  });

  it('one team eliminated: decided with the other as winner', () => {
    const state = killTeam(freshState(), 1);
    expect(aliveTeams(state)).toHaveLength(1);
    expect(matchDecided(state)).toBe(true);
    expect(outcome(state)).toEqual({ kind: 'winner', teamId: state.teams[0]!.id });
    expect(winner(state)?.id).toBe(state.teams[0]!.id);
    expect(isDraw(state)).toBe(false);
  });

  it('all teams eliminated: decided as a draw', () => {
    const state = killTeam(killTeam(freshState(), 1), 0);
    expect(aliveTeams(state)).toHaveLength(0);
    expect(matchDecided(state)).toBe(true);
    expect(outcome(state)).toEqual({ kind: 'draw' });
    expect(winner(state)).toBeNull();
    expect(isDraw(state)).toBe(true);
  });
});
