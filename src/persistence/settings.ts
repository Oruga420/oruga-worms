/**
 * Settings persistence (architecture.md, persistence/settings.ts): load and save the Settings
 * record through a storage the caller injects (window.localStorage in the browser, a Map backed
 * fake in tests). Nothing in this module can throw: a storage that is missing or throws (private
 * mode, blocked site data), a corrupt JSON string or a stale schema all end in DEFAULT_SETTINGS
 * with the reason reported, so boot never depends on what a previous session left behind.
 */

import { DEFAULT_SETTINGS, parseSettings, type Settings } from './save-schema.ts';

/** The subset of the Web Storage API this module uses. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SETTINGS_KEY = 'orugas.settings';

export type LoadSource =
  /** Nothing stored: defaults. */
  | 'defaults'
  /** A valid current record. */
  | 'stored'
  /** A record from another schema version, parsed field by field. */
  | 'migrated'
  /** Some fields were invalid and replaced by their defaults. */
  | 'repaired'
  /** The storage threw or held something that is not JSON: defaults. */
  | 'unreadable';

export interface LoadedSettings {
  readonly settings: Settings;
  readonly source: LoadSource;
  readonly repaired: readonly string[];
}

const NOTHING: readonly string[] = Object.freeze([]);

/** Resolves a storage getter that may throw (accessing window.localStorage can) to the storage or null. */
export function storageOrNull(getter: () => KeyValueStorage | null | undefined): KeyValueStorage | null {
  try {
    return getter() ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: KeyValueStorage | null): LoadedSettings {
  if (storage === null) return Object.freeze({ settings: DEFAULT_SETTINGS, source: 'defaults', repaired: NOTHING });
  let text: string | null;
  try {
    text = storage.getItem(SETTINGS_KEY);
  } catch {
    return Object.freeze({ settings: DEFAULT_SETTINGS, source: 'unreadable', repaired: NOTHING });
  }
  if (text === null) return Object.freeze({ settings: DEFAULT_SETTINGS, source: 'defaults', repaired: NOTHING });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Object.freeze({ settings: DEFAULT_SETTINGS, source: 'unreadable', repaired: NOTHING });
  }
  const report = parseSettings(raw);
  const source: LoadSource = report.migratedFrom !== null ? 'migrated' : report.repaired.length > 0 ? 'repaired' : 'stored';
  return Object.freeze({ settings: report.settings, source, repaired: report.repaired });
}

/** True when the record was written; false when there is no storage or it refused (quota, private mode). */
export function saveSettings(storage: KeyValueStorage | null, settings: Settings): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function clearSettings(storage: KeyValueStorage | null): boolean {
  if (storage === null) return false;
  try {
    storage.removeItem(SETTINGS_KEY);
    return true;
  } catch {
    return false;
  }
}
