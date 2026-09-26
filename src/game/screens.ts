/**
 * Full screen overlays drawn on the HUD layer (Phase 3): the end screen shown when the match is
 * decided, and the title screen with its device choice. Pure over the Ctx2D interface so it is unit tested with a recording fake; main.ts owns
 * when to call it and the restart key.
 */

import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { drawScoreboard, type ScoreRow } from '../ui/screens/end-screen.ts';
import { centerText } from '../ui/widgets/text.ts';
import { BUTTON_GAP_PX, BUTTON_H_PX, drawButton, hitTestButtons, stackButtons, type ButtonRect, type ScreenPoint } from '../ui/widgets/button.ts';
import type { DeviceMode } from '../config/device.ts';

export type TitleButtonId = DeviceMode;

export interface TitleLayout {
  readonly buttons: readonly ButtonRect<TitleButtonId>[];
  readonly selected: DeviceMode;
}

const TITLE_BUTTON_W_PX = 200;

/** The two device buttons side by side under the tagline; narrow screens stack them. */
export function layoutTitleScreen(viewport: Size, selected: DeviceMode): TitleLayout {
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const items = [
    { id: 'desktop' as const, label: 'Computer' },
    { id: 'touch' as const, label: 'Phone / Tablet' },
  ];
  const w = Math.min(TITLE_BUTTON_W_PX, Math.floor((viewport.w - 48) / 2));
  const sideBySide = w >= 140;
  const buttons = sideBySide
    ? items.map((item, index) =>
        Object.freeze({
          id: item.id,
          label: item.label,
          x: Math.round(cx - w - BUTTON_GAP_PX / 2 + index * (w + BUTTON_GAP_PX)),
          y: Math.round(cy + 26),
          w,
          h: BUTTON_H_PX,
          tone: 'normal' as const,
        }),
      )
    : stackButtons(items, cx, cy + 26, Math.min(TITLE_BUTTON_W_PX, viewport.w - 32));
  return Object.freeze({ buttons: Object.freeze(buttons), selected });
}

/** The device button under the point, or null for anywhere else on the title. */
export function hitTestTitle(layout: TitleLayout, point: ScreenPoint): TitleButtonId | null {
  return hitTestButtons(layout.buttons, point);
}

export function drawTitleScreen(ctx: Ctx2D, viewport: Size, layout: TitleLayout = layoutTitleScreen(viewport, 'desktop')): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.5)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  const cx = viewport.w / 2;
  const cy = viewport.h / 2;

  ctx.fillStyle = '#ffd166';
  centerText(ctx, 'ORUGAS', cx, cy - 92, 68, '800');
  ctx.fillStyle = '#e8e8e8';
  centerText(ctx, 'a turn-based artillery game', cx, cy - 40, 20, '500');
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  centerText(ctx, 'Choose how you play', cx, cy + 4, 15, '500');
  for (const button of layout.buttons) {
    const selected = button.id === layout.selected;
    drawButton(ctx, button, selected);
    if (selected) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.strokeRect(button.x - 2, button.y - 2, button.w + 4, button.h + 4);
    }
  }
  const last = layout.buttons[layout.buttons.length - 1];
  const below = last === undefined ? cy + 80 : last.y + last.h + 28;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  centerText(
    ctx,
    layout.selected === 'touch' ? 'Buttons on screen walk, aim and fire' : 'Arrows move, Up and Down aim, hold Space to charge and fire',
    cx,
    below,
    14,
    '400',
  );
  ctx.fillStyle = '#ffffff';
  centerText(ctx, layout.selected === 'touch' ? 'Tap a device to start' : 'Press Enter or click to start', cx, below + 32, 18, '600');
  ctx.restore();
}

export interface EndScreenModel {
  /** The winning team's name, or null for a draw. */
  readonly winner: string | null;
  /** The winning team's colour, used for the name. */
  readonly color: string;
  /** Per team scoreboard rows (ui/screens/end-screen.ts); omitted, the screen shows the verdict only. */
  readonly rows?: readonly ScoreRow[];
  /** Team colour by colour index, needed to paint the rows. */
  readonly colorOf?: (colorIndex: number) => string;
  /** Touch mode points at the on screen Play again button instead of the R key. */
  readonly touch?: boolean;
}


export function drawEndScreen(ctx: Ctx2D, viewport: Size, model: EndScreenModel): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.62)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  const cx = viewport.w / 2;
  const cy = viewport.h / 2;

  ctx.fillStyle = '#f4f4f4';
  centerText(ctx, model.winner === null ? 'DRAW' : 'VICTORY', cx, cy - 46, 52);

  if (model.winner !== null) {
    ctx.fillStyle = model.color;
    centerText(ctx, `${model.winner} wins`, cx, cy + 8, 26);
  }

  // The per team breakdown sits under the verdict and pushes the restart hint below itself.
  let hintY = cy + 52;
  if (model.rows !== undefined && model.rows.length > 0 && model.colorOf !== undefined) {
    const bottom = drawScoreboard(ctx, viewport, model.rows, cy + 56, model.colorOf);
    hintY = bottom + 24;
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  centerText(ctx, model.touch === true ? 'Tap Play again for a new match' : 'Press R to play again', cx, hintY, 16, '500');
  ctx.restore();
}
