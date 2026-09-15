/**
 * Options screen (architecture.md, ui/screens/options.ts): the five audio bus levels as sliders
 * with step buttons, every key binding with click to rebind, Reset and Back. Reached from the
 * pause overlay and frozen like it. Pure: the layout owns every rectangle (the cells array is the
 * single source for drawing and for the hit test), the hit test returns a typed action, and
 * main.ts applies it to the settings, the mixer and the input.
 *
 * Graphics toggles from the plan are left out on purpose: the DPR ladder is automatic and the
 * frame overlay already has its F3 key.
 */

import { ACTIONS, MOVEMENT_ACTIONS, SLOT_ACTIONS, FUSE_ACTIONS, META_ACTIONS, bareKeyCode, SHIFT_PREFIX, type Action, type Keybinds } from '../../config/keybinds.ts';
import type { Ctx2D, Size } from '../../engine/canvas-types.ts';
import { AUDIO_TARGETS, type AudioLevels, type AudioTarget } from '../../persistence/save-schema.ts';
import { BUTTON_H_PX, drawButton, type ButtonRect, type ScreenPoint } from '../widgets/button.ts';
import { centerText, leftText } from '../widgets/text.ts';

export type OptionsAction =
  | { readonly kind: 'volume'; readonly target: AudioTarget; readonly level: number }
  | { readonly kind: 'volumeStep'; readonly target: AudioTarget; readonly delta: number }
  | { readonly kind: 'rebind'; readonly action: Action }
  | { readonly kind: 'reset' }
  | { readonly kind: 'back' };

export interface OptionsModel {
  readonly audio: AudioLevels;
  readonly keybinds: Keybinds;
  /** The action waiting for its new key, or null. */
  readonly listening: Action | null;
  /** A one line message (a rejected duplicate, a saved confirmation), or null. */
  readonly notice: string | null;
}

export type OptionsCellKind = 'bar' | 'minus' | 'plus' | 'key' | 'reset' | 'back';

export interface OptionsCell {
  /** Stable id for tests: "vol:music:bar", "vol:music:minus", "key:fire", "reset", "back". */
  readonly id: string;
  readonly kind: OptionsCellKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly target?: AudioTarget;
  readonly action?: Action;
}

export interface OptionsLayout {
  readonly card: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly cells: readonly OptionsCell[];
  readonly buttons: readonly ButtonRect<'reset' | 'back'>[];
}

export const VOLUME_STEP = 0.1;
const CARD_W = 760;
const PAD = 24;
const VOLUME_ROW_H = 34;
const KEY_ROW_H = 22;
const KEY_COLUMNS = 2;
const BAR_W = 300;
const BAR_H = 14;
const STEP_W = 28;
const STEP_H = 24;

export const ACTION_LABELS: Readonly<Record<Action, string>> = Object.freeze({
  moveLeft: 'Move left',
  moveRight: 'Move right',
  jump: 'Jump',
  backflip: 'Backflip',
  aimUp: 'Aim up',
  aimDown: 'Aim down',
  fire: 'Fire (hold to charge)',
  weaponPanel: 'Weapon panel',
  pause: 'Pause',
  slot1: 'Weapon slot 1',
  slot2: 'Weapon slot 2',
  slot3: 'Weapon slot 3',
  slot4: 'Weapon slot 4',
  slot5: 'Weapon slot 5',
  slot6: 'Weapon slot 6',
  slot7: 'Weapon slot 7',
  slot8: 'Weapon slot 8',
  slot9: 'Weapon slot 9',
  fuse1: 'Fuse 1 s',
  fuse2: 'Fuse 2 s',
  fuse3: 'Fuse 3 s',
  fuse4: 'Fuse 4 s',
  fuse5: 'Fuse 5 s',
});

export const AUDIO_LABELS: Readonly<Record<AudioTarget, string>> = Object.freeze({
  master: 'Master',
  sfx: 'Effects',
  voice: 'Voices',
  music: 'Music',
  ui: 'Interface',
});

/** Display order: movement, meta, slots, fuses. */
export const KEY_ROW_ORDER: readonly Action[] = Object.freeze([...MOVEMENT_ACTIONS, ...META_ACTIONS, ...SLOT_ACTIONS, ...FUSE_ACTIONS]);

