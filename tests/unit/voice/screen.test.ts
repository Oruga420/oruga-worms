import { describe, expect, it } from 'vitest';
import { layoutTitleScreen } from '../../../src/game/screens.ts';
import { DEFAULT_TEAM_SETUP, layoutTeamSetup } from '../../../src/ui/screens/team-setup.ts';
import { layoutPauseScreen } from '../../../src/ui/screens/pause.ts';
import { findButton, pauseButtons, setupButtons, titleButtons } from '../../../src/voice/screen.ts';

const VIEW = { w: 1280, h: 720 };

describe('screen buttons for WebMCP and voice', () => {
  it('lists the title buttons with a start that clicks the lit device', () => {
    const buttons = titleButtons(layoutTitleScreen(VIEW, 'desktop'));
    const start = buttons.find((b) => b.id === 'start');
    const desktop = buttons.find((b) => b.id === 'desktop');
    expect(start?.at).toEqual(desktop?.at);
    expect(buttons.map((b) => b.id)).toContain('touch');
  });

  it('describes the team setup cells with their current values', () => {
    const buttons = setupButtons(layoutTeamSetup(VIEW, DEFAULT_TEAM_SETUP), DEFAULT_TEAM_SETUP);
    expect(buttons.find((b) => b.id === 'team:1:controller')?.label).toContain('cpu');
    expect(buttons.find((b) => b.id === 'map')?.label).toContain('island');
    expect(buttons.some((b) => b.id === 'start')).toBe(true);
  });

  it('finds a button by id, by id loosely, or by its label', () => {
    const view = { screen: 'paused' as const, buttons: pauseButtons(layoutPauseScreen(VIEW)) };
    expect(findButton(view, 'resume')?.id).toBe('resume');
    expect(findButton(view, 'Surrender')?.id).toBe('surrender');
    expect(findButton(view, 'options')?.at).toBeDefined();
    expect(findButton(view, 'nope')).toBeNull();
  });
});
