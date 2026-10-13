/**
 * Every click in the game as an order (WebMCP and voice): what is on screen and which buttons it
 * has, with the rectangle each one occupies, read off the same layouts the HUD draws and the mouse
 * is hit-tested against. A press is played as a click at the button's centre on the next tick, so
 * an agent's click goes down the exact path a mouse click does (screens.ts, team-setup.ts,
 * pause.ts, options.ts, weapon-panel.ts) and can do nothing a player's click could not.
 *
 * Pure: layouts in, buttons out. main.ts supplies the layouts and plays the click.
 */

import type { TitleLayout } from '../game/screens.ts';
import type { PanelLayout } from '../game/weapon-panel.ts';
import type { OptionsLayout } from '../ui/screens/options.ts';
import type { PauseLayout } from '../ui/screens/pause.ts';
import { TEAM_NAME_PRESETS, type TeamSetupLayout, type TeamSetupState } from '../ui/screens/team-setup.ts';
import { fold } from './lexicon.ts';
import type { ScreenButton, ScreenView } from './tools.ts';

export type { ScreenButton, ScreenView };

const centre = (r: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function titleButtons(layout: TitleLayout): ScreenButton[] {
  return [
    ...layout.buttons.map((b) => ({ id: b.id, label: `${b.label}: play with ${b.id === 'touch' ? 'touch controls' : 'keyboard and mouse'} and go to the team setup`, enabled: true, at: centre(b) })),
    // The title starts on any click with the device lit; "start" is that click.
    ...(layout.buttons.filter((b) => b.id === layout.selected).map((b) => ({ id: 'start', label: 'Start (the device lit)', enabled: true, at: centre(b) }))),
  ];
}

export function setupButtons(layout: TeamSetupLayout, setup: TeamSetupState): ScreenButton[] {
  return layout.cells.map((cell) => {
    const slot = cell.team === undefined ? undefined : setup.teams[cell.team];
    const team = cell.team === undefined ? '' : `Team ${cell.team + 1}`;
    let label: string;
    switch (cell.kind) {
      case 'map':
        label = `Map: ${setup.scenario} (click for the next map)`;
        break;
      case 'name':
        label = `${team} name: ${TEAM_NAME_PRESETS[slot?.nameIndex ?? 0] ?? '?'} (click for the next name)`;
        break;
      case 'controller':
        label = `${team} played by: ${slot?.controller ?? '?'} (click to switch human / CPU)`;
        break;
      case 'difficulty':
        label = `${team} CPU difficulty: ${slot?.difficulty ?? '?'} (click for the next)`;
        break;
      case 'add':
        label = 'More teams';
        break;
      case 'remove':
        label = 'Fewer teams';
        break;
      case 'start':
        label = 'Start the match';
        break;
    }
    return { id: cell.id, label, enabled: true, at: centre(cell) };
  });
}

export function pauseButtons(layout: PauseLayout): ScreenButton[] {
  return layout.buttons.map((b) => ({ id: b.id, label: b.label, enabled: true, at: centre(b) }));
}

export function optionsButtons(layout: OptionsLayout): ScreenButton[] {
  return layout.cells.map((cell) => {
    const label =
      cell.kind === 'minus' ? `${cell.target ?? ''} volume down`
      : cell.kind === 'plus' ? `${cell.target ?? ''} volume up`
      : cell.kind === 'bar' ? `${cell.target ?? ''} volume bar`
      : cell.kind === 'key' ? `Rebind ${cell.action ?? ''} (then press the new key)`
      : cell.kind === 'reset' ? 'Reset to defaults'
      : 'Back';
    return { id: cell.id, label, enabled: true, at: centre(cell) };
  });
}

export function panelButtons(layout: PanelLayout): ScreenButton[] {
  return layout.rows.flatMap((row) => row.cells.map((cell) => ({ id: cell.id, label: `${cell.name}${cell.enabled ? '' : cell.resting ? ' (resting this turn)' : ' (locked or empty)'}`, enabled: cell.enabled, at: centre(cell) })));
}

/** A button by its id, or by its label said loosely ("start the match", "more teams", "escopeta"). */
export function findButton(view: ScreenView, wanted: string): ScreenButton | null {
  const exact = view.buttons.find((b) => b.id === wanted);
  if (exact !== undefined) return exact;
  const key = fold(wanted);
  if (key === '') return null;
  return (
    view.buttons.find((b) => fold(b.id) === key) ??
    view.buttons.find((b) => fold(b.label).startsWith(key)) ??
    view.buttons.find((b) => fold(b.label).includes(key)) ??
    null
  );
}
