/**
 * Button widget (architecture.md, ui/widgets/button.ts): a labelled rectangle in screen px with a
 * pure hit test and a draw routine. A screen builds its buttons in a layout function, draws them
 * from that same layout and resolves clicks against it, so what the player sees and what a click
 * selects can never drift apart (the rule the weapon panel set in run #35).
 */

import type { Ctx2D } from '../../engine/canvas-types.ts';
import { centerText } from './text.ts';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ButtonRect<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Accent buttons (a destructive or primary action) draw with the danger palette. */
  readonly tone: 'normal' | 'danger';
}

export const BUTTON_H_PX = 44;
export const BUTTON_GAP_PX = 14;

export function insideButton(button: ButtonRect, point: ScreenPoint): boolean {
  return point.x >= button.x && point.x < button.x + button.w && point.y >= button.y && point.y < button.y + button.h;
}

/** The id of the button under the point, or null. */
export function hitTestButtons<Id extends string>(buttons: readonly ButtonRect<Id>[], point: ScreenPoint): Id | null {
  for (const button of buttons) if (insideButton(button, point)) return button.id;
  return null;
}

/**
 * Lays out a vertical stack of equal width buttons centred on cx, the first one starting at top.
 * Returns frozen rects; the ids and labels come from the caller in display order.
 */
export function stackButtons<Id extends string>(
  items: readonly { readonly id: Id; readonly label: string; readonly tone?: 'normal' | 'danger' }[],
  cx: number,
  top: number,
  w: number,
): readonly ButtonRect<Id>[] {
  return Object.freeze(
    items.map((item, index) =>
      Object.freeze({
        id: item.id,
        label: item.label,
        x: Math.round(cx - w / 2),
        y: Math.round(top + index * (BUTTON_H_PX + BUTTON_GAP_PX)),
        w,
        h: BUTTON_H_PX,
        tone: item.tone ?? 'normal',
      }),
    ),
  );
}

export function drawButton(ctx: Ctx2D, button: ButtonRect, hovered = false): void {
  const danger = button.tone === 'danger';
  ctx.fillStyle = danger ? (hovered ? 'rgba(224, 90, 77, 0.95)' : 'rgba(224, 90, 77, 0.8)') : hovered ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(button.x, button.y, button.w, button.h);
  ctx.strokeStyle = danger ? 'rgba(255, 210, 200, 0.9)' : 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(button.x + 0.75, button.y + 0.75, button.w - 1.5, button.h - 1.5);
  ctx.fillStyle = '#ffffff';
  centerText(ctx, button.label, button.x + button.w / 2, button.y + button.h / 2, 18, '600');
}
