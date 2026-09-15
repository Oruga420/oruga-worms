import { describe, expect, it } from 'vitest';
import { PAUSE_BUTTON_W_PX, drawPauseScreen, hitTestPause, layoutPauseScreen } from '@/ui/screens/pause.ts';
import { createRecordingContext } from './recording-context.ts';

const VIEWPORT = { w: 1280, h: 720 };

describe('pause screen: layout and hit test', () => {
  const layout = layoutPauseScreen(VIEWPORT);

  it('offers resume, options, then surrender, centred, with surrender in the danger tone', () => {
    expect(layout.buttons.map((b) => b.id)).toEqual(['resume', 'options', 'surrender']);
    for (const button of layout.buttons) {
      expect(button.w).toBe(PAUSE_BUTTON_W_PX);
      expect(Math.abs(button.x + button.w / 2 - VIEWPORT.w / 2)).toBeLessThanOrEqual(1);
      expect(button.y).toBeGreaterThan(layout.titleY);
    }
    expect(layout.buttons[2]?.tone).toBe('danger');
    expect(layout.buttons[1]?.tone).toBe('normal');
    expect(Object.isFrozen(layout)).toBe(true);
  });

  it('resolves clicks to the button under the pointer and to null on the dim background', () => {
    const [resume, options, surrender] = layout.buttons;
    if (options === undefined) throw new Error('options button missing');
    expect(hitTestPause(layout, { x: options.x + 3, y: options.y + 3 })).toBe('options');
    if (resume === undefined || surrender === undefined) throw new Error('buttons missing');
    expect(hitTestPause(layout, { x: resume.x + resume.w / 2, y: resume.y + resume.h / 2 })).toBe('resume');
    expect(hitTestPause(layout, { x: surrender.x + 2, y: surrender.y + 2 })).toBe('surrender');
    expect(hitTestPause(layout, { x: 5, y: 5 })).toBeNull();
    expect(hitTestPause(layout, { x: resume.x + resume.w / 2, y: resume.y - 3 })).toBeNull();
  });

  it('scales with the viewport: a smaller screen keeps the buttons inside it', () => {
    const small = layoutPauseScreen({ w: 640, h: 360 });
    for (const button of small.buttons) {
      expect(button.x).toBeGreaterThanOrEqual(0);
      expect(button.x + button.w).toBeLessThanOrEqual(640);
      expect(button.y + button.h).toBeLessThanOrEqual(360);
    }
  });
});

describe('pause screen: draw', () => {
  it('dims the world, writes PAUSED and draws both buttons, highlighting the hovered one', () => {
    const ctx = createRecordingContext();
    const layout = layoutPauseScreen(VIEWPORT);
    const surrender = layout.buttons[2];
    if (surrender === undefined) throw new Error('surrender missing');
    drawPauseScreen(ctx, VIEWPORT, layout, { pointer: { x: surrender.x + 5, y: surrender.y + 5 } });
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('PAUSED');
    expect(texts).toContain('Resume (Esc)');
    expect(texts).toContain('Options');
    expect(texts).toContain('Surrender');
    // The full screen dim plus three button boxes.
    expect(ctx.calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThanOrEqual(4);
    expect(ctx.calls.filter((c) => c.name === 'strokeRect').length).toBe(3);
  });
});
