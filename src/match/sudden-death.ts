/**
 * Sudden death (tuning card: round 15 min, then every worm to hpCap once and the water rises
 * waterRisePxPerTurn each turn). The check runs in the SuddenDeathCheck phase after every
 * TurnEnd; the trigger fires on the first check after the round clock expires, the water starts
 * rising on the following checks. y grows downward, so rising water means a smaller waterY.
 *
 * Drowning itself is the sim's call: it compares bodies against waterY and sends WormDrowned.
 */

import type { MatchConfig } from './deps.ts';
import { appendLog } from './ledger.ts';
import type { MatchState, TeamState } from './state.ts';

export function suddenDeathDue(state: MatchState, config: MatchConfig): boolean {
  return !state.suddenDeath && state.roundElapsedMs >= config.roundMs;
}

/** Living worms above the cap drop to it; dead worms and worms already below are untouched. */
export function capTeamsForSuddenDeath(teams: readonly TeamState[], hpCap: number): readonly TeamState[] {
  return teams.map((team) => ({
    ...team,
    worms: team.worms.map((worm) => (worm.alive && worm.hp > hpCap ? { ...worm, hp: hpCap } : worm)),
  }));
}

export function triggerSuddenDeath(state: MatchState, config: MatchConfig): MatchState {
  const hpCap = config.suddenDeath.hpCap;
  const capped: MatchState = {
    ...state,
    suddenDeath: true,
    teams: capTeamsForSuddenDeath(state.teams, hpCap),
  };
  return appendLog(capped, 'suddenDeath.start', `Sudden death: every worm drops to ${hpCap} hp`);
}

export function raiseWater(state: MatchState, config: MatchConfig): MatchState {
  const waterY = Math.max(0, state.waterY - config.suddenDeath.waterRisePxPerTurn);
  return appendLog({ ...state, waterY }, 'suddenDeath.water', `Water rises to y ${waterY}`);
}

/** One SuddenDeathCheck: trigger when due, raise the water when already in sudden death, else nothing. */
export function applySuddenDeathCheck(state: MatchState, config: MatchConfig): MatchState {
  if (suddenDeathDue(state, config)) return triggerSuddenDeath(state, config);
  if (state.suddenDeath) return raiseWater(state, config);
  return state;
}
