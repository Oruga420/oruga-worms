import { describe, expect, it } from 'vitest';
import { comicPanel, drawComicBackdrop, drawComicLabel } from '@/game/comic.ts';
import { drawTitleScreen, layoutTitleScreen } from '@/game/screens.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

// Responsive comic framing must not hide the title's real device controls.
describe('comic presentation', () => {
  it.each([{ w: 320, h: 568 }, { w: 844, h: 390 }, { w: 1440, h: 900 }])('keeps the panel within a $w by $h viewport', (viewport) => {
    const panel = comicPanel(viewport);
    expect(panel.x).toBeGreaterThanOrEqual(16);
    expect(panel.y).toBeGreaterThanOrEqual(16);
    expect(panel.x + panel.w).toBeLessThanOrEqual(viewport.w - 16);
    expect(panel.y + panel.h).toBeLessThanOrEqual(viewport.h - 16);
  });

  it('paints ink framing, a paper panel and bounded halftone without changing game state', () => {
    const ctx = createRecordingContext();
    drawComicBackdrop(ctx, { w: 1440, h: 900 }, 'ISSUE 01 / ARTILLERY CLUB');
    expect(ctx.calls.filter((call) => call.name === 'fillRect').length).toBeGreaterThan(20);
    expect(ctx.calls.length).toBeLessThan(700);
    expect(ctx.calls.some((call) => call.name === 'fillText' && call.args[0] === 'ISSUE 01 / ARTILLERY CLUB')).toBe(true);
    expect(ctx.calls.at(-1)?.name).toBe('restore');
  });

  it('bounds comic text to its supplied label width', () => {
    const ctx = createRecordingContext();
    drawComicLabel(ctx, 'ROOM / 99%', 160, 100, 180, 32, '#ffd166');
    const text = ctx.calls.find((call) => call.name === 'fillText');
    expect(text?.args).toEqual(['ROOM / 99%', 160, 100, 164]);
  });

  it('retains both device buttons and renders the comic edition label', () => {
    const ctx = createRecordingContext();
    const viewport = { w: 320, h: 568 };
    const layout = layoutTitleScreen(viewport, 'touch');
    drawTitleScreen(ctx, viewport, layout);
    const texts = ctx.calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('ORUGAS');
    expect(texts).toContain('ISSUE 01 / ARTILLERY CLUB');
    expect(texts).toContain('Computer');
    expect(texts).toContain('Phone / Tablet');
    expect(texts).toContain('Tap a device to start');
    for (const button of layout.buttons) expect(button.y + button.h).toBeLessThan(viewport.h);
  });
});
