import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { KILL_POINTS, SURVIVOR_HP_POINTS, WINNER_BONUS } from '@/match/scoring.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState, TeamState } from '@/match/state.ts';
import { SCOREBOARD_ROW_H_PX, buildScoreboard, drawScoreboard } from '@/ui/screens/end-screen.ts';
import { createRecordingContext } from './recording-context.ts';

const SETUP: MatchSetup = {
  seed: 5,
  teams: [
    { name: 'Reds', colorIndex: 0, controller: 'human', wormNames: ['R1', 'R2'] },
    { name: 'Blues', colorIndex: 1, controller: 'cpu', wormNames: ['B1', 'B2'] },
  ],
  worldSize: { w: 1920, h: 696 },
  waterY: 640,
  startingTeamIndex: 0,
};

function start(): MatchState {
  const result = buildInitialState(SETUP, GAME_CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A state where the Reds are all dead and the Blues have one worm left with a score on the board. */
function decided(): MatchState {
  const base = start();
  const reds = base.teams[0];
  const blues = base.teams[1];
  if (reds === undefined || blues === undefined) throw new Error('teams missing');
  const deadReds: TeamState = { ...reds, worms: reds.worms.map((worm) => ({ ...worm, alive: false, hp: 0 })), score: { ...reds.score, damageDealt: 30, shotsFired: 4, shotsHit: 1 } };
  const blueWorms = blues.worms.map((worm, index) => (index === 0 ? { ...worm, alive: true, hp: 40 } : { ...worm, alive: false, hp: 0 }));
  const winningBlues: TeamState = { ...blues, worms: blueWorms, score: { ...blues.score, damageDealt: 200, kills: 2, shotsFired: 5, shotsHit: 4 } };
  return { ...base, teams: [deadReds, winningBlues] };
}

describe('end screen: buildScoreboard', () => {
  it('puts the winner first with the breakdown and the final points', () => {
    const rows = buildScoreboard(decided());
    expect(rows.map((row) => row.name)).toEqual(['Blues', 'Reds']);
    const [blues, reds] = rows;
    if (blues === undefined || reds === undefined) throw new Error('rows missing');
    expect(blues.winner).toBe(true);
    expect(blues.aliveWorms).toBe(1);
    expect(blues.totalWorms).toBe(2);
    expect(blues.hpLeft).toBe(40);
    expect(blues.kills).toBe(2);
    expect(blues.damageDealt).toBe(200);
    expect(blues.shotsFired).toBe(5);
    expect(blues.accuracyPct).toBe(80);
    // damage + kills * 50 + survivor hp * 2 + winner bonus.
    expect(blues.points).toBe(200 + 2 * KILL_POINTS + 40 * SURVIVOR_HP_POINTS + WINNER_BONUS);
    expect(reds.winner).toBe(false);
    expect(reds.aliveWorms).toBe(0);
    expect(reds.hpLeft).toBe(0);
    expect(reds.accuracyPct).toBe(25);
    expect(reds.points).toBe(30);
    expect(Object.isFrozen(rows)).toBe(true);
  });

  it('orders a fresh match by name with nobody flagged as winner', () => {
    const rows = buildScoreboard(start());
    expect(rows.every((row) => !row.winner)).toBe(true);
    expect(rows.map((row) => row.name)).toEqual(['Blues', 'Reds']);
    expect(rows.every((row) => row.points === row.hpLeft * SURVIVOR_HP_POINTS)).toBe(true);
  });
});

describe('end screen: drawScoreboard', () => {
  it('writes the header, every team and the points, and reports where the table ends', () => {
    const ctx = createRecordingContext();
    const rows = buildScoreboard(decided());
    const bottom = drawScoreboard(ctx, { w: 1280, h: 720 }, rows, 300, (index) => (index === 0 ? '#e05a4d' : '#4d8fe0'));
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('Team');
    expect(texts).toContain('Points');
    expect(texts).toContain('Blues  (winner)');
    expect(texts).toContain('Reds');
    expect(texts).toContain('80%');
    expect(bottom).toBe(300 + SCOREBOARD_ROW_H_PX * 3);
  });
});
