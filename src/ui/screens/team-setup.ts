/**
 * Team setup screen (architecture.md, ui/screens/team-setup.ts): team count (2 to 4), a name per
 * team from a preset list, the team colour by index, human or CPU, and the CPU difficulty. Pure:
 * the state is an immutable value updated by reduceTeamSetup, the layout owns every rectangle,
 * the hit test returns a typed action, and toMatchSetup turns the state into the MatchSetup that
 * buildGame consumes. Text entry on a canvas is deliberately avoided: names cycle through presets.
 */

import type { CpuDifficulty } from '../../ai/contract.ts';
import type { Ctx2D, Size } from '../../engine/canvas-types.ts';
import type { MatchSetup, TeamSetup } from '../../match/setup.ts';
import type { TeamColorIndex, TeamController } from '../../match/state.ts';
import { BUTTON_H_PX, drawButton, hitTestButtons, type ButtonRect, type ScreenPoint } from '../widgets/button.ts';
import { centerText, leftText } from '../widgets/text.ts';

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const WORMS_PER_TEAM = 3;

/** Preset team names, cycled by clicking the name cell; 16 characters at most (setup validation). */
export const TEAM_NAME_PRESETS: readonly string[] = Object.freeze(['Reds', 'Blues', 'Greens', 'Golds', 'Orugas', 'Larvas', 'Capullos', 'Polillas']);

/** Worm names per team, three per team; the fourth set is reused when a name list runs out. */
const WORM_NAMES: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['Rojo', 'Rita', 'Rex']),
  Object.freeze(['Azul', 'Ana', 'Ash']),
  Object.freeze(['Verde', 'Vera', 'Vic']),
  Object.freeze(['Oro', 'Olga', 'Otto']),
]);

export const DIFFICULTIES: readonly CpuDifficulty[] = Object.freeze(['easy', 'normal', 'hard']);

export interface TeamSlot {
  readonly nameIndex: number;
  readonly controller: TeamController;
  readonly difficulty: CpuDifficulty;
}

export interface TeamSetupState {
  readonly teams: readonly TeamSlot[];
}

export const DEFAULT_TEAM_SETUP: TeamSetupState = Object.freeze({
  teams: Object.freeze([
    Object.freeze({ nameIndex: 0, controller: 'human' as const, difficulty: 'normal' as const }),
    Object.freeze({ nameIndex: 1, controller: 'cpu' as const, difficulty: 'normal' as const }),
  ]),
});

export type TeamSetupAction =
  | { readonly kind: 'cycleName'; readonly team: number }
  | { readonly kind: 'toggleController'; readonly team: number }
  | { readonly kind: 'cycleDifficulty'; readonly team: number }
  | { readonly kind: 'addTeam' }
  | { readonly kind: 'removeTeam' }
  | { readonly kind: 'start' };

/** Pure update; every branch returns a new frozen state and the input is never mutated. */
export function reduceTeamSetup(state: TeamSetupState, action: TeamSetupAction): TeamSetupState {
  const teams = [...state.teams];
  switch (action.kind) {
    case 'cycleName': {
      const slot = teams[action.team];
      if (slot === undefined) return state;
      // Skip presets another team already uses so two teams never share a name.
      const taken = new Set(teams.filter((_, i) => i !== action.team).map((t) => t.nameIndex));
      let next = slot.nameIndex;
      for (let step = 1; step <= TEAM_NAME_PRESETS.length; step += 1) {
        const candidate = (slot.nameIndex + step) % TEAM_NAME_PRESETS.length;
        if (!taken.has(candidate)) {
          next = candidate;
          break;
        }
      }
      teams[action.team] = Object.freeze({ ...slot, nameIndex: next });
      break;
    }
    case 'toggleController': {
      const slot = teams[action.team];
      if (slot === undefined) return state;
      teams[action.team] = Object.freeze({ ...slot, controller: slot.controller === 'human' ? 'cpu' : 'human' });
      break;
    }
    case 'cycleDifficulty': {
      const slot = teams[action.team];
      if (slot === undefined || slot.controller !== 'cpu') return state;
      const index = DIFFICULTIES.indexOf(slot.difficulty);
      teams[action.team] = Object.freeze({ ...slot, difficulty: DIFFICULTIES[(index + 1) % DIFFICULTIES.length] ?? 'normal' });
      break;
    }
    case 'addTeam': {
      if (teams.length >= MAX_TEAMS) return state;
      const taken = new Set(teams.map((t) => t.nameIndex));
      const nameIndex = TEAM_NAME_PRESETS.findIndex((_, i) => !taken.has(i));
      teams.push(Object.freeze({ nameIndex: nameIndex === -1 ? teams.length : nameIndex, controller: 'cpu', difficulty: 'normal' }));
      break;
    }
    case 'removeTeam': {
      if (teams.length <= MIN_TEAMS) return state;
      teams.pop();
      break;
    }
    case 'start':
      return state;
  }
  return Object.freeze({ teams: Object.freeze(teams) });
}

