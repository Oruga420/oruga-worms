import { describe, expect, it } from 'vitest';
import { drawEndScreen, drawTitleScreen, hitTestTitle, layoutTitleScreen } from '@/game/screens.ts';
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
    strokeRect: () => undefined,
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

describe('title device choice', () => {
  it('offers a computer and a phone or tablet button, and the hit test names them', () => {
    const layout = layoutTitleScreen(VIEWPORT, 'desktop');
    expect(layout.buttons.map((b) => b.id)).toEqual(['desktop', 'touch']);
    for (const button of layout.buttons) {
      expect(hitTestTitle(layout, { x: button.x + button.w / 2, y: button.y + button.h / 2 })).toBe(button.id);
    }
    expect(hitTestTitle(layout, { x: 2, y: 2 })).toBeNull();
  });

  it('stacks the buttons on a narrow phone screen so both stay on screen', () => {
    const narrow = { w: 260, h: 560 };
    const layout = layoutTitleScreen(narrow, 'touch');
    for (const button of layout.buttons) {
      expect(button.x).toBeGreaterThanOrEqual(0);
      expect(button.x + button.w).toBeLessThanOrEqual(narrow.w);
    }
    expect(layout.buttons[0]?.y).toBeLessThan(layout.buttons[1]?.y ?? 0);
  });

  it('draws the labels and the touch hint when touch is selected', () => {
    const rec = recordingCtx();
    drawTitleScreen(rec.ctx, VIEWPORT, layoutTitleScreen(VIEWPORT, 'touch'));
    expect(rec.texts).toContain('Computer');
    expect(rec.texts).toContain('Phone / Tablet');
    expect(rec.texts).toContain('Tap a device to start');
  });

  it('points the end screen at the Play again button in touch mode', () => {
    const rec = recordingCtx();
    drawEndScreen(rec.ctx, VIEWPORT, { winner: 'Reds', color: '#e05a4d', touch: true });
    expect(rec.texts).toContain('Tap Play again for a new match');
  });
});
