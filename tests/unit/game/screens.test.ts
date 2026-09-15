import { describe, expect, it } from 'vitest';
import { drawEndScreen, drawTitleScreen } from '@/game/screens.ts';
import type { Ctx2D } from '@/engine/canvas-types.ts';

/** Records the text drawn and how many rectangles were filled (the dim layer). */
function recordingCtx(): { ctx: Ctx2D; texts: string[]; rects: number } {
  const texts: string[] = [];
  const state = { rects: 0 };
  const ctx = {
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => undefined,
    restore: () => undefined,
    fillRect: () => {
      state.rects += 1;
    },
    fillText: (text: string) => {
      texts.push(text);
    },
  } as unknown as Ctx2D;
  return { ctx, texts, get rects() { return state.rects; } };
}

const VIEWPORT = { w: 1000, h: 600 };

describe('drawEndScreen', () => {
  it('dims the screen and announces the winner with a restart hint', () => {
    const rec = recordingCtx();
    drawEndScreen(rec.ctx, VIEWPORT, { winner: 'Reds', color: '#e05a4d' });
    expect(rec.rects).toBeGreaterThan(0);
    expect(rec.texts).toContain('VICTORY');
    expect(rec.texts).toContain('Reds wins');
    expect(rec.texts).toContain('Press R to play again');
  });

  it('shows DRAW and no winner line when there is no winner', () => {
    const rec = recordingCtx();
    drawEndScreen(rec.ctx, VIEWPORT, { winner: null, color: '#f4f4f4' });
    expect(rec.texts).toContain('DRAW');
    expect(rec.texts.some((t) => t.endsWith('wins'))).toBe(false);
    expect(rec.texts).toContain('Press R to play again');
  });
});

describe('drawTitleScreen', () => {
  it('dims the screen and shows the title and start prompt', () => {
    const rec = recordingCtx();
    drawTitleScreen(rec.ctx, VIEWPORT);
    expect(rec.rects).toBeGreaterThan(0);
    expect(rec.texts).toContain('ORUGAS');
    expect(rec.texts).toContain('a turn-based artillery game');
    expect(rec.texts).toContain('Press Enter or click to start');
  });
});
