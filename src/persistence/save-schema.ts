/**
 * Versioned settings schema (architecture.md, persistence/save-schema.ts): what the game remembers
 * between sessions, the defaults, and the pure parser that turns whatever came out of storage
 * into a valid Settings value. Repair is field by field: a corrupt volume or an unknown key binding
 * falls back to its own default and is reported, never the whole record, so one bad entry cannot
 * wipe the rest and nothing here can throw on untrusted input.
 *
 * Version 1: audio levels per bus (master, sfx, voice, music, ui) in 0..1 and the key bindings.
 * An unversioned record is treated as version 0 and migrated; a record from a NEWER version is
 * parsed on a best effort basis and reported, so a downgrade never crashes boot.
 */

import { DEFAULT_KEYBINDS, validateKeybinds, type Keybinds } from '../config/keybinds.ts';

export const SETTINGS_VERSION = 1;

export const AUDIO_TARGETS = ['master', 'sfx', 'voice', 'music', 'ui'] as const;
export type AudioTarget = (typeof AUDIO_TARGETS)[number];
export type AudioLevels = Readonly<Record<AudioTarget, number>>;

export interface Settings {
  readonly version: typeof SETTINGS_VERSION;
  readonly audio: AudioLevels;
  readonly keybinds: Keybinds;
}

export const DEFAULT_AUDIO: AudioLevels = Object.freeze({ master: 1, sfx: 1, voice: 1, music: 1, ui: 1 });

export const DEFAULT_SETTINGS: Settings = Object.freeze({
  version: SETTINGS_VERSION,
  audio: DEFAULT_AUDIO,
  keybinds: DEFAULT_KEYBINDS,
});

export interface ParseReport {
  readonly settings: Settings;
  /** Dotted paths that were invalid and replaced by their default, in the order found. */
  readonly repaired: readonly string[];
  /** The version the record declared when it was not the current one; null when it was current. */
  readonly migratedFrom: number | null;
}

type Rec = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAudioTarget(value: unknown): value is AudioTarget {
  return typeof value === 'string' && (AUDIO_TARGETS as readonly string[]).includes(value);
}

/** A finite number clamped to 0..1; anything else is invalid. */
export function parseLevel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export function parseAudio(raw: unknown, repaired: string[]): AudioLevels {
  if (!isRecord(raw)) {
    repaired.push('audio');
    return DEFAULT_AUDIO;
  }
  const out: Record<AudioTarget, number> = { ...DEFAULT_AUDIO };
  for (const target of AUDIO_TARGETS) {
    const level = parseLevel(raw[target]);
    if (level === null) {
      repaired.push(`audio.${target}`);
      continue;
    }
    out[target] = level;
  }
  return Object.freeze(out);
}

export function parseKeybinds(raw: unknown, repaired: string[]): Keybinds {
  const result = validateKeybinds(raw);
  if (result.ok) return result.value;
  repaired.push('keybinds');
  return DEFAULT_KEYBINDS;
}

/**
 * Field by field parse of an untrusted record. Version 0 (no version field) is the pre release
 * layout, which happens to share the field names of version 1, so migration is the same parse
 * with the version reported. Later schema versions add their steps here.
 */
export function parseSettings(raw: unknown): ParseReport {
  const repaired: string[] = [];
  if (!isRecord(raw)) {
    return Object.freeze({ settings: DEFAULT_SETTINGS, repaired: Object.freeze(['settings']), migratedFrom: null });
  }
  const declared = raw['version'];
  const version = typeof declared === 'number' && Number.isInteger(declared) && declared >= 0 ? declared : 0;
  const migratedFrom = version === SETTINGS_VERSION ? null : version;
  if (version > SETTINGS_VERSION) repaired.push('version');
  const settings: Settings = Object.freeze({
    version: SETTINGS_VERSION,
    audio: parseAudio(raw['audio'], repaired),
    keybinds: parseKeybinds(raw['keybinds'], repaired),
  });
  return Object.freeze({ settings, repaired: Object.freeze(repaired), migratedFrom });
}

/** A new Settings with one audio level changed (clamped); the input is never mutated. */
export function withAudio(settings: Settings, target: AudioTarget, level: number): Settings {
  const clamped = parseLevel(level) ?? settings.audio[target];
  return Object.freeze({ ...settings, audio: Object.freeze({ ...settings.audio, [target]: clamped }) });
}

/** A new Settings with the key bindings replaced; an invalid map keeps the current one. */
export function withKeybinds(settings: Settings, keybinds: unknown): Settings {
  const result = validateKeybinds(keybinds);
  return result.ok ? Object.freeze({ ...settings, keybinds: result.value }) : settings;
}
