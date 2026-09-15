/**
 * The agentic sound loop (sound-pipeline.md section 8, ultraplan rev 2 Phase 1G):
 *
 *   node tools/audio/generate.ts [--dry-run] [--only weapons,ui,voice_en] [--limit N] [--force]
 *                                [--concurrency 3] [--cap 12000] [--min-remaining 20000]
 *
 * For every plan item not yet ok in the manifest: generate with ElevenLabs (up to 3 attempts,
 * rising prompt influence for SFX, a new seed for voice, one attempt for music), validate the raw
 * clip with ffprobe and volumedetect, shape it (trim one shots, pitch shift voice), normalize
 * (two pass loudnorm or a peak target for very short clips), export ogg and mp3, and upsert the
 * manifest immediately so the run can resume. Spend is capped per run and the subscription is
 * read as a gate before the first call. The key is read from ~/.claude/talk2me/.env or the
 * environment and never printed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok, type Result } from '../../src/core/result.ts';
import { loadDotEnv, mergeEnv } from '../../sidecar/env.ts';
import { createElevenClient, MUSIC_MODEL, SFX_MODEL, TTS_MODEL, type ElevenClient } from './elevenlabs.ts';
import { decodeAndShape, exportDual, measureLevels, normalize, probe, TARGETS } from './ffmpeg.ts';
import { loadManifest, saveManifest, statusOf, summarize, upsertAsset, type AudioAsset, type AudioManifest } from './manifest.ts';
import { estimateCredits, loadPlan, type PlanItem, type SoundPlan } from './plan.ts';
import { promptInfluenceFor, validateClip } from './validate.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const PLAN_PATH = resolve(ROOT, 'tools', 'audio', 'sounds.plan.json');
export const MANIFEST_PATH = resolve(ROOT, 'public', 'audio', 'manifest.json');
const OUT_DIR = resolve(ROOT, 'public', 'audio');
const RAW_DIR = resolve(ROOT, 'assets', '_raw', 'audio');
const WORK_DIR = resolve(RAW_DIR, '_work');

export interface Args {
  readonly dryRun: boolean;
  readonly only: readonly string[];
  readonly limit: number;
  readonly force: boolean;
  /** Reuse the latest raw master already on disk instead of calling the API (zero spend re validation). */
  readonly reprocess: boolean;
  readonly concurrency: number;
  readonly cap: number;
  readonly minRemaining: number;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const int = (value: string | undefined, fallback: number): number => {
    const n = value === undefined ? Number.NaN : Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const only = get('--only');
  return {
    dryRun: argv.includes('--dry-run'),
    only: only === undefined ? [] : only.split(',').map((s) => s.trim()).filter((s) => s !== ''),
    limit: int(get('--limit'), Number.MAX_SAFE_INTEGER),
    force: argv.includes('--force'),
    reprocess: argv.includes('--reprocess'),
    concurrency: Math.min(4, int(get('--concurrency'), 3)),
    cap: int(get('--cap'), 12_000),
    minRemaining: int(get('--min-remaining'), 20_000),
  };
}

export function selectItems(plan: SoundPlan, manifest: AudioManifest, args: Args): readonly PlanItem[] {
  return plan.items
    .filter((item) => args.only.length === 0 || args.only.some((o) => item.group === o || item.id.startsWith(o) || item.kind === o))
    .filter((item) => args.force || statusOf(manifest, item.id) !== 'ok')
    .slice(0, args.limit);
}

function attemptsFor(item: PlanItem): number {
  return item.kind === 'music' ? 1 : 3;
}

/** After trimming, a one shot must keep at least this much sound or the take was near silence (wpn_bat_crack came back as 38 ms). */
export function minFinalMs(item: PlanItem): number {
  if (item.kind === 'sfx' && !item.loop) return Math.max(120, Math.round(item.seconds * 1000 * 0.25));
  if (item.kind === 'voice') return 400;
  return 0;
}

