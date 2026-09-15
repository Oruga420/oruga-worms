import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS } from '@/config/keybinds.ts';
import {
  AUDIO_TARGETS,
  DEFAULT_AUDIO,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  isAudioTarget,
  parseAudio,
  parseKeybinds,
  parseLevel,
  parseSettings,
  withAudio,
  withKeybinds,
} from '@/persistence/save-schema.ts';

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isDeepFrozen);
}

describe('save-schema: defaults', () => {
  it('ships version 1 with every bus at full volume and the default key bindings, deep frozen', () => {
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION);
    expect(DEFAULT_SETTINGS.audio).toEqual({ master: 1, sfx: 1, voice: 1, music: 1, ui: 1 });
    expect(DEFAULT_SETTINGS.keybinds).toBe(DEFAULT_KEYBINDS);
    expect(isDeepFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(AUDIO_TARGETS).toEqual(['master', 'sfx', 'voice', 'music', 'ui']);
  });

  it('recognises audio targets', () => {
    expect(isAudioTarget('music')).toBe(true);
    expect(isAudioTarget('bass')).toBe(false);
    expect(isAudioTarget(3)).toBe(false);
  });
});

describe('save-schema: parseLevel and parseAudio', () => {
  it('clamps finite numbers to 0..1 and rejects everything else', () => {
    expect(parseLevel(0.4)).toBe(0.4);
    expect(parseLevel(7)).toBe(1);
    expect(parseLevel(-2)).toBe(0);
    expect(parseLevel(Number.NaN)).toBeNull();
    expect(parseLevel('0.5')).toBeNull();
    expect(parseLevel(undefined)).toBeNull();
  });

  it('repairs one bad bus without touching the others', () => {
    const repaired: string[] = [];
    const audio = parseAudio({ master: 0.5, sfx: 'loud', voice: 0.2, music: 2, ui: 0 }, repaired);
    expect(audio).toEqual({ master: 0.5, sfx: 1, voice: 0.2, music: 1, ui: 0 });
    expect(repaired).toEqual(['audio.sfx']);
    expect(Object.isFrozen(audio)).toBe(true);
  });

  it('falls back to the default levels when the audio block is missing', () => {
    const repaired: string[] = [];
    expect(parseAudio(undefined, repaired)).toBe(DEFAULT_AUDIO);
    expect(repaired).toEqual(['audio']);
  });
});

describe('save-schema: parseKeybinds', () => {
  it('accepts a valid map and rejects a broken one to the defaults', () => {
    const repaired: string[] = [];
    const custom = { ...DEFAULT_KEYBINDS, fire: ['KeyF'] };
    expect(parseKeybinds(custom, repaired).fire).toEqual(['KeyF']);
    expect(repaired).toEqual([]);
    // Duplicate key: Space bound to both jump and fire.
    expect(parseKeybinds({ ...DEFAULT_KEYBINDS, jump: ['Space'] }, repaired)).toBe(DEFAULT_KEYBINDS);
    expect(repaired).toEqual(['keybinds']);
  });
});

describe('save-schema: parseSettings', () => {
  it('keeps a valid current record untouched and reports nothing', () => {
    const raw = { version: 1, audio: { master: 0.8, sfx: 0.7, voice: 0.6, music: 0.5, ui: 0.4 }, keybinds: DEFAULT_KEYBINDS };
    const report = parseSettings(raw);
    expect(report.settings.audio).toEqual(raw.audio);
    expect(report.settings.keybinds).toEqual(DEFAULT_KEYBINDS);
    expect(report.repaired).toEqual([]);
    expect(report.migratedFrom).toBeNull();
    expect(isDeepFrozen(report.settings)).toBe(true);
  });

  it('treats an unversioned record as version 0 and migrates it field by field', () => {
    const report = parseSettings({ audio: { master: 0.3 }, keybinds: DEFAULT_KEYBINDS });
    expect(report.migratedFrom).toBe(0);
    expect(report.settings.version).toBe(1);
    expect(report.settings.audio.master).toBe(0.3);
    expect(report.repaired).toEqual(['audio.sfx', 'audio.voice', 'audio.music', 'audio.ui']);
  });

  it('parses a record from a newer version on a best effort basis and reports the version', () => {
    const report = parseSettings({ version: 7, audio: { ...DEFAULT_AUDIO, music: 0.1 }, keybinds: DEFAULT_KEYBINDS });
    expect(report.migratedFrom).toBe(7);
    expect(report.repaired).toEqual(['version']);
    expect(report.settings.audio.music).toBe(0.1);
  });

  it('falls back to the whole defaults when the record is not an object', () => {
    for (const raw of [null, 'settings', 4, ['a'], undefined]) {
      const report = parseSettings(raw);
      expect(report.settings).toBe(DEFAULT_SETTINGS);
      expect(report.repaired).toEqual(['settings']);
    }
  });
});

describe('save-schema: updates', () => {
  it('returns a new frozen record with one level changed and never mutates the input', () => {
    const next = withAudio(DEFAULT_SETTINGS, 'music', 0.25);
    expect(next.audio.music).toBe(0.25);
    expect(next.audio.master).toBe(1);
    expect(DEFAULT_SETTINGS.audio.music).toBe(1);
    expect(isDeepFrozen(next)).toBe(true);
    // Out of range levels are clamped; NaN keeps the current level.
    expect(withAudio(next, 'music', 9).audio.music).toBe(1);
    expect(withAudio(next, 'music', Number.NaN).audio.music).toBe(0.25);
  });

  it('replaces the key bindings only with a valid map', () => {
    const custom = { ...DEFAULT_KEYBINDS, fire: ['KeyF'] };
    expect(withKeybinds(DEFAULT_SETTINGS, custom).keybinds.fire).toEqual(['KeyF']);
    expect(withKeybinds(DEFAULT_SETTINGS, { fire: ['KeyF'] })).toBe(DEFAULT_SETTINGS);
  });
});
