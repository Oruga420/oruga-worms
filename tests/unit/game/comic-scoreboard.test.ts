import { describe, expect, it } from 'vitest';
import { drawScoreboard, type ScoreRow } from '@/ui/screens/end-screen.ts';
import { drawEndScreen } from '@/game/screens.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const rows: readonly ScoreRow[] = Array.from({ length: 4 }, (_, index) => ({ teamId: String(index), name: `Team ${index}`, colorIndex: index, winner: index === 0, aliveWorms: 6, totalWorms: 6, hpLeft: 600, kills: 2, damageDealt: 200, shotsFired: 4, accuracyPct: 50, points: 200 }));

describe('comic scoreboard on phones', () => {
  it('keeps every portrait table rectangle within the viewport gutter', () => {
    const ctx = createRecordingContext();
    drawScoreboard(ctx, { w: 320, h: 568 }, rows, 300, () => '#ffd34e');
    for (const call of ctx.calls.filter((entry) => entry.name === 'fillRect')) {
      const [x, , w] = call.args as number[];
      expect(x).toBeGreaterThanOrEqual(16);
      expect((x ?? 0) + (w ?? 0)).toBeLessThanOrEqual(304);
    }
  });

  it('keeps the landscape restart hint visible after four score rows', () => {
    const ctx = createRecordingContext();
    drawEndScreen(ctx, { w: 844, h: 390 }, { winner: 'Team 0', color: '#ffd34e', rows, colorOf: () => '#ffd34e' });
    const hint = ctx.calls.find((call) => call.name === 'fillText' && call.args[0] === 'Press R to play again');
    expect(hint?.args[2]).toBeLessThanOrEqual(374);
  });
});