async function generate(item: PlanItem, client: ElevenClient, attempt: number): Promise<Result<{ buffer: Buffer; influence?: number }, string>> {
  if (item.kind === 'sfx') {
    const influence = promptInfluenceFor(attempt);
    const result = await client.sfx(item.description, item.seconds, influence, item.loop);
    return result.ok ? ok({ buffer: result.value, influence }) : result;
  }
  if (item.kind === 'voice') {
    const result = await client.tts(item.voiceId, item.text, item.settings, 1000 + attempt);
    return result.ok ? ok({ buffer: result.value }) : result;
  }
  const result = await client.music(item.prompt, item.lengthMs);
  return result.ok ? ok({ buffer: result.value }) : result;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sourceFor(item: PlanItem, attempts: number, credits: number, influence: number | undefined, sha: string): AudioAsset['source'] {
  if (item.kind === 'sfx') {
    return { provider: 'elevenlabs', endpoint: '/v1/sound-generation', model: SFX_MODEL, prompt: item.description, requestedSeconds: item.seconds, attempts, credits, sha256: sha, ...(influence === undefined ? {} : { promptInfluence: influence }) };
  }
  if (item.kind === 'voice') {
    return { provider: 'elevenlabs', endpoint: '/v1/text-to-speech', model: TTS_MODEL, text: item.text, voiceId: item.voiceId, attempts, credits, sha256: sha };
  }
  return { provider: 'elevenlabs', endpoint: '/v1/music', model: MUSIC_MODEL, prompt: item.prompt, requestedSeconds: item.lengthMs / 1000, attempts, credits, sha256: sha };
}

interface Shaped {
  readonly ogg: string;
  readonly mp3: string;
  readonly durationMs: number;
  readonly channels: number;
  readonly normalization: string;
}

async function shape(item: PlanItem, rawFile: string): Promise<Result<Shaped, string>> {
  mkdirSync(WORK_DIR, { recursive: true });
  const busDir = join(OUT_DIR, item.bus);
  mkdirSync(busDir, { recursive: true });
  const work = join(WORK_DIR, `${item.id}.work.wav`);
  const norm = join(WORK_DIR, `${item.id}.norm.wav`);
  const isLoop = (item.kind === 'sfx' && item.loop) || item.kind === 'music';
  const mono = item.kind === 'voice' || (item.kind === 'sfx' && !(item.loop && item.group === 'world'));
  const shaped = await decodeAndShape(rawFile, work, {
    trim: item.kind === 'sfx' && !item.loop,
    ...(item.kind === 'voice' ? { pitch: { factor: item.pitchFactor, tempo: item.tempo } } : {}),
    target: TARGETS[item.bus],
    mono,
  });
  if (!shaped.ok) return shaped;
  const info = await probe(work);
  if (!info.ok) return info;
  const normalized = await normalize(work, norm, info.value.durationS, TARGETS[item.bus]);
  if (!normalized.ok) return normalized;
  const ogg = join(busDir, `${item.id}.ogg`);
  const mp3 = join(busDir, `${item.id}.mp3`);
  const exported = await exportDual(norm, ogg, mp3);
  if (!exported.ok) return exported;
  const finalInfo = await probe(ogg);
  if (!finalInfo.ok) return finalInfo;
  return ok({
    ogg: `audio/${item.bus}/${item.id}.ogg`,
    mp3: `audio/${item.bus}/${item.id}.mp3`,
    durationMs: Math.round(finalInfo.value.durationS * 1000),
    channels: finalInfo.value.channels,
    normalization: `${normalized.value.mode}: ${normalized.value.detail}${isLoop ? ', loop kept untrimmed' : ''}`,
  });
}

function assetFor(item: PlanItem, shaped: Shaped, source: AudioAsset['source'], reasons: readonly string[], status: AudioAsset['status']): AudioAsset {
  const loop = (item.kind === 'sfx' && item.loop) || item.kind === 'music';
  return {
    id: item.id,
    bus: item.bus,
    group: item.group,
    files: { ogg: shaped.ogg, mp3: shaped.mp3 },
    durationMs: shaped.durationMs,
    loop,
    loopStartMs: item.kind === 'music' ? item.loopStartMs : 0,
    loopEndMs: item.kind === 'music' ? Math.min(item.loopEndMs, shaped.durationMs) : loop ? shaped.durationMs : 0,
    gainDb: item.gainDb,
    pitchVariance: item.kind === 'sfx' && !item.loop ? 0.08 : 0,
    channels: shaped.channels,
    source,
    checks: {
      durationOk: !reasons.some((r) => r.includes('duration') || r.includes('too short') || r.includes('too long')),
      silenceOk: !reasons.some((r) => r.includes('quiet')),
      clipOk: !reasons.some((r) => r.includes('clipped')),
      reasons,
      normalization: shaped.normalization,
    },
    status,
  };
}

export interface ItemOutcome {
  readonly asset: AudioAsset | null;
  readonly credits: number;
  readonly log: string;
}

/** Latest raw master on disk for an item (attempt 3, then 2, then 1), or null. */
export function latestRawFor(item: PlanItem): { readonly path: string; readonly attempt: number } | null {
  for (let attempt = 3; attempt >= 1; attempt -= 1) {
    const path = join(RAW_DIR, `${item.id}.a${attempt}.mp3`);
    if (existsSync(path)) return { path, attempt };
  }
  return null;
}

export async function processItem(item: PlanItem, client: ElevenClient, reprocess = false): Promise<ItemOutcome> {
  mkdirSync(RAW_DIR, { recursive: true });
  let credits = 0;
  let lastRaw: string | null = null;
  let lastReasons: readonly string[] = [];
  let lastInfluence: number | undefined;
  const existing = reprocess ? latestRawFor(item) : null;
  const maxAttempts = existing === null ? attemptsFor(item) : existing.attempt;
  const firstAttempt = existing === null ? 1 : existing.attempt;
  for (let attempt = firstAttempt; attempt <= maxAttempts; attempt += 1) {
    let raw: string;
    if (existing !== null) {
      raw = existing.path;
    } else {
      const generated = await generate(item, client, attempt);
      credits += estimateCredits(item);
      if (!generated.ok) {
        lastReasons = [`attempt ${attempt}: ${generated.error}`];
        continue;
      }
      raw = join(RAW_DIR, `${item.id}.a${attempt}.mp3`);
      writeFileSync(raw, generated.value.buffer);
      lastInfluence = generated.value.influence;
    }
    lastRaw = raw;
    const info = await probe(raw);
    const levels = info.ok ? await measureLevels(raw) : err(info.error);
    if (!info.ok || !levels.ok) {
      lastReasons = [`attempt ${attempt}: ${info.ok ? (levels.ok ? '' : levels.error) : info.error}`];
      continue;
    }
    const verdict = validateClip(item, info.value, levels.value);
    if (!verdict.ok) {
      lastReasons = verdict.reasons.map((r) => `attempt ${attempt}: ${r}`);
      continue;
    }
    const shaped = await shape(item, raw);
    if (!shaped.ok) {
      lastReasons = [`attempt ${attempt}: ${shaped.error}`];
      continue;
    }
    const minFinal = minFinalMs(item);
    if (shaped.value.durationMs < minFinal) {
      lastReasons = [`attempt ${attempt}: only ${shaped.value.durationMs} ms of sound survived trimming (minimum ${minFinal} ms), the model returned near silence`];
      if (existing !== null) break;
      continue;
    }
    const asset = assetFor(item, shaped.value, sourceFor(item, attempt, credits, lastInfluence, sha256(join(ROOT, 'assets', shaped.value.ogg))), [], 'ok');
    return { asset, credits, log: `${item.id}: ok in ${attempt} attempt(s), ${shaped.value.durationMs} ms, ${shaped.value.normalization}, ~${credits} credits` };
  }
  if (lastRaw !== null) {
    const shaped = await shape(item, lastRaw);
    if (shaped.ok) {
      const asset = assetFor(item, shaped.value, sourceFor(item, maxAttempts, credits, lastInfluence, sha256(join(ROOT, 'assets', shaped.value.ogg))), lastReasons, 'placeholder');
      return { asset, credits, log: `${item.id}: PLACEHOLDER after ${maxAttempts} attempts (${lastReasons.join('; ')}), ~${credits} credits` };
    }
  }
  return { asset: null, credits, log: `${item.id}: FAILED (${lastReasons.join('; ')}), ~${credits} credits` };
}

function readApiKey(): string | undefined {
  const home = process.env['USERPROFILE'] ?? homedir();
  const env = mergeEnv(loadDotEnv(join(home, '.claude', 'talk2me', '.env')), loadDotEnv(resolve(ROOT, '.env')), process.env);
  const key = env['ELEVENLABS_API_KEY'];
  return key === undefined || key.trim() === '' ? undefined : key.trim();
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date().toISOString();
  const plan = loadPlan(PLAN_PATH);
  if (!plan.ok) {
    console.error(`generate: ${plan.error}`);
    return 1;
  }
  const loaded = loadManifest(MANIFEST_PATH, now);
  if (!loaded.ok) {
    console.error(`generate: ${loaded.error}`);
    return 1;
  }
  let manifest = loaded.value;
  const items = selectItems(plan.value, manifest, args);
  const planned = items.reduce((sum, item) => sum + estimateCredits(item), 0);
  console.log(`generate: ${items.length} item(s) selected, about ${planned} credits at list price (cap ${args.cap} per run)`);
  if (args.dryRun) {
    for (const item of items) console.log(`  ${item.kind.padEnd(5)} ${item.id.padEnd(40)} ~${estimateCredits(item)} credits`);
    return 0;
  }
  if (items.length === 0) return 0;
  const apiKey = readApiKey();
  if (apiKey === undefined) {
    console.error('generate: ELEVENLABS_API_KEY not found (~/.claude/talk2me/.env or environment)');
    return 1;
  }
  const client = createElevenClient(apiKey);
  const before = await client.subscription();
  if (!before.ok) {
    console.error(`generate: subscription check failed: ${before.error}`);
    return 1;
  }
  console.log(`generate: subscription ${before.value.tier}, ${before.value.remaining} credits remaining`);
  if (before.value.remaining < args.minRemaining) {
    console.error(`generate: remaining credits below the ${args.minRemaining} floor, aborting`);
    return 1;
  }

  let spent = 0;
  let index = 0;
  let okCount = 0;
  let failCount = 0;
  const worker = async (): Promise<void> => {
    while (index < items.length) {
      if (spent >= args.cap) return;
      const item = items[index];
      index += 1;
      if (item === undefined) return;
      const outcome = await processItem(item, client, args.reprocess);
      spent += outcome.credits;
      console.log(outcome.log);
      if (outcome.asset !== null) {
        manifest = upsertAsset(manifest, outcome.asset, new Date().toISOString());
        saveManifest(MANIFEST_PATH, manifest);
        if (outcome.asset.status === 'ok') okCount += 1;
        else failCount += 1;
      } else {
        failCount += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  const after = await client.subscription();
  const measured = after.ok ? after.value.used - before.value.used : Number.NaN;
  const totals = summarize(manifest);
  console.log(`generate: done. ok ${okCount}, failed or placeholder ${failCount}, estimated ${spent} credits, measured ${Number.isFinite(measured) ? measured : 'n/a'} (subscription counter lags). Manifest: ${totals.ok} ok, ${totals.placeholder} placeholder, ${totals.failed} failed.`);
  return spent >= args.cap && index < items.length ? 2 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`generate: unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
