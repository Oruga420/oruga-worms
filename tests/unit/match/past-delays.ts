import type { MatchState } from '@/match/state.ts';

/**
 * The scheme delays count each worm's own turns (WormState.turns), so a test that wants a super,
 * the seed, the air strike or the jetpack open sets every worm's count past them, and the match
 * turn with it (the crate schedule and the logs read that one). With `turns` of 1 every worm is
 * on its first turn, and the delayed weapons stay locked.
 */
export function pastDelays(state: MatchState, turns = 10): MatchState {
  return {
    ...state,
    turn: Math.max(state.turn, turns),
    teams: state.teams.map((team) => ({ ...team, worms: team.worms.map((worm) => ({ ...worm, turns })) })),
  };
}
