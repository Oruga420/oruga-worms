/**
 * Scoring (architecture.md section E):
 *
 *   points = damageDealtToEnemies + kills * 50 - (selfDamage + friendlyDamage)
 *          + survivingWormHpAtMatchEnd * 2 + (winner ? 200 : 0)
 *
 * The reducer folds damage as it happens (with the hp the victim actually had left), closes a
 * shot window per FireStarted for accuracy and best shot, and credits a kill to the team that
 * hit the worm last. finalizeScores adds the two end of match bonuses; it recomputes from the
 * components, so applying it twice changes nothing. Friendly damage is booked as selfDamage.
 */

import type { MatchEvent } from './events.ts';
import type { MatchState, TeamScore, TeamState } from './state.ts';
import { outcome } from './win.ts';

export const KILL_POINTS = 50;
export const SURVIVOR_HP_POINTS = 2;
export const WINNER_BONUS = 200;

export function emptyScore(): TeamScore {
  return Object.freeze({
    damageDealt: 0,
    selfDamage: 0,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    bestShot: 0,
    points: 0,
  });
}

/** Points from the components that accrue during play, without the end of match bonuses. */
export function runningPoints(score: TeamScore): number {
  return score.damageDealt + score.kills * KILL_POINTS - score.selfDamage;
}

function withPoints(score: TeamScore): TeamScore {
  return { ...score, points: runningPoints(score) };
}

export function scoreDamage(score: TeamScore, effectiveDamage: number, toEnemy: boolean): TeamScore {
  if (effectiveDamage <= 0) return score;
  return withPoints(
    toEnemy
      ? { ...score, damageDealt: score.damageDealt + effectiveDamage }
      : { ...score, selfDamage: score.selfDamage + effectiveDamage },
  );
}

export function scoreShotFired(score: TeamScore): TeamScore {
  return { ...score, shotsFired: score.shotsFired + 1 };
}

/** Closes a shot window: a shot that hurt an enemy counts as a hit and may become the best shot. */
export function scoreShotClosed(score: TeamScore, shotDamage: number): TeamScore {
  if (shotDamage <= 0) return score;
  return { ...score, shotsHit: score.shotsHit + 1, bestShot: Math.max(score.bestShot, shotDamage) };
}

export function scoreKill(score: TeamScore): TeamScore {
  return withPoints({ ...score, kills: score.kills + 1 });
}

/** shotsHit / shotsFired in 0..1; 0 before the first shot. */
export function accuracy(score: TeamScore): number {
  return score.shotsFired === 0 ? 0 : score.shotsHit / score.shotsFired;
}

export function survivorHp(team: TeamState): number {
  return team.worms.reduce((sum, worm) => (worm.alive ? sum + worm.hp : sum), 0);
}

export function finalScore(team: TeamState, isWinner: boolean): TeamScore {
  const bonus = survivorHp(team) * SURVIVOR_HP_POINTS + (isWinner ? WINNER_BONUS : 0);
  return { ...team.score, points: runningPoints(team.score) + bonus };
}

/** Adds the survivor and winner bonuses to every team; idempotent. */
export function finalizeScores(state: MatchState): MatchState {
  const result = outcome(state);
  const winnerId = result.kind === 'winner' ? result.teamId : null;
  return {
    ...state,
    teams: state.teams.map((team) => ({ ...team, score: finalScore(team, team.id === winnerId) })),
  };
}

/**
 * Pure fold of a recorded event stream into one team's score: damage the team dealt, split into
 * enemy and self by the victim's team, and kills credited to the last team that hit the worm.
 * Amounts are taken as sent; the live reducer clamps them to the hp the victim had left.
 */
export function foldScoreEvents(
  teamId: string,
  events: readonly MatchEvent[],
  teamOfWorm: (wormId: string) => string | undefined,
  initial: TeamScore = emptyScore(),
): TeamScore {
  const lastHit = new Map<string, string>();
  let score = initial;
  for (const event of events) {
    if (event.type === 'DamageApplied') {
      if (event.sourceTeamId === null) continue;
      lastHit.set(event.wormId, event.sourceTeamId);
      if (event.sourceTeamId !== teamId) continue;
      score = scoreDamage(score, event.amount, teamOfWorm(event.wormId) !== teamId);
    } else if (event.type === 'WormDied' || event.type === 'WormDrowned') {
      const credit = lastHit.get(event.wormId);
      if (credit === teamId && teamOfWorm(event.wormId) !== teamId) score = scoreKill(score);
    }
  }
  return score;
}
