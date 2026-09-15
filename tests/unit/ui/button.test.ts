import { describe, expect, it } from 'vitest';
import { BUTTON_GAP_PX, BUTTON_H_PX, drawButton, hitTestButtons, insideButton, stackButtons } from '@/ui/widgets/button.ts';
import { createRecordingContext } from './recording-context.ts';

describe('button widget: layout', () => {
  const buttons = stackButtons([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', tone: 'danger' }] as const, 400, 100, 200);

  it('stacks equal width buttons centred on cx with a fixed gap', () => {
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ id: 'a', x: 300, y: 100, w: 200, h: BUTTON_H_PX, tone: 'normal' });
    expect(buttons[1]).toMatchObject({ id: 'b', x: 300, y: 100 + BUTTON_H_PX + BUTTON_GAP_PX, w: 200, h: BUTTON_H_PX, tone: 'danger' });
    expect(Object.isFrozen(buttons)).toBe(true);
    expect(Object.isFrozen(buttons[0])).toBe(true);
  });

  it('hit tests inclusive at the origin and exclusive at the far edge, null in the gap', () => {
    const [a, b] = buttons;
    if (a === undefined || b === undefined) throw new Error('buttons missing');
    expect(insideButton(a, { x: a.x, y: a.y })).toBe(true);
    expect(insideButton(a, { x: a.x + a.w, y: a.y })).toBe(false);
    expect(hitTestButtons(buttons, { x: 400, y: a.y + 10 })).toBe('a');
    expect(hitTestButtons(buttons, { x: 400, y: b.y + 10 })).toBe('b');
    expect(hitTestButtons(buttons, { x: 400, y: a.y + a.h + 2 })).toBeNull();
    expect(hitTestButtons(buttons, { x: 10, y: a.y + 10 })).toBeNull();
  });
});

describe('button widget: draw', () => {
  it('paints the box, the outline and the centred label without throwing', () => {
    const ctx = createRecordingContext();
    const [button] = stackButtons([{ id: 'go', label: 'Go' }] as const, 100, 20, 120);
    if (button === undefined) throw new Error('button missing');
    drawButton(ctx, button, true);
    const calls = ctx.calls.map((c) => c.name);
    expect(calls).toContain('fillRect');
    expect(calls).toContain('strokeRect');
    expect(calls).toContain('fillText');
    const text = ctx.calls.find((c) => c.name === 'fillText');
    expect(text?.args[0]).toBe('Go');
  });
});