/** "KeyA" to "A", "ArrowLeft" to "Left", "Digit3" to "3", "Shift+KeyQ" to "Shift+Q". */
export function prettyKey(code: string): string {
  const shifted = code.startsWith(SHIFT_PREFIX);
  const bare = bareKeyCode(code).replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
  return shifted ? `Shift+${bare}` : bare;
}

/** The geometry depends on the viewport only; the model is read at draw and hit test time. */
export function layoutOptionsScreen(viewport: Size): OptionsLayout {
  const keyRows = Math.ceil(KEY_ROW_ORDER.length / KEY_COLUMNS);
  const cardH = PAD + 40 + AUDIO_TARGETS.length * VOLUME_ROW_H + 36 + keyRows * KEY_ROW_H + 24 + BUTTON_H_PX + PAD;
  const x0 = Math.round((viewport.w - CARD_W) / 2);
  const y0 = Math.round((viewport.h - cardH) / 2);
  const cells: OptionsCell[] = [];

  // Volume rows: label, minus, bar, plus, value.
  const volumeTop = y0 + PAD + 40;
  AUDIO_TARGETS.forEach((target, index) => {
    const rowY = volumeTop + index * VOLUME_ROW_H;
    const minusX = x0 + PAD + 120;
    const barX = minusX + STEP_W + 10;
    const plusX = barX + BAR_W + 10;
    cells.push(Object.freeze({ id: `vol:${target}:minus`, kind: 'minus', x: minusX, y: rowY, w: STEP_W, h: STEP_H, target }));
    cells.push(Object.freeze({ id: `vol:${target}:bar`, kind: 'bar', x: barX, y: rowY + (STEP_H - BAR_H) / 2, w: BAR_W, h: BAR_H, target }));
    cells.push(Object.freeze({ id: `vol:${target}:plus`, kind: 'plus', x: plusX, y: rowY, w: STEP_W, h: STEP_H, target }));
  });

  // Key rows in two columns.
  const keysTop = volumeTop + AUDIO_TARGETS.length * VOLUME_ROW_H + 36;
  const columnW = (CARD_W - PAD * 2) / KEY_COLUMNS;
  KEY_ROW_ORDER.forEach((action, index) => {
    const column = Math.floor(index / keyRows);
    const row = index % keyRows;
    cells.push(
      Object.freeze({
        id: `key:${action}`,
        kind: 'key',
        x: x0 + PAD + column * columnW,
        y: keysTop + row * KEY_ROW_H,
        w: columnW - 12,
        h: KEY_ROW_H,
        action,
      }),
    );
  });

  // Buttons: Reset on the left, Back on the right.
  const buttonY = keysTop + keyRows * KEY_ROW_H + 24;
  const buttonW = 180;
  const buttons: ButtonRect<'reset' | 'back'>[] = [
    Object.freeze({ id: 'reset' as const, label: 'Reset to defaults', x: x0 + PAD, y: buttonY, w: buttonW, h: BUTTON_H_PX, tone: 'danger' as const }),
    Object.freeze({ id: 'back' as const, label: 'Back (Esc)', x: x0 + CARD_W - PAD - buttonW, y: buttonY, w: buttonW, h: BUTTON_H_PX, tone: 'normal' as const }),
  ];
  for (const button of buttons) cells.push(Object.freeze({ id: button.id, kind: button.id, x: button.x, y: button.y, w: button.w, h: button.h }));

  return Object.freeze({ card: Object.freeze({ x: x0, y: y0, w: CARD_W, h: cardH }), cells: Object.freeze(cells), buttons: Object.freeze(buttons) });
}

function inside(cell: OptionsCell, point: ScreenPoint): boolean {
  return point.x >= cell.x && point.x < cell.x + cell.w && point.y >= cell.y && point.y < cell.y + cell.h;
}

/** Levels snap to twentieths so a click on the bar lands on a round percent. */
export function levelFromBar(cell: OptionsCell, point: ScreenPoint): number {
  const raw = (point.x - cell.x) / cell.w;
  return Math.round(Math.min(1, Math.max(0, raw)) * 20) / 20;
}

