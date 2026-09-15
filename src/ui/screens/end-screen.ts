/**
 * End screen scoreboard (architecture.md, ui/screens/end-screen.ts): one row per team with the
 * breakdown behind the final points, winner first. buildScoreboard is pure over MatchState and
 * recomputes the final points through finalScore, which is idempotent, so it reads the same
 * whether or not the reducer has already applied finalizeScores. drawScoreboard paints the table
 * from the rows; the caller resolves team colours so this module stays free of the game layer.
 */

import type { Ctx2D, Size } from '../../engine/canvas-types.ts';
import { accuracy, finalScore } from '../../match/scoring.ts';
import type { MatchState, TeamState } from '../../match/state.ts';
import { outcome } from '../../match/win.ts';
import { leftText } from '../widgets/text.ts';

export interface ScoreRow {
  readonly teamId: string;
  readonly name: string;
  readonly colorIndex: number;
  readonly winner: boolean;
  readonly aliveWorms: number;
  readonly totalWorms: number;
  /** Hp left across the living worms. */
  readonly hpLeft: number;
  readonly kills: number;
  readonly damageDealt: number;
  readonly shotsFired: number;
  /** Whole percent, 0 when no shot was fired. */
  readonly accuracyPct: number;
  readonly points: number;
}

function rowFor(team: TeamState, winnerId: string | null): ScoreRow {
  const isWinner = team.id === winnerId;
  const alive = team.worms.filter((worm) => worm.alive);
  return Object.freeze({
    teamId: team.id,
    name: team.name,
    colorIndex: team.colorIndex,
    winner: isWinner,
    aliveWorms: alive.length,
    totalWorms: team.worms.length,
    hpLeft: alive.reduce((sum, worm) => sum + Math.max(0, worm.hp), 0),
    kills: team.score.kills,
    damageDealt: Math.round(team.score.damageDealt),
    shotsFired: team.score.shotsFired,
    accuracyPct: Math.round(accuracy(team.score) * 100),
    points: Math.round(finalScore(team, isWinner).points),
  });
}

/** Winner first, then by points descending, then by name so the order is total. */
export function buildScoreboard(state: MatchState): readonly ScoreRow[] {
  const result = outcome(state);
  const winnerId = result.kind === 'winner' ? result.teamId : null;
  const rows = state.teams.map((team) => rowFor(team, winnerId));
  rows.sort((a, b) => {
    if (a.winner !== b.winner) return a.winner ? -1 : 1;
    if (a.points !== b.points) return b.points - a.points;
    return a.name.localeCompare(b.name);
  });
  return Object.freeze(rows);
}

export const SCOREBOARD_ROW_H_PX = 26;
export const SCOREBOARD_W_PX = 640;

/** Column x offsets from the table's left edge; the first is the team name, left aligned. */
const COLUMNS: readonly { readonly label: string; readonly x: number }[] = Object.freeze([
  { label: 'Team', x: 12 },
  { label: 'Worms', x: 220 },
  { label: 'HP', x: 300 },
  { label: 'Kills', x: 370 },
  { label: 'Damage', x: 440 },
  { label: 'Shots', x: 520 },
  { label: 'Acc', x: 580 },
  { label: 'Points', x: 640 },
]);

/**
 * Draws the header and one line per row starting at top (screen px), centred horizontally.
 * Returns the y just below the table so the caller can place what follows.
 */
export function drawScoreboard(ctx: Ctx2D, viewport: Size, rows: readonly ScoreRow[], top: number, colorOf: (colorIndex: number) => string): number {
  const left = Math.round((viewport.w - SCOREBOARD_W_PX) / 2);
  const cell = (x: number, y: number, text: string, weight = '500'): void => {
    // Numeric columns are right aligned on their x; the team name is left aligned on its x.
    ctx.font = `${weight} 14px system-ui, sans-serif`;
    ctx.textAlign = x === (COLUMNS[0]?.x ?? 12) ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + x, y);
  };

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(left - 12, top - SCOREBOARD_ROW_H_PX / 2 - 4, SCOREBOARD_W_PX + 24, SCOREBOARD_ROW_H_PX * (rows.length + 1) + 8);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (const column of COLUMNS) cell(column.x, top, column.label, '600');

  rows.forEach((row, index) => {
    const y = top + SCOREBOARD_ROW_H_PX * (index + 1);
    ctx.fillStyle = colorOf(row.colorIndex);
    leftText(ctx, row.winner ? `${row.name}  (winner)` : row.name, left + 12, y, 14, row.winner ? '700' : '500');
    ctx.fillStyle = '#f4f4f4';
    cell(COLUMNS[1]?.x ?? 220, y, `${row.aliveWorms}/${row.totalWorms}`);
    cell(COLUMNS[2]?.x ?? 300, y, String(row.hpLeft));
    cell(COLUMNS[3]?.x ?? 370, y, String(row.kills));
    cell(COLUMNS[4]?.x ?? 440, y, String(row.damageDealt));
    cell(COLUMNS[5]?.x ?? 520, y, String(row.shotsFired));
    cell(COLUMNS[6]?.x ?? 580, y, `${row.accuracyPct}%`);
    cell(COLUMNS[7]?.x ?? 640, y, String(row.points), '700');
  });

  const bottom = top + SCOREBOARD_ROW_H_PX * (rows.length + 1);
  // Leave the alignment the way the screens around this table expect it.
  ctx.textAlign = 'center';
  return bottom;
}
