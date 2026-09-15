import { describe, expect, it } from 'vitest';
import {
  KILL_POINTS,
  SURVIVOR_HP_POINTS,
  WINNER_BONUS,
  accuracy,
  emptyScore,
  finalScore,
  finalizeScores,
  foldScoreEvents,
  runningPoints,
  scoreDamage,
  scoreKill,
  scoreShotClosed,
  scoreShotFired,
  survivorHp,
} from '@/match/scoring.ts';
import type { MatchEvent } from '@/match/events.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState, TeamState } from '@/match/state.ts';

const SETUP: MatchSetup = {
  seed: 2,
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

describe('score components', () => {
  it('an empty score is all zeros', () => {
    expect(emptyScore()).toEqual({ damageDealt: 0, selfDamage: 0, kills: 0, shotsFired: 0, shotsHit: 0, bestShot: 0, points: 0 });
  });

  it('running points is damage plus kills times fifty minus self damage', () => {
    const score = { ...emptyScore(), damageDealt: 30, kills: 2, selfDamage: 5 };
    expect(runningPoints(score)).toBe(30 + 2 * KILL_POINTS - 5);
  });

  it('enemy damage adds to damageDealt and updates points; zero is a no-op', () => {
    const hit = scoreDamage(emptyScore(), 25, true);
    expect(hit.damageDealt).toBe(25);
    expect(hit.points).toBe(25);
    expect(scoreDamage(hit, 0, true)).toBe(hit);
  });

  it('self damage adds to selfDamage and lowers points', () => {
    const hurt = scoreDamage(emptyScore(), 10, false);
    expect(hurt.selfDamage).toBe(10);
    expect(hurt.points).toBe(-10);
  });

  it('a fired shot bumps shotsFired', () => {
    expect(scoreShotFired(emptyScore()).shotsFired).toBe(1);
  });

  it('closing a hurting shot bumps shotsHit and tracks the best shot; a zero shot is a no-op', () => {
    const first = scoreShotClosed(emptyScore(), 20);
    expect(first).toMatchObject({ shotsHit: 1, bestShot: 20 });
    const smaller = scoreShotClosed(first, 12);
    expect(smaller.bestShot).toBe(20);
    const bigger = scoreShotClosed(smaller, 44);
    expect(bigger.bestShot).toBe(44);
    expect(scoreShotClosed(bigger, 0)).toBe(bigger);
  });

  it('a kill adds the kill points', () => {
    expect(scoreKill(emptyScore()).kills).toBe(1);
    expect(scoreKill(emptyScore()).points).toBe(KILL_POINTS);
  });

  it('accuracy is zero before a shot and the hit ratio after', () => {
    expect(accuracy(emptyScore())).toBe(0);
    expect(accuracy({ ...emptyScore(), shotsFired: 4, shotsHit: 1 })).toBe(0.25);
  });
});

describe('end of match scoring', () => {
  it('survivor hp sums only living worms', () => {
    const team = freshState().teams[0]!;
    const dead = { ...team, worms: team.worms.map((w, i) => (i === 0 ? { ...w, alive: false } : w)) };
    expect(survivorHp(team)).toBe(team.worms.reduce((s, w) => s + w.hp, 0));
    expect(survivorHp(dead)).toBe(team.worms[1]!.hp);
  });

  it('the final score adds the survivor and winner bonuses', () => {
    const team: TeamState = { ...freshState().teams[0]!, score: { ...emptyScore(), damageDealt: 40 } };
    const asWinner = finalScore(team, true);
    const asLoser = finalScore(team, false);
    expect(asWinner.points).toBe(40 + survivorHp(team) * SURVIVOR_HP_POINTS + WINNER_BONUS);
    expect(asLoser.points).toBe(40 + survivorHp(team) * SURVIVOR_HP_POINTS);
  });

  it('finalizeScores is idempotent', () => {
    const decided: MatchState = (() => {
      const state = freshState();
      return { ...state, teams: state.teams.map((t, i) => (i === 1 ? { ...t, worms: t.worms.map((w) => ({ ...w, alive: false })) } : t)) };
    })();
    const once = finalizeScores(decided);
    const twice = finalizeScores(once);
    expect(twice.teams.map((t) => t.score.points)).toEqual(once.teams.map((t) => t.score.points));
    // The surviving team (index 0) got the winner bonus.
    expect(once.teams[0]!.score.points).toBeGreaterThanOrEqual(WINNER_BONUS);
  });
});

describe('foldScoreEvents', () => {
  const teamOf = (id: string): string | undefined => (id.startsWith('a') ? 'A' : id.startsWith('b') ? 'B' : undefined);

  it('books enemy damage and credits a kill to the last team that hit the worm', () => {
    const events: MatchEvent[] = [
      { type: 'DamageApplied', wormId: 'b1', amount: 30, sourceTeamId: 'A', sourceWormId: 'a1' },
      { type: 'WormDied', wormId: 'b1' },
    ];
    const score = foldScoreEvents('A', events, teamOf);
    expect(score.damageDealt).toBe(30);
    expect(score.kills).toBe(1);
  });

  it('splits self damage and ignores environmental damage (null source)', () => {
    const events: MatchEvent[] = [
      { type: 'DamageApplied', wormId: 'a2', amount: 12, sourceTeamId: 'A', sourceWormId: 'a1' },
      { type: 'DamageApplied', wormId: 'a1', amount: 5, sourceTeamId: null, sourceWormId: null },
    ];
    const score = foldScoreEvents('A', events, teamOf);
    expect(score.selfDamage).toBe(12);
    expect(score.damageDealt).toBe(0);
  });

  it('does not credit a kill when another team landed the last hit', () => {
    const events: MatchEvent[] = [
      { type: 'DamageApplied', wormId: 'b1', amount: 10, sourceTeamId: 'A', sourceWormId: 'a1' },
      { type: 'DamageApplied', wormId: 'b1', amount: 90, sourceTeamId: 'B', sourceWormId: 'b1' },
      { type: 'WormDied', wormId: 'b1' },
    ];
    expect(foldScoreEvents('A', events, teamOf).kills).toBe(0);
  });
});
