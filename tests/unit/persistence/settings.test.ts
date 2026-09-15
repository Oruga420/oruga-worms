import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDS } from '@/config/keybinds.ts';
import { DEFAULT_SETTINGS, withAudio } from '@/persistence/save-schema.ts';
import { SETTINGS_KEY, clearSettings, loadSettings, saveSettings, storageOrNull, type KeyValueStorage } from '@/persistence/settings.ts';

/** In memory stand in for localStorage. */
function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage & { readonly map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** A storage that throws on every call, like a blocked private window. */
const THROWING: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('settings: load', () => {
  it('returns the defaults when there is no storage or nothing stored', () => {
    expect(loadSettings(null)).toEqual({ settings: DEFAULT_SETTINGS, source: 'defaults', repaired: [] });
    expect(loadSettings(fakeStorage())).toEqual({ settings: DEFAULT_SETTINGS, source: 'defaults', repaired: [] });
  });

  it('round trips a saved record and reports it as stored', () => {
    const storage = fakeStorage();
    const saved = withAudio(withAudio(DEFAULT_SETTINGS, 'music', 0.25), 'master', 0.5);
    expect(saveSettings(storage, saved)).toBe(true);
    expect(storage.map.has(SETTINGS_KEY)).toBe(true);
    const loaded = loadSettings(storage);
    expect(loaded.source).toBe('stored');
    expect(loaded.repaired).toEqual([]);
    expect(loaded.settings).toEqual(saved);
    expect(loaded.settings.keybinds).toEqual(DEFAULT_KEYBINDS);
  });

  it('falls back to the defaults on corrupt JSON and says so', () => {
    const loaded = loadSettings(fakeStorage({ [SETTINGS_KEY]: '{not json' }));
    expect(loaded.settings).toBe(DEFAULT_SETTINGS);
    expect(loaded.source).toBe('unreadable');
  });

  it('repairs invalid fields and reports which ones', () => {
    const loaded = loadSettings(fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ version: 1, audio: { master: 'x', sfx: 0.5 }, keybinds: 'nope' }) }));
    expect(loaded.source).toBe('repaired');
    expect(loaded.repaired).toEqual(['audio.master', 'audio.voice', 'audio.music', 'audio.ui', 'keybinds']);
    expect(loaded.settings.audio.sfx).toBe(0.5);
    expect(loaded.settings.keybinds).toBe(DEFAULT_KEYBINDS);
  });

  it('migrates an unversioned record and reports it as migrated', () => {
    const loaded = loadSettings(fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ audio: { master: 0.4, sfx: 1, voice: 1, music: 1, ui: 1 }, keybinds: DEFAULT_KEYBINDS }) }));
    expect(loaded.source).toBe('migrated');
    expect(loaded.settings.audio.master).toBe(0.4);
    expect(loaded.settings.version).toBe(1);
  });

  it('never throws when the storage throws', () => {
    expect(loadSettings(THROWING)).toEqual({ settings: DEFAULT_SETTINGS, source: 'unreadable', repaired: [] });
    expect(saveSettings(THROWING, DEFAULT_SETTINGS)).toBe(false);
    expect(clearSettings(THROWING)).toBe(false);
  });
});

describe('settings: save and clear', () => {
  it('writes JSON under the settings key and clears it', () => {
    const storage = fakeStorage();
    expect(saveSettings(storage, DEFAULT_SETTINGS)).toBe(true);
    expect(JSON.parse(storage.map.get(SETTINGS_KEY) ?? '')).toMatchObject({ version: 1 });
    expect(clearSettings(storage)).toBe(true);
    expect(storage.map.has(SETTINGS_KEY)).toBe(false);
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
    expect(clearSettings(null)).toBe(false);
  });
});

describe('settings: storageOrNull', () => {
  it('returns the storage, or null when the getter throws or yields nothing', () => {
    const storage = fakeStorage();
    expect(storageOrNull(() => storage)).toBe(storage);
    expect(storageOrNull(() => undefined)).toBeNull();
    expect(
      storageOrNull(() => {
        throw new Error('SecurityError');
      }),
    ).toBeNull();
  });
});
