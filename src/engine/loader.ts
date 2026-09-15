/**
 * Manifest driven asset loading (architecture.md section I: "manifest driven asset loading with
 * retry and progress"). The top level manifest lists atlases (image plus TexturePacker json),
 * plain images, the audio manifest path and the levels (mask plus texture PNG). Everything is
 * fetched in parallel through the LoaderIo interface, each fetch retried with exponential
 * backoff, progress reported per completed fetch, and the outcome returned as one Result: the
 * boot screen shows an error, it never crashes on a throw.
 *
 * Validation is a hard fail at boot (section G): a bad id, a path that leaves the asset root, an
 * oversize level or an atlas that fails its schema stops the load with a path to the offender.
 */

import { WORLD_SIZE_MAX, isValidWorldSize } from '../config/constants.ts';
import { err, ok, type Err, type Result } from '../core/result.ts';
import { dirnameUrl, isAssetId, isRecord, isRelativePath, joinUrl, toFinite } from '../core/validate.ts';
import { loadAtlas, type Atlas } from './atlas.ts';
import { validateAudioManifest, type AudioManifestInfo } from './audio-manifest.ts';
import type { ImageSource } from './canvas-types.ts';

export interface AtlasEntry {
  readonly id: string;
  readonly image: string;
  readonly json: string;
}

export interface ImageEntry {
  readonly id: string;
  readonly src: string;
}

export interface LevelEntry {
  readonly id: string;
  /** PNG whose alpha is solidity, decoded by the terrain PNG level loader. */
  readonly mask: string;
  readonly texture: string;
  readonly width: number;
  readonly height: number;
}

export interface AssetManifest {
  readonly version: 1;
  readonly atlases: readonly AtlasEntry[];
  readonly images: readonly ImageEntry[];
  /** Path of the audio manifest, relative to the asset root. */
  readonly audio: string;
  readonly levels: readonly LevelEntry[];
}

export type AssetManifestErrorCode = 'not_an_object' | 'version' | 'list' | 'entry' | 'duplicate' | 'audio';

export interface AssetManifestError {
  readonly code: AssetManifestErrorCode;
  readonly path: string;
  readonly message: string;
}

type Check<T> = Result<T, AssetManifestError>;

function fail(code: AssetManifestErrorCode, path: string, message: string): Err<AssetManifestError> {
  return err(Object.freeze({ code, path, message }));
}

function readId(value: unknown, path: string): Check<string> {
  return isAssetId(value) ? ok(value) : fail('entry', path, 'id must match ^[a-z0-9_]+$');
}

function readPath(value: unknown, path: string): Check<string> {
  return isRelativePath(value) ? ok(value) : fail('entry', path, 'must be a relative path inside the asset root');
}

function readAtlasEntry(raw: Readonly<Record<string, unknown>>, path: string): Check<AtlasEntry> {
  const id = readId(raw['id'], `${path}.id`);
  if (!id.ok) return id;
  const image = readPath(raw['image'], `${path}.image`);
  if (!image.ok) return image;
  const json = readPath(raw['json'], `${path}.json`);
  if (!json.ok) return json;
  return ok(Object.freeze({ id: id.value, image: image.value, json: json.value }));
}

function readImageEntry(raw: Readonly<Record<string, unknown>>, path: string): Check<ImageEntry> {
  const id = readId(raw['id'], `${path}.id`);
  if (!id.ok) return id;
  const src = readPath(raw['src'], `${path}.src`);
  if (!src.ok) return src;
  return ok(Object.freeze({ id: id.value, src: src.value }));
}

function readLevelEntry(raw: Readonly<Record<string, unknown>>, path: string): Check<LevelEntry> {
  const id = readId(raw['id'], `${path}.id`);
  if (!id.ok) return id;
  const mask = readPath(raw['mask'], `${path}.mask`);
  if (!mask.ok) return mask;
  const texture = readPath(raw['texture'], `${path}.texture`);
  if (!texture.ok) return texture;
  const width = toFinite(raw['width']);
  const height = toFinite(raw['height']);
  if (width === null || height === null || !isValidWorldSize({ w: width, h: height })) {
    return fail('entry', `${path}.width`, `width and height must be positive integers up to ${WORLD_SIZE_MAX.w} x ${WORLD_SIZE_MAX.h}`);
  }
  return ok(Object.freeze({ id: id.value, mask: mask.value, texture: texture.value, width, height }));
}