/** The MatchSetup buildGame consumes: colours follow the slot index, worms three per team. */
export function toMatchSetup(state: TeamSetupState, seed: number, worldSize: Size): MatchSetup {
  const teams: TeamSetup[] = state.teams.map((slot, index) => {
    const names = WORM_NAMES[index] ?? WORM_NAMES[WORM_NAMES.length - 1] ?? ['A', 'B', 'C'];
    const base: TeamSetup = {
      name: TEAM_NAME_PRESETS[slot.nameIndex] ?? `Team ${index + 1}`,
      colorIndex: index as TeamColorIndex,
      controller: slot.controller,
      wormNames: names.slice(0, WORMS_PER_TEAM),
    };
    return slot.controller === 'cpu' ? { ...base, cpu: { difficulty: slot.difficulty, personality: 'aggressive' } } : base;
  });
  return { seed, teams, worldSize, waterY: worldSize.h - 24, startingTeamIndex: 0 };
}

export type TeamSetupCellKind = 'name' | 'controller' | 'difficulty' | 'add' | 'remove' | 'start';

export interface TeamSetupCell {
  /** "team:0:name", "team:1:controller", "team:1:difficulty", "add", "remove", "start". */
  readonly id: string;
  readonly kind: TeamSetupCellKind;
  readonly team?: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TeamSetupLayout {
  readonly card: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly cells: readonly TeamSetupCell[];
  readonly buttons: readonly ButtonRect<'add' | 'remove' | 'start'>[];
}

const CARD_W = 640;
const PAD = 24;
const ROW_H = 44;
const ROW_GAP = 10;

export function layoutTeamSetup(viewport: Size, state: TeamSetupState): TeamSetupLayout {
  const rows = state.teams.length;
  const cardH = PAD + 44 + rows * (ROW_H + ROW_GAP) + 16 + BUTTON_H_PX + PAD;
  const x0 = Math.round((viewport.w - CARD_W) / 2);
  const y0 = Math.round((viewport.h - cardH) / 2);
  const cells: TeamSetupCell[] = [];
  const rowsTop = y0 + PAD + 44;
  state.teams.forEach((slot, index) => {
    const y = rowsTop + index * (ROW_H + ROW_GAP);
    const nameX = x0 + PAD + 36;
    cells.push(Object.freeze({ id: `team:${index}:name`, kind: 'name', team: index, x: nameX, y, w: 180, h: ROW_H }));
    cells.push(Object.freeze({ id: `team:${index}:controller`, kind: 'controller', team: index, x: nameX + 192, y, w: 120, h: ROW_H }));
    if (slot.controller === 'cpu') {
      cells.push(Object.freeze({ id: `team:${index}:difficulty`, kind: 'difficulty', team: index, x: nameX + 324, y, w: 120, h: ROW_H }));
    }
  });
  const buttonY = rowsTop + rows * (ROW_H + ROW_GAP) + 16;
  const small = 140;
  const buttons: ButtonRect<'add' | 'remove' | 'start'>[] = [
    Object.freeze({ id: 'remove' as const, label: 'Fewer teams', x: x0 + PAD, y: buttonY, w: small, h: BUTTON_H_PX, tone: 'normal' as const }),
    Object.freeze({ id: 'add' as const, label: 'More teams', x: x0 + PAD + small + 12, y: buttonY, w: small, h: BUTTON_H_PX, tone: 'normal' as const }),
    Object.freeze({ id: 'start' as const, label: 'Start (Enter)', x: x0 + CARD_W - PAD - 200, y: buttonY, w: 200, h: BUTTON_H_PX, tone: 'danger' as const }),
  ];
  for (const button of buttons) cells.push(Object.freeze({ id: button.id, kind: button.id, x: button.x, y: button.y, w: button.w, h: button.h }));
  return Object.freeze({ card: Object.freeze({ x: x0, y: y0, w: CARD_W, h: cardH }), cells: Object.freeze(cells), buttons: Object.freeze(buttons) });
}

function inside(cell: TeamSetupCell, point: ScreenPoint): boolean {
  return point.x >= cell.x && point.x < cell.x + cell.w && point.y >= cell.y && point.y < cell.y + cell.h;
}

export function hitTestTeamSetup(layout: TeamSetupLayout, point: ScreenPoint): TeamSetupAction | null {
  const button = hitTestButtons(layout.buttons, point);
  if (button === 'add') return { kind: 'addTeam' };
  if (button === 'remove') return { kind: 'removeTeam' };
  if (button === 'start') return { kind: 'start' };
  for (const cell of layout.cells) {
    if (cell.team === undefined || !inside(cell, point)) continue;
    if (cell.kind === 'name') return { kind: 'cycleName', team: cell.team };
    if (cell.kind === 'controller') return { kind: 'toggleController', team: cell.team };
    if (cell.kind === 'difficulty') return { kind: 'cycleDifficulty', team: cell.team };
  }
  return null;
}

export function drawTeamSetup(ctx: Ctx2D, viewport: Size, layout: TeamSetupLayout, state: TeamSetupState, colorOf: (index: number) => string): void {
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
  ctx.fillStyle = '#ffd166';
  centerText(ctx, 'TEAMS', viewport.w / 2, card.y + PAD + 14, 28);

  state.teams.forEach((slot, index) => {
    const name = layout.cells.find((c) => c.id === `team:${index}:name`);
    const controller = layout.cells.find((c) => c.id === `team:${index}:controller`);
    const difficulty = layout.cells.find((c) => c.id === `team:${index}:difficulty`);
    if (name === undefined || controller === undefined) return;
    // Colour swatch, then the three clickable cells drawn as soft boxes.
    ctx.fillStyle = colorOf(index);
    ctx.fillRect(card.x + PAD, name.y + 10, 24, 24);
    for (const cell of [name, controller, difficulty]) {
      if (cell === undefined) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
    ctx.fillStyle = '#ffffff';
    leftText(ctx, TEAM_NAME_PRESETS[slot.nameIndex] ?? `Team ${index + 1}`, name.x + 12, name.y + ROW_H / 2, 18, '700');
    ctx.fillStyle = slot.controller === 'human' ? '#7fd1ff' : '#ffd36a';
    centerText(ctx, slot.controller === 'human' ? 'Human' : 'CPU', controller.x + controller.w / 2, controller.y + ROW_H / 2, 15, '600');
    if (difficulty !== undefined) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      centerText(ctx, slot.difficulty, difficulty.x + difficulty.w / 2, difficulty.y + ROW_H / 2, 15, '600');
    }
  });

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const hintY = (layout.buttons[0]?.y ?? card.y + card.h) - 12;
  centerText(ctx, 'Click a name to change it, Human or CPU to switch, the difficulty to cycle it', viewport.w / 2, hintY, 12, '400');
  for (const button of layout.buttons) drawButton(ctx, button);
  ctx.restore();
}
