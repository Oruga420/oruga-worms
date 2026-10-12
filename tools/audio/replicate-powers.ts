/**
 * Original five-power SFX authoring, never a browser dependency.
 * Default/dry-run: no network or writes. Execution requires --execute --cap-usd 1.
 * Price verified for this pinned model: $0.20/output; at most five single POSTs, no retries.
 * An exclusive, persistent receipt reserves the entire batch before the first POST. Never
 * delete it to retry: interrupted requests may already be billed. Inspect/recover their IDs.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadDotEnv } from '../../sidecar/env.ts';
import { powerSfxItems } from './build-plan.ts';
import { assetFor, minFinalMs, shape } from './generate.ts';
import { measureLevels, probe } from './ffmpeg.ts';
import { loadManifest, statusOf, upsertAsset, type AudioAsset } from './manifest.ts';
import { checkLevels, checkStream, validateClip } from './validate.ts';
import type { SfxItem } from './plan.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RAW_DIR = join(ROOT, 'assets', '_raw', 'audio', 'replicate-powers');
export const MANIFEST_PATH = join(ROOT, 'public', 'audio', 'manifest.json');
export const RECEIPT_PATH = join(RAW_DIR, 'batch-receipt.json');
export const MODEL_VERSION = 'a61ac8edbb27cd2eda1b2eff2bbc03dcff1131f5560836ff77a052df05b77491';
const MODEL = 'stability-ai/stable-audio-2.5';
const API = 'https://api.replicate.com/v1/predictions';
const PRICE_CENTS = 20;
const MAX_CAP_CENTS = 100;
const REQUEST_TIMEOUT_MS = 75_000;
const POLL_LIMIT = 180;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

const PredictionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  status: z.enum(['starting', 'processing', 'succeeded', 'failed', 'canceled']),
  output: z.string().nullable().optional(),
});
type Prediction = z.infer<typeof PredictionSchema>;
interface Entry { readonly id: string; readonly state: 'reserved' | 'posting' | 'accepted' | 'published' | 'failed'; readonly predictionId?: string; readonly error?: string }
interface Receipt { readonly model: string; readonly version: string; readonly createdAt: string; readonly priceCents: number; readonly capCents: number; readonly reservedCents: number; readonly actualBilledUsd: null; readonly entries: readonly Entry[] }
interface Deps { readonly fetcher: typeof fetch; readonly token: () => string | undefined; readonly wait: (ms: number) => Promise<void>; readonly log: (message: string) => void }
const DEFAULTS: Deps = {
  fetcher: fetch,
  token: () => loadDotEnv(join(homedir(), '.claude', 'skills', 'oruga-blender', '.env'))['REPLICATE_API_TOKEN']?.trim(),
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  log: (message) => console.log(message),
};

function message(error: unknown): string { return error instanceof Error ? error.message : 'unknown failure'; }

function prepare(argv: readonly string[], deps: Deps): { items: readonly SfxItem[]; token: string; capCents: number } | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cap-usd') { i += 1; continue; }
    if (argv[i] !== '--execute' && argv[i] !== '--dry-run') throw new Error('unknown argument');
  }
  if (!existsSync(MANIFEST_PATH)) throw new Error('existing audio manifest is required');
  const loaded = loadManifest(MANIFEST_PATH, new Date().toISOString());
  if (!loaded.ok) throw new Error(loaded.error);
  const items = powerSfxItems().filter((item) => statusOf(loaded.value, item.id) !== 'ok');
  const costCents = items.length * PRICE_CENTS;
  deps.log(`Replicate powers: ${items.length} output(s), ${(costCents / 100).toFixed(2)} USD maximum at 0.20 USD/output; duration 2 s, one POST per output.`);
  if (!argv.includes('--execute') || argv.includes('--dry-run') || items.length === 0) return null;
  const capAt = argv.indexOf('--cap-usd');
  const value = capAt >= 0 ? argv[capAt + 1] : undefined;
  const capCents = value !== undefined && /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : Number.NaN;
  if (!Number.isSafeInteger(capCents) || capCents < costCents || capCents > MAX_CAP_CENTS) throw new Error('explicit --cap-usd must cover this batch and must not exceed 1 USD');
  const token = deps.token();
  if (!token) throw new Error('personal REPLICATE_API_TOKEN unavailable');
  return { items, token, capCents };
}

async function readPrediction(response: Response): Promise<Prediction> {
  if (!response.ok) throw new Error(`Replicate HTTP ${response.status}; not retried`);
  const checked = PredictionSchema.safeParse(await response.json());
  if (!checked.success) throw new Error('unexpected Replicate prediction response');
  return checked.data;
}

async function predict(item: SfxItem, seed: number, token: string, deps: Deps, accepted: (id: string) => void): Promise<Prediction> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let prediction = await readPrediction(await deps.fetcher(API, {
    method: 'POST', redirect: 'error', headers: { ...headers, Prefer: 'wait=60' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({ version: MODEL_VERSION, input: { prompt: item.description, duration: 2, steps: 8, cfg_scale: 1, seed } }),
  }));
  accepted(prediction.id);
  for (let poll = 0; poll <= POLL_LIMIT; poll += 1) {
    if (prediction.status === 'succeeded') return prediction;
    if (prediction.status === 'failed' || prediction.status === 'canceled') throw new Error(`prediction ${prediction.status}; not retried`);
    if (poll === POLL_LIMIT) break;
    await deps.wait(1000);
    prediction = await readPrediction(await deps.fetcher(`${API}/${encodeURIComponent(prediction.id)}`, { redirect: 'error', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
  }
  throw new Error('polling limit reached; inspect the recorded prediction ID, do not regenerate');
}

async function download(item: SfxItem, prediction: Prediction, deps: Deps): Promise<string> {
  if (typeof prediction.output !== 'string') throw new Error('prediction has no audio output');
  const url = new URL(prediction.output);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'))) throw new Error('untrusted audio output URL');
  const response = await deps.fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`audio download HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_AUDIO_BYTES) throw new Error('audio download exceeds size limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) throw new Error('invalid audio download size');
  const parent = join(RAW_DIR, item.id);
  mkdirSync(parent, { recursive: true });
  const directory = join(parent, prediction.id);
  mkdirSync(directory); // New, isolated directory for this downloaded output, never reused.
  const raw = join(directory, 'master.wav');
  writeFileSync(raw, buffer, { flag: 'wx' });
  return raw;
}

async function finishAudio(item: SfxItem, raw: string, predictionId: string): Promise<AudioAsset> {
  const info = await probe(raw);
  const levels = await measureLevels(raw);
  if (!info.ok || !levels.ok) throw new Error('raw audio measurement failed');
  const verdict = validateClip(item, info.value, levels.value);
  if (!verdict.ok) throw new Error(`raw audio rejected: ${verdict.reasons.join('; ')}`);
  const shaped = await shape(item, raw);
  if (!shaped.ok) throw new Error(shaped.error);
  if (shaped.value.durationMs < minFinalMs(item)) throw new Error('too little sound survived trimming');
  for (const [relative, codec] of [[shaped.value.ogg, 'vorbis'], [shaped.value.mp3, 'mp3']] as const) {
    const path = join(ROOT, 'public', relative);
    const checked = await probe(path);
    const volume = await measureLevels(path);
    if (!checked.ok || !volume.ok) throw new Error('export measurement failed');
    if (checked.value.codec !== codec || checked.value.durationS * 1000 < minFinalMs(item) || Math.abs(checked.value.durationS * 1000 - shaped.value.durationMs) > 150 || checkStream(checked.value).length > 0 || checkLevels(volume.value).length > 0) throw new Error('export validation failed');
  }
  const source: AudioAsset['source'] = {
    provider: 'replicate', endpoint: '/v1/predictions', model: MODEL, version: MODEL_VERSION, predictionId,
    prompt: item.description, requestedSeconds: 2, attempts: 1, estimatedCostUsd: PRICE_CENTS / 100,
    sha256: createHash('sha256').update(readFileSync(join(ROOT, 'public', shaped.value.ogg))).digest('hex'),
  };
  return assetFor(item, shaped.value, source, [], 'ok');
}

function commitSuccess(asset: AudioAsset): void {
  if (!existsSync(MANIFEST_PATH)) throw new Error('existing manifest disappeared; refusing to replace it');
  const now = new Date().toISOString();
  const fresh = loadManifest(MANIFEST_PATH, now);
  if (!fresh.ok) throw new Error(fresh.error);
  const next = upsertAsset(fresh.value, asset, now);
  const temporary = `${MANIFEST_PATH}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, MANIFEST_PATH);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

async function execute(items: readonly SfxItem[], token: string, initial: Receipt, deps: Deps): Promise<number> {
  let receipt = initial;
  const record = (id: string, patch: Partial<Entry>): void => {
    receipt = { ...receipt, entries: receipt.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) };
    writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  };
  let failed = false;
  for (const [index, item] of items.entries()) {
    record(item.id, { state: 'posting' }); // Durable admission before this item's only POST.
    try {
      const prediction = await predict(item, 20261012 + index, token, deps, (id) => record(item.id, { state: 'accepted', predictionId: id }));
      const raw = await download(item, prediction, deps);
      const asset = await finishAudio(item, raw, prediction.id);
      commitSuccess(asset);
      record(item.id, { state: 'published' });
      deps.log(`${item.id}: published OGG + MP3; estimated 0.20 USD`);
    } catch (error: unknown) {
      failed = true;
      record(item.id, { state: 'failed', error: message(error) });
      deps.log(`${item.id}: failed, no retry: ${message(error)}`);
    }
  }
  return failed ? 1 : 0;
}

export async function run(argv: readonly string[] = process.argv.slice(2), overrides: Partial<Deps> = {}): Promise<number> {
  const deps = { ...DEFAULTS, ...overrides };
  let prepared: ReturnType<typeof prepare>;
  try { prepared = prepare(argv, deps); } catch (error: unknown) { deps.log(message(error)); return 1; }
  if (prepared === null) return 0;
  const { items, token, capCents } = prepared;
  const receipt: Receipt = {
    model: MODEL, version: MODEL_VERSION, createdAt: new Date().toISOString(), priceCents: PRICE_CENTS,
    capCents, reservedCents: items.length * PRICE_CENTS, actualBilledUsd: null,
    entries: items.map((item) => ({ id: item.id, state: 'reserved' })),
  };
  try {
    mkdirSync(RAW_DIR, { recursive: true });
    writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  } catch {
    deps.log('Exclusive receipt could not be created. Do not retry or delete an existing receipt; inspect its prediction IDs.');
    return 2;
  }
  return execute(items, token, receipt, deps);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => { process.exitCode = code; }, () => { console.error('Replicate batch interrupted; inspect the receipt, do not regenerate.'); process.exitCode = 1; });
}
