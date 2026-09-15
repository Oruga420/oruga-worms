import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_KEYBINDS } from '@/config/keybinds.ts';
import { AUDIO_TARGETS, DEFAULT_AUDIO } from '@/persistence/save-schema.ts';
import {
  ACTION_LABELS,
  KEY_ROW_ORDER,
  VOLUME_STEP,
  actionsCovered,
  drawOptionsScreen,
  hitTestOptions,
  layoutOptionsScreen,
  levelFromBar,
  prettyKey,
  type OptionsModel,
} from '@/ui/screens/options.ts';
import { createRecordingContext } from './recording-context.ts';

const VIEWPORT = { w: 1280, h: 720 };
const MODEL: OptionsModel = { audio: DEFAULT_AUDIO, keybinds: DEFAULT_KEYBINDS, listening: null, notice: null };

function cell(id: string, layout = layoutOptionsScreen(VIEWPORT)) {
  const found = layout.cells.find((c) => c.id === id);
  if (found === undefined) throw new Error(`cell ${id} missing`);
  return found;
}

describe('options screen: layout', () => {
  const layout = layoutOptionsScreen(VIEWPORT);

  it('has a bar and two step buttons per audio bus, a row per action, and the two buttons', () => {
    for (const target of AUDIO_TARGETS) {
      expect(cell(`vol:${target}:bar`, layout).kind).toBe('bar');
      expect(cell(`vol:${target}:minus`, layout).kind).toBe('minus');
      expect(cell(`vol:${target}:plus`, layout).kind).toBe('plus');
    }
    for (const action of ACTIONS) expect(cell(`key:${action}`, layout).action).toBe(action);
    expect(cell('reset', layout).kind).toBe('reset');
    expect(cell('back', layout).kind).toBe('back');
    expect(layout.cells.length).toBe(AUDIO_TARGETS.length * 3 + ACTIONS.length + 2);
    expect(Object.isFrozen(layout.cells)).toBe(true);
  });

  it('covers every action with a label and a row, so a new Action cannot be forgotten', () => {
    expect(actionsCovered()).toBe(true);
    expect(new Set(KEY_ROW_ORDER).size).toBe(ACTIONS.length);
    for (const action of ACTIONS) expect(ACTION_LABELS[action].length).toBeGreaterThan(0);
  });

  it('keeps every cell inside the card and the card inside the viewport', () => {
    const { card } = layout;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.x + card.w).toBeLessThanOrEqual(VIEWPORT.w);
    expect(card.y + card.h).toBeLessThanOrEqual(VIEWPORT.h);
    for (const c of layout.cells) {
      expect(c.x).toBeGreaterThanOrEqual(card.x);
      expect(c.y).toBeGreaterThanOrEqual(card.y);
      expect(c.x + c.w).toBeLessThanOrEqual(card.x + card.w);
      expect(c.y + c.h).toBeLessThanOrEqual(card.y + card.h);
    }
  });

  it('never overlaps two cells', () => {
    const cells = layout.cells;
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i];
        const b = cells[j];
        if (a === undefined || b === undefined) throw new Error('cell missing');
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('options screen: hit test', () => {
  const layout = layoutOptionsScreen(VIEWPORT);

  it('maps the bar to a snapped level, the steps to a delta, a key row to a rebind and the buttons to themselves', () => {
    const bar = cell('vol:music:bar', layout);
    expect(hitTestOptions(layout, { x: bar.x, y: bar.y + 2 })).toEqual({ kind: 'volume', target: 'music', level: 0 });
    expect(hitTestOptions(layout, { x: bar.x + bar.w / 2, y: bar.y + 2 })).toEqual({ kind: 'volume', target: 'music', level: 0.5 });
    expect(hitTestOptions(layout, { x: bar.x + bar.w - 1, y: bar.y + 2 })).toEqual({ kind: 'volume', target: 'music', level: 1 });
    const minus = cell('vol:sfx:minus', layout);
    expect(hitTestOptions(layout, { x: minus.x + 2, y: minus.y + 2 })).toEqual({ kind: 'volumeStep', target: 'sfx', delta: -VOLUME_STEP });
    const plus = cell('vol:sfx:plus', layout);
    expect(hitTestOptions(layout, { x: plus.x + 2, y: plus.y + 2 })).toEqual({ kind: 'volumeStep', target: 'sfx', delta: VOLUME_STEP });
    const fire = cell('key:fire', layout);
    expect(hitTestOptions(layout, { x: fire.x + 2, y: fire.y + 2 })).toEqual({ kind: 'rebind', action: 'fire' });
    const reset = cell('reset', layout);
    expect(hitTestOptions(layout, { x: reset.x + 2, y: reset.y + 2 })).toEqual({ kind: 'reset' });
    const back = cell('back', layout);
    expect(hitTestOptions(layout, { x: back.x + 2, y: back.y + 2 })).toEqual({ kind: 'back' });
    expect(hitTestOptions(layout, { x: 2, y: 2 })).toBeNull();
  });

  it('snaps bar levels to twentieths and clamps outside the bar', () => {
    const bar = cell('vol:master:bar', layout);
    expect(levelFromBar(bar, { x: bar.x + bar.w * 0.33, y: bar.y })).toBe(0.35);
    expect(levelFromBar(bar, { x: bar.x - 50, y: bar.y })).toBe(0);
    expect(levelFromBar(bar, { x: bar.x + bar.w + 50, y: bar.y })).toBe(1);
  });
});

describe('options screen: draw and helpers', () => {
  it('prints friendly key names', () => {
    expect(prettyKey('KeyA')).toBe('A');
    expect(prettyKey('ArrowLeft')).toBe('Left');
    expect(prettyKey('Digit3')).toBe('3');
    expect(prettyKey('Shift+KeyQ')).toBe('Shift+Q');
    expect(prettyKey('Space')).toBe('Space');
  });

  it('draws the title, every bus label and percent, the key rows, the listening hint and the notice', () => {
    const ctx = createRecordingContext();
    const model: OptionsModel = { ...MODEL, audio: { ...DEFAULT_AUDIO, music: 0.25 }, listening: 'fire', notice: 'Space is bound to both jump and fire' };
    drawOptionsScreen(ctx, VIEWPORT, layoutOptionsScreen(VIEWPORT), model);
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('OPTIONS');
    expect(texts).toContain('Music');
    expect(texts).toContain('25%');
    expect(texts).toContain('Fire (hold to charge)');
    expect(texts).toContain('press a key...');
    expect(texts).toContain('Left / A');
    expect(texts).toContain('Space is bound to both jump and fire');
    expect(texts).toContain('Reset to defaults');
    expect(texts).toContain('Back (Esc)');
  });
});
