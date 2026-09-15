/**
 * Pause overlay with surrender (architecture.md, ui/screens/pause.ts). Escape or P freezes the
 * match (main.ts stops ticking the controller while paused, so the turn timer and the sim hold),
 * dims the world and offers two buttons: resume, and surrender, which hands the match to the
 * other team through the reducer's Surrender event. Pure: layout owns every rectangle, the draw
 * reads the layout, the hit test resolves clicks against it.
 */

import type { Ctx2D, Size } from '../../engine/canvas-types.ts';
import { drawButton, hitTestButtons, stackButtons, type ButtonRect, type ScreenPoint } from '../widgets/button.ts';
import { centerText } from '../widgets/text.ts';

export type PauseAction = 'resume' | 'options' | 'surrender';

export interface PauseLayout {
  readonly buttons: readonly ButtonRect<PauseAction>[];
  /** Where the title sits; the buttons hang below it. */
  readonly titleY: number;
}

export const PAUSE_BUTTON_W_PX = 240;

export function layoutPauseScreen(viewport: Size): PauseLayout {
  const cx = viewport.w / 2;
  const titleY = viewport.h / 2 - 70;
  const buttons = stackButtons<PauseAction>(
    [
      { id: 'resume', label: 'Resume (Esc)' },
      { id: 'options', label: 'Options' },
      { id: 'surrender', label: 'Surrender', tone: 'danger' },
    ],
    cx,
    titleY + 52,
    PAUSE_BUTTON_W_PX,
  );
  return Object.freeze({ buttons, titleY });
}

/** The action under the pointer, or null (clicking the dim background does nothing). */
export function hitTestPause(layout: PauseLayout, point: ScreenPoint): PauseAction | null {
  return hitTestButtons(layout.buttons, point);
}

export interface PauseModel {
  /** Pointer in screen px for the hover highlight, or null when unknown. */
  readonly pointer: ScreenPoint | null;
}

export function drawPauseScreen(ctx: Ctx2D, viewport: Size, layout: PauseLayout, model: PauseModel = { pointer: null }): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.62)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  ctx.fillStyle = '#f4f4f4';
  centerText(ctx, 'PAUSED', viewport.w / 2, layout.titleY, 44);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  centerText(ctx, 'The clock and the worms hold while this is up', viewport.w / 2, layout.titleY + 30, 14, '400');
  const hovered = model.pointer === null ? null : hitTestPause(layout, model.pointer);
  for (const button of layout.buttons) drawButton(ctx, button, hovered === button.id);
  ctx.restore();
}