function readList<T extends { readonly id: string }>(
  value: unknown,
  path: string,
  readOne: (raw: Readonly<Record<string, unknown>>, entryPath: string) => Check<T>,
): Check<readonly T[]> {
  if (value === undefined) return ok(Object.freeze([]));
  if (!Array.isArray(value)) return fail('list', path, `${path} must be an array`);
  const out: T[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index}]`;
    const raw: unknown = value[index];
    if (!isRecord(raw)) return fail('entry', entryPath, 'entry must be an object');
    const entry = readOne(raw, entryPath);
    if (!entry.ok) return entry;
    if (seen.has(entry.value.id)) return fail('duplicate', `${entryPath}.id`, `${entry.value.id} appears twice in ${path}`);
    seen.add(entry.value.id);
    out.push(entry.value);
  }
  return ok(Object.freeze(out));
}

/** Validates a parsed asset manifest; lists may be omitted, the audio manifest path may not. */
export function validateAssetManifest(input: unknown): Result<AssetManifest, AssetManifestError> {
  if (!isRecord(input)) return fail('not_an_object', '', 'asset manifest must be a JSON object');
  if (input['version'] !== 1) return fail('version', 'version', 'unsupported asset manifest version, expected 1');
  const atlases = readList(input['atlases'], 'atlases', readAtlasEntry);
  if (!atlases.ok) return atlases;
  const images = readList(input['images'], 'images', readImageEntry);
  if (!images.ok) return images;
  const levels = readList(input['levels'], 'levels', readLevelEntry);
  if (!levels.ok) return levels;
  const audio = input['audio'];
  if (!isRelativePath(audio)) return fail('audio', 'audio', 'audio must be the relative path of the audio manifest');
  return ok(Object.freeze({ version: 1 as const, atlases: atlases.value, images: images.value, audio, levels: levels.value }));
}

export interface RetryPolicy {
  /** Total attempts including the first. */
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly factor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({ attempts: 3, baseDelayMs: 200, factor: 2 });

/** Wait after the n-th failed attempt: base, base x factor, base x factor squared and so on. */
export function backoffMs(failedAttempts: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  return policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, failedAttempts - 1));
}

export interface RetryFailure {
  readonly attempts: number;
  readonly message: string;
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** Runs a task up to policy.attempts times, waiting through delay between attempts; never throws. */
export async function withRetry<T>(
  task: () => Promise<T>,
  delay: (ms: number) => Promise<void>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<Result<T, RetryFailure>> {
  const attempts = Math.max(1, Math.floor(policy.attempts));
  let lastMessage = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return ok(await task());
    } catch (thrown: unknown) {
      lastMessage = messageOf(thrown);
    }
    if (attempt < attempts) await delay(backoffMs(attempt, policy));
  }
  return err(Object.freeze({ attempts, message: lastMessage }));
}

export interface LoaderIo {
  fetchJson(url: string): Promise<unknown>;
  loadImage(url: string): Promise<ImageSource>;
  /** Waits before a retry; injected so tests never sleep. */
  delay(ms: number): Promise<void>;
}

export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly url: string;
}

export type ProgressFn = (progress: LoadProgress) => void;

export interface LoadOptions {
  readonly onProgress?: ProgressFn;
  readonly retry?: RetryPolicy;
}

export interface LoadedLevel {
  readonly entry: LevelEntry;
  readonly mask: ImageSource;
  readonly texture: ImageSource;
}

export interface LoadedAssets {
  readonly manifest: AssetManifest;
  readonly atlases: ReadonlyMap<string, Atlas>;
  readonly images: ReadonlyMap<string, ImageSource>;
  readonly audio: AudioManifestInfo;
  /** The asset root the audio manifest file paths are relative to. */
  readonly audioBaseUrl: string;
  readonly levels: ReadonlyMap<string, LoadedLevel>;
}

export type LoadErrorCode = 'fetch' | 'manifest' | 'atlas' | 'audio_manifest';

export interface LoadError {
  readonly code: LoadErrorCode;
  readonly url: string;
  /** Fetch attempts made for this url; 0 for validation failures. */
  readonly attempts: number;
  /** Path inside the offending document, null for fetch failures. */
  readonly path: string | null;
  readonly message: string;
}

type Loaded<T> = Result<T, LoadError>;

function fetchError(url: string, failure: RetryFailure): LoadError {
  return Object.freeze({ code: 'fetch' as const, url, attempts: failure.attempts, path: null, message: failure.message });
}

function schemaError(code: LoadErrorCode, url: string, error: { readonly path: string; readonly message: string }): LoadError {
  return Object.freeze({ code, url, attempts: 0, path: error.path, message: `${error.path}: ${error.message}` });
}

/** Counts every fetch the manifest implies, for the progress total. */
export function countFetches(manifest: AssetManifest): number {
  return manifest.atlases.length * 2 + manifest.images.length + 1 + manifest.levels.length * 2;
}

function firstError<T>(results: readonly Loaded<T>[]): LoadError | null {
  for (const result of results) if (!result.ok) return result.error;
  return null;
}

/** Fetches, validates and indexes everything the manifest at manifestUrl lists. */
export async function loadAssets(manifestUrl: string, io: LoaderIo, options: LoadOptions = {}): Promise<Loaded<LoadedAssets>> {
  const policy = options.retry ?? DEFAULT_RETRY_POLICY;
  const root = dirnameUrl(manifestUrl);

  const manifestJson = await withRetry(() => io.fetchJson(manifestUrl), io.delay, policy);
  if (!manifestJson.ok) return err(fetchError(manifestUrl, manifestJson.error));
  const manifest = validateAssetManifest(manifestJson.value);
  if (!manifest.ok) return err(schemaError('manifest', manifestUrl, manifest.error));
  const spec = manifest.value;

  const total = countFetches(spec);
  let loaded = 0;
  const fetchWith = async <T>(path: string, task: (url: string) => Promise<T>): Promise<Loaded<T>> => {
    const url = joinUrl(root, path);
    const result = await withRetry(() => task(url), io.delay, policy);
    if (!result.ok) return err(fetchError(url, result.error));
    loaded += 1;
    options.onProgress?.(Object.freeze({ loaded, total, url }));
    return result;
  };
  const json = (path: string): Promise<Loaded<unknown>> => fetchWith(path, (url) => io.fetchJson(url));
  const image = (path: string): Promise<Loaded<ImageSource>> => fetchWith(path, (url) => io.loadImage(url));

  const [atlasParts, imageParts, audioJson, levelParts] = await Promise.all([
    Promise.all(spec.atlases.map(async (entry) => ({ entry, parts: await Promise.all([image(entry.image), json(entry.json)]) }))),
    Promise.all(spec.images.map(async (entry) => ({ entry, image: await image(entry.src) }))),
    json(spec.audio),
    Promise.all(spec.levels.map(async (entry) => ({ entry, parts: await Promise.all([image(entry.mask), image(entry.texture)]) }))),
  ]);

  const failed = firstError([
    ...atlasParts.flatMap((part) => part.parts as readonly Loaded<unknown>[]),
    ...imageParts.map((part) => part.image),
    audioJson,
    ...levelParts.flatMap((part) => part.parts),
  ]);
  if (failed !== null) return err(failed);

  const atlases = new Map<string, Atlas>();
  for (const { entry, parts } of atlasParts) {
    const [atlasImage, atlasJson] = parts;
    if (!atlasImage.ok || !atlasJson.ok) continue;
    const atlas = loadAtlas(atlasJson.value, atlasImage.value);
    if (!atlas.ok) return err(schemaError('atlas', joinUrl(root, entry.json), atlas.error));
    atlases.set(entry.id, atlas.value);
  }

  const images = new Map<string, ImageSource>();
  for (const { entry, image: loadedImage } of imageParts) if (loadedImage.ok) images.set(entry.id, loadedImage.value);

  if (!audioJson.ok) return err(audioJson.error);
  const audio = validateAudioManifest(audioJson.value);
  if (!audio.ok) return err(schemaError('audio_manifest', joinUrl(root, spec.audio), audio.error));

  const levels = new Map<string, LoadedLevel>();
  for (const { entry, parts } of levelParts) {
    const [mask, texture] = parts;
    if (mask.ok && texture.ok) levels.set(entry.id, Object.freeze({ entry, mask: mask.value, texture: texture.value }));
  }

  return ok(Object.freeze({ manifest: spec, atlases, images, audio: audio.value, audioBaseUrl: root, levels }));
}

/** Browser wiring: fetch plus createImageBitmap, off the main thread where the browser allows. */
export function createBrowserLoaderIo(): LoaderIo {
  const fetchOk = async (url: string): Promise<Response> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  };
  return {
    fetchJson: async (url) => (await fetchOk(url)).json() as Promise<unknown>,
    loadImage: async (url) => createImageBitmap(await (await fetchOk(url)).blob()),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
