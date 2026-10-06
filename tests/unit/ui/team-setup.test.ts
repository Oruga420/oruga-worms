import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { buildInitialState } from '@/match/setup.ts';
import {
  DEFAULT_TEAM_SETUP,
  DIFFICULTIES,
  MAX_TEAMS,
  MIN_TEAMS,
  TEAM_NAME_PRESETS,
  WORMS_PER_TEAM,
  drawTeamSetup,
  hitTestTeamSetup,
  layoutTeamSetup,
  reduceTeamSetup,
  toMatchSetup,
  type TeamSetupState,
} from '@/ui/screens/team-setup.ts';
import { SCENARIO_IDS } from '@/terrain/scenarios.ts';
import { createRecordingContext } from './recording-context.ts';

const VIEWPORT = { w: 1280, h: 720 };
const WORLD = { w: 1920, h: 696 };

describe('team setup: state', () => {
  it('starts as one human team against one CPU team and never mutates its input', () => {
    expect(DEFAULT_TEAM_SETUP.teams.map((t) => t.controller)).toEqual(['human', 'cpu']);
    const next = reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'toggleController', team: 1 });
    expect(next.teams[1]?.controller).toBe('human');
    expect(DEFAULT_TEAM_SETUP.teams[1]?.controller).toBe('cpu');
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.teams)).toBe(true);
  });

  it('adds up to four teams and removes down to two, with unique preset names', () => {
    let state: TeamSetupState = DEFAULT_TEAM_SETUP;
    for (let i = 0; i < 5; i += 1) state = reduceTeamSetup(state, { kind: 'addTeam' });
    expect(state.teams).toHaveLength(MAX_TEAMS);
    expect(new Set(state.teams.map((t) => t.nameIndex)).size).toBe(MAX_TEAMS);
    for (let i = 0; i < 5; i += 1) state = reduceTeamSetup(state, { kind: 'removeTeam' });
    expect(state.teams).toHaveLength(MIN_TEAMS);
  });

  it('cycles a name past the ones other teams hold and cycles difficulty only for CPU teams', () => {
    // Team 0 holds preset 0 and team 1 holds preset 1; cycling team 0 skips 1 and lands on 2.
    const cycled = reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'cycleName', team: 0 });
    expect(cycled.teams[0]?.nameIndex).toBe(2);
    expect(reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'cycleDifficulty', team: 0 })).toBe(DEFAULT_TEAM_SETUP);
    const harder = reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'cycleDifficulty', team: 1 });
    expect(harder.teams[1]?.difficulty).toBe(DIFFICULTIES[(DIFFICULTIES.indexOf('normal') + 1) % DIFFICULTIES.length]);
    expect(reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'cycleName', team: 9 })).toBe(DEFAULT_TEAM_SETUP);
  });

  it('starts on the island and cycles the map through every scenario and back, keeping the teams', () => {
    expect(DEFAULT_TEAM_SETUP.scenario).toBe('island');
    let state: TeamSetupState = reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'toggleController', team: 1 });
    const seen: string[] = [];
    for (let i = 0; i < SCENARIO_IDS.length; i += 1) {
      state = reduceTeamSetup(state, { kind: 'cycleScenario' });
      seen.push(state.scenario);
      expect(state.teams[1]?.controller).toBe('human');
      expect(Object.isFrozen(state)).toBe(true);
    }
    expect(seen).toEqual(['spaceship', 'castle', 'kame_house', 'island']);
    // Other actions keep the map that was picked.
    const castle = reduceTeamSetup(reduceTeamSetup(state, { kind: 'cycleScenario' }), { kind: 'cycleScenario' });
    expect(castle.scenario).toBe('castle');
    expect(reduceTeamSetup(castle, { kind: 'addTeam' }).scenario).toBe('castle');
    expect(reduceTeamSetup(castle, { kind: 'cycleName', team: 0 }).scenario).toBe('castle');
  });
});

