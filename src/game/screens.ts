/**
 * Full screen overlays drawn on the HUD layer (Phase 3): the end screen shown when the match is
 * decided. Pure over the Ctx2D interface so it is unit tested with a recording fake; main.ts owns
 * when to call it and the restart key.
 */

import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { drawScoreboard, type ScoreRow } from '../ui/screens/end-screen.ts';
import { centerText } from '../ui/widgets/text.ts';

export function drawTitleScreen(ctx: Ctx2D, viewport: Size): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.5)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  const cx = viewport.w / 2;
  const cy = viewport.h / 2;

  ctx.fillStyle = '#ffd166';
  centerText(ctx, 'ORUGAS', cx, cy - 58, 68, '800');
  ctx.fillStyle = '#e8e8e8';
  centerText(ctx, 'a turn-based artillery game', cx, cy - 6, 20, '500');
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  centerText(ctx, 'Arrows move, Up and Down aim, hold Space to charge and fire', cx, cy + 34, 14, '400');
  ctx.fillStyle = '#ffffff';
  centerText(ctx, 'Press Enter or click to start', cx, cy + 74, 18, '600');
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
  centerText(ctx, 'Press R to play again', cx, hintY, 16, '500');
  ctx.restore();
}