export function hitTestOptions(layout: OptionsLayout, point: ScreenPoint): OptionsAction | null {
  for (const cell of layout.cells) {
    if (!inside(cell, point)) continue;
    switch (cell.kind) {
      case 'bar':
        return cell.target === undefined ? null : { kind: 'volume', target: cell.target, level: levelFromBar(cell, point) };
      case 'minus':
        return cell.target === undefined ? null : { kind: 'volumeStep', target: cell.target, delta: -VOLUME_STEP };
      case 'plus':
        return cell.target === undefined ? null : { kind: 'volumeStep', target: cell.target, delta: VOLUME_STEP };
      case 'key':
        return cell.action === undefined ? null : { kind: 'rebind', action: cell.action };
      case 'reset':
        return { kind: 'reset' };
      case 'back':
        return { kind: 'back' };
    }
  }
  return null;
}

export function drawOptionsScreen(ctx: Ctx2D, viewport: Size, layout: OptionsLayout, model: OptionsModel): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8, 14, 22, 0.62)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  const { card } = layout;
  ctx.fillStyle = 'rgba(12, 16, 24, 0.92)';
  ctx.fillRect(card.x, card.y, card.w, card.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(card.x + 0.5, card.y + 0.5, card.w - 1, card.h - 1);

  ctx.fillStyle = '#f4f4f4';
  centerText(ctx, 'OPTIONS', viewport.w / 2, card.y + PAD + 12, 26);

  // Volumes.
  for (const target of AUDIO_TARGETS) {
    const bar = layout.cells.find((c) => c.id === `vol:${target}:bar`);
    const minus = layout.cells.find((c) => c.id === `vol:${target}:minus`);
    const plus = layout.cells.find((c) => c.id === `vol:${target}:plus`);
    if (bar === undefined || minus === undefined || plus === undefined) continue;
    const level = model.audio[target];
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    leftText(ctx, AUDIO_LABELS[target], card.x + PAD, minus.y + STEP_H / 2, 14);
    for (const step of [minus, plus]) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(step.x, step.y, step.w, step.h);
      ctx.fillStyle = '#ffffff';
      centerText(ctx, step.kind === 'minus' ? '-' : '+', step.x + step.w / 2, step.y + step.h / 2, 16, '700');
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = '#ffd36a';
    ctx.fillRect(bar.x, bar.y, Math.round(bar.w * level), bar.h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    leftText(ctx, `${Math.round(level * 100)}%`, plus.x + plus.w + 12, minus.y + STEP_H / 2, 14);
  }

  // Key bindings.
  const firstKey = layout.cells.find((c) => c.kind === 'key');
  if (firstKey !== undefined) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    leftText(ctx, 'Key bindings: click a row, then press the new key (Esc cancels). A key already in use is refused.', card.x + PAD, firstKey.y - 18, 12, '400');
  }
  for (const cell of layout.cells) {
    if (cell.kind !== 'key' || cell.action === undefined) continue;
    const listening = model.listening === cell.action;
    if (listening) {
      ctx.fillStyle = 'rgba(255, 211, 106, 0.25)';
      ctx.fillRect(cell.x - 4, cell.y, cell.w + 8, cell.h);
    }
    ctx.fillStyle = listening ? '#ffd36a' : 'rgba(255,255,255,0.85)';
    leftText(ctx, ACTION_LABELS[cell.action], cell.x, cell.y + cell.h / 2, 13);
    ctx.fillStyle = listening ? '#ffd36a' : '#ffffff';
    const keys = listening ? 'press a key...' : model.keybinds[cell.action].map(prettyKey).join(' / ');
    leftText(ctx, keys, cell.x + 190, cell.y + cell.h / 2, 13, '600');
  }

  for (const button of layout.buttons) drawButton(ctx, button);

  if (model.notice !== null) {
    ctx.fillStyle = '#ff9f43';
    centerText(ctx, model.notice, viewport.w / 2, layout.buttons[0] === undefined ? card.y + card.h - PAD : layout.buttons[0].y - 14, 13, '600');
  }
  ctx.restore();
}

/** Every action has a label and a display row; a test pins this so a new Action cannot be forgotten. */
export function actionsCovered(): boolean {
  return ACTIONS.every((action) => action in ACTION_LABELS) && KEY_ROW_ORDER.length === ACTIONS.length;
}
