/**
 * Text drawing helper (architecture.md, ui/widgets/text.ts) shared by the screens and overlays.
 * Pure over the Ctx2D interface so every screen stays unit testable with a recording fake; the
 * caller sets the fill colour, this sets font, alignment and baseline.
 */

import type { Ctx2D } from '../../engine/canvas-types.ts';

export const UI_FONT = 'system-ui, sans-serif';

/** Centres one line of text horizontally on cx, vertically on y, at fontPx with the given weight. */
export function centerText(ctx: Ctx2D, text: string, cx: number, y: number, fontPx: number, weight = '700'): void {
  ctx.font = `${weight} ${fontPx}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y);
}

/** Left aligned single line, vertically centred on y. */
export function leftText(ctx: Ctx2D, text: string, x: number, y: number, fontPx: number, weight = '500'): void {
  ctx.font = `${weight} ${fontPx}px ${UI_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