describe('team setup: toMatchSetup', () => {
  it('gives every team six worms, each with a name of its own', () => {
    expect(WORMS_PER_TEAM).toBe(6);
    const four: TeamSetupState = { teams: [0, 1, 2, 3].map((nameIndex) => ({ nameIndex, controller: 'cpu' as const, difficulty: 'normal' as const })), scenario: 'island' };
    for (const team of toMatchSetup(four, 7, WORLD).teams) {
      expect(team.wormNames).toHaveLength(6);
      expect(new Set(team.wormNames).size).toBe(6);
    }
  });

  it('produces a MatchSetup that buildInitialState accepts, for every team count', () => {
    let state: TeamSetupState = DEFAULT_TEAM_SETUP;
    for (let count = MIN_TEAMS; count <= MAX_TEAMS; count += 1) {
      const setup = toMatchSetup(state, 7, WORLD);
      expect(setup.teams).toHaveLength(count);
      expect(setup.teams.every((t) => t.wormNames.length === WORMS_PER_TEAM)).toBe(true);
      expect(setup.teams.map((t) => t.colorIndex)).toEqual(setup.teams.map((_, i) => i));
      expect(setup.teams[1]?.cpu).toEqual({ difficulty: 'normal', personality: 'aggressive' });
      expect(setup.teams[0]?.cpu).toBeUndefined();
      const built = buildInitialState(setup, GAME_CONFIG);
      expect(built.ok).toBe(true);
      state = reduceTeamSetup(state, { kind: 'addTeam' });
    }
  });

  it('names come from the presets and stay within the 16 character limit', () => {
    for (const name of TEAM_NAME_PRESETS) expect(name.length).toBeLessThanOrEqual(16);
    const setup = toMatchSetup(DEFAULT_TEAM_SETUP, 1, WORLD);
    expect(setup.teams.map((t) => t.name)).toEqual(['Reds', 'Blues']);
  });

  it('carries the chosen map onto the sheet', () => {
    expect(toMatchSetup(DEFAULT_TEAM_SETUP, 1, WORLD).scenario).toBe('island');
    const castle = reduceTeamSetup(reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'cycleScenario' }), { kind: 'cycleScenario' });
    const setup = toMatchSetup(castle, 1, WORLD);
    expect(setup.scenario).toBe('castle');
    expect(buildInitialState(setup, GAME_CONFIG).ok).toBe(true);
  });
});

describe('team setup: layout, hit test and draw', () => {
  const layout = layoutTeamSetup(VIEWPORT, DEFAULT_TEAM_SETUP);

  it('has a map row above the teams, name and controller cells per team, a difficulty cell only for CPU teams, and the three buttons', () => {
    const ids = layout.cells.map((c) => c.id);
    const map = layout.cells.find((c) => c.id === 'map');
    const firstName = layout.cells.find((c) => c.id === 'team:0:name');
    expect(map?.kind).toBe('map');
    expect(map !== undefined && firstName !== undefined && map.y + map.h <= firstName.y).toBe(true);
    expect(ids).toContain('team:0:name');
    expect(ids).toContain('team:0:controller');
    expect(ids).not.toContain('team:0:difficulty');
    expect(ids).toContain('team:1:difficulty');
    expect(ids).toEqual(expect.arrayContaining(['add', 'remove', 'start']));
    for (const c of layout.cells) {
      expect(c.x).toBeGreaterThanOrEqual(layout.card.x);
      expect(c.x + c.w).toBeLessThanOrEqual(layout.card.x + layout.card.w);
      expect(c.y + c.h).toBeLessThanOrEqual(layout.card.y + layout.card.h);
    }
  });

  it('resolves clicks to typed actions and to null off the cells', () => {
    const cell = (id: string) => {
      const found = layout.cells.find((c) => c.id === id);
      if (found === undefined) throw new Error(`missing ${id}`);
      return { x: found.x + 2, y: found.y + 2 };
    };
    expect(hitTestTeamSetup(layout, cell('map'))).toEqual({ kind: 'cycleScenario' });
    expect(hitTestTeamSetup(layout, cell('team:0:name'))).toEqual({ kind: 'cycleName', team: 0 });
    expect(hitTestTeamSetup(layout, cell('team:1:controller'))).toEqual({ kind: 'toggleController', team: 1 });
    expect(hitTestTeamSetup(layout, cell('team:1:difficulty'))).toEqual({ kind: 'cycleDifficulty', team: 1 });
    expect(hitTestTeamSetup(layout, cell('add'))).toEqual({ kind: 'addTeam' });
    expect(hitTestTeamSetup(layout, cell('remove'))).toEqual({ kind: 'removeTeam' });
    expect(hitTestTeamSetup(layout, cell('start'))).toEqual({ kind: 'start' });
    expect(hitTestTeamSetup(layout, { x: 1, y: 1 })).toBeNull();
  });

  it('draws the title, every team name, Human and CPU labels, the difficulty and the buttons', () => {
    const ctx = createRecordingContext();
    drawTeamSetup(ctx, VIEWPORT, layout, DEFAULT_TEAM_SETUP, (i) => (i === 0 ? '#e05a4d' : '#4d8fe0'));
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('TEAMS');
    expect(texts).toContain('Map');
    expect(texts).toContain('Island');
    expect(texts).toContain('Reds');
    expect(texts).toContain('Blues');
    expect(texts).toContain('Human');
    expect(texts).toContain('CPU');
    expect(texts).toContain('normal');
    expect(texts).toContain('Start (Enter)');
  });

  it('names the map picked on the card', () => {
    const kame = reduceTeamSetup(reduceTeamSetup(reduceTeamSetup(DEFAULT_TEAM_SETUP, { kind: 'cycleScenario' }), { kind: 'cycleScenario' }), { kind: 'cycleScenario' });
    const ctx = createRecordingContext();
    drawTeamSetup(ctx, VIEWPORT, layoutTeamSetup(VIEWPORT, kame), kame, () => '#e05a4d');
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('Kame House');
    expect(texts).not.toContain('Island');
  });
});
