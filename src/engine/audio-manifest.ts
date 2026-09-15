/**
 * Engine side schema of assets/audio/manifest.json (sound-pipeline.md section 8, written by
 * tools/audio/manifest.ts). The engine reads a subset of each entry: id, bus, group, files,
 * durationMs, loop, loopStartMs, loopEndMs, gainDb, pitchVariance and status. Provenance and
 * check fields are ignored on purpose so the pipeline can grow the manifest without touching
 * the engine.
 *
 * Two kinds of bad input, two answers. A malformed entry (unknown bus, bad id, missing file) is
 * a tool bug and fails the whole manifest with a path, like the atlas validator: a hard fail at
 * boot beats a silent blank at runtime. An entry whose status is not ok is an expected pipeline
 * outcome (generation failed, placeholder kept) and is skipped and reported, never played.
 */

import { err, ok, type Err, type Result } from '../core/result.ts';
import { isAssetId, isRecord, isRelativePath, toFinite } from '../core/validate.ts';

export const BUS_NAMES = ['sfx', 'voice', 'music', 'ui'] as const;

export type BusName = (typeof BUS_NAMES)[number];

export function isBusName(value: unknown): value is BusName {
  return typeof value === 'string' && (BUS_NAMES as readonly string[]).includes(value);
}

export interface AudioAssetInfo {
  readonly id: string;
  readonly bus: BusName;
  readonly group: string;
  readonly files: { readonly ogg: string; readonly mp3: string };
  readonly durationMs: number;
  readonly loop: boolean;
  /** Loop window in ms; an end of 0 means the end of the buffer. */
  readonly loopStartMs: number;
  readonly loopEndMs: number;
  readonly gainDb: number;
  /** Fraction, 0.08 means plus or minus 8 percent playback rate. */
  readonly pitchVariance: number;
}

export interface SkippedAudioAsset {
  readonly id: string;
  /** The status the manifest carried, or "missing" when it had none. */
  readonly status: string;
}

export interface AudioManifestInfo {
  readonly version: 1;
  /** Only assets with status ok, keyed by id. */
  readonly assets: Readonly<Record<string, AudioAssetInfo>>;
  readonly skipped: readonly SkippedAudioAsset[];
}

export type AudioManifestErrorCode = 'not_an_object' | 'version' | 'assets' | 'asset' | 'duplicate';

export interface AudioManifestError {
  readonly code: AudioManifestErrorCode;
  /** Dotted path to the offending value, for example "assets[3].bus". */
  readonly path: string;
  readonly message: string;
}

type Check<T> = Result<T, AudioManifestError>;

type Entry = { readonly kind: 'ok'; readonly asset: AudioAssetInfo } | { readonly kind: 'skipped'; readonly skipped: SkippedAudioAsset };

function fail(code: AudioManifestErrorCode, path: string, message: string): Err<AudioManifestError> {
  return err(Object.freeze({ code, path, message }));
}

function readNonNegative(value: unknown, path: string, fallback: number | null): Check<number> {
  if (value === undefined || value === null) {
    return fallback === null ? fail('asset', path, 'missing number') : ok(fallback);
  }
  const number = toFinite(value);
  if (number === null || number < 0) return fail('asset', path, 'must be a finite number of at least 0');
  return ok(number);
}

function readFiles(value: unknown, path: string): Check<{ readonly ogg: string; readonly mp3: string }> {
  if (!isRecord(value)) return fail('asset', path, 'files must be an object with ogg and mp3');
  const ogg = value['ogg'];
  const mp3 = value['mp3'];
  if (!isRelativePath(ogg)) return fail('asset', `${path}.ogg`, 'must be a relative path inside the asset root');
  if (!isRelativePath(mp3)) return fail('asset', `${path}.mp3`, 'must be a relative path inside the asset root');
  return ok(Object.freeze({ ogg, mp3 }));
}

function readAsset(index: number, raw: unknown): Check<Entry> {
  const path = `assets[${index}]`;
  if (!isRecord(raw)) return fail('asset', path, 'asset entry must be an object');
  const id = raw['id'];
  if (!isAssetId(id)) return fail('asset', `${path}.id`, 'id must match ^[a-z0-9_]+$');
  const status = raw['status'];
  if (status !== 'ok') {
    return ok({ kind: 'skipped', skipped: Object.freeze({ id, status: typeof status === 'string' ? status : 'missing' }) });
  }
  const bus = raw['bus'];
  if (!isBusName(bus)) return fail('asset', `${path}.bus`, `bus must be one of ${BUS_NAMES.join(', ')}`);
  const files = readFiles(raw['files'], `${path}.files`);
  if (!files.ok) return files;
  const durationMs = readNonNegative(raw['durationMs'], `${path}.durationMs`, null);
  if (!durationMs.ok) return durationMs;
  const loopStartMs = readNonNegative(raw['loopStartMs'], `${path}.loopStartMs`, 0);
  if (!loopStartMs.ok) return loopStartMs;
  const loopEndMs = readNonNegative(raw['loopEndMs'], `${path}.loopEndMs`, 0);
  if (!loopEndMs.ok) return loopEndMs;
  const gainDb = raw['gainDb'] === undefined ? 0 : toFinite(raw['gainDb']);
  if (gainDb === null) return fail('asset', `${path}.gainDb`, 'must be a finite number');
  const pitchVariance = raw['pitchVariance'] === undefined ? 0 : toFinite(raw['pitchVariance']);
  if (pitchVariance === null || pitchVariance < 0 || pitchVariance > 1) {
    return fail('asset', `${path}.pitchVariance`, 'must be a fraction between 0 and 1');
  }
  const loop = raw['loop'] === true;
  const group = typeof raw['group'] === 'string' ? raw['group'] : '';
  return ok({
    kind: 'ok',
    asset: Object.freeze({
      id,
      bus,
      group,
      files: files.value,
      durationMs: durationMs.value,
      loop,
      loopStartMs: loopStartMs.value,
      loopEndMs: loopEndMs.value,
      gainDb,
      pitchVariance,
    }),
  });
}

/** Validates a parsed audio manifest, keeps the status ok assets and reports the rest. */
export function validateAudioManifest(input: unknown): Result<AudioManifestInfo, AudioManifestError> {
  if (!isRecord(input)) return fail('not_an_object', '', 'audio manifest must be a JSON object');
  if (input['version'] !== 1) return fail('version', 'version', 'unsupported audio manifest version, expected 1');
  const rawAssets = input['assets'];
  if (!Array.isArray(rawAssets)) return fail('assets', 'assets', 'assets must be an array');

  const assets: Record<string, AudioAssetInfo> = {};
  const skipped: SkippedAudioAsset[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawAssets.length; index += 1) {
    const entry = readAsset(index, rawAssets[index]);
    if (!entry.ok) return entry;
    const id = entry.value.kind === 'ok' ? entry.value.asset.id : entry.value.skipped.id;
    if (seen.has(id)) return fail('duplicate', `assets[${index}].id`, `asset ${id} appears twice`);
    seen.add(id);
    if (entry.value.kind === 'ok') assets[id] = entry.value.asset;
    else skipped.push(entry.value.skipped);
  }
  return ok(Object.freeze({ version: 1 as const, assets: Object.freeze(assets), skipped: Object.freeze(skipped) }));
}
