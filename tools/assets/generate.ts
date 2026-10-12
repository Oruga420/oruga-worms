/**
 * Parent-executed, dry-run-default preparation of three base images. No paid retry.
 * An exclusive batch receipt is written BEFORE the first POST; ambiguous failures
 * stay locked for manual inspection, preventing a second invocation double-spending.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ASSET_PLAN, EXPECTED_TOTAL_USD, KAME_REFERENCE_METADATA, MODEL, buildImageInput, validateBudget } from './plan.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.replicate.com/v1';
const RECEIPT = join(ROOT, 'tools/assets/runs/base-props-v1.json');
const OUTPUT = join(ROOT, 'public/scenery/candidates');
const TERMINAL = ['succeeded', 'failed', 'canceled'];
interface Prediction {
  readonly id: string;
  readonly status: string;
  readonly output?: string | readonly string[] | null;
}

function argument(argv: readonly string[], key: string): string | undefined {
  const index = argv.indexOf(key);
  return index < 0 ? undefined : argv[index + 1];
}

async function personalToken(): Promise<string> {
  const env = await readFile(join(homedir(), '.claude/skills/oruga-blender/.env'), 'utf8');
  const value = env.match(/^REPLICATE_API_TOKEN\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!value || /\s/.test(value)) throw new Error('Personal Replicate credential is absent or malformed.');
  return value;
}

async function attachedReferences(root: string): Promise<readonly string[]> {
  return Promise.all(KAME_REFERENCE_METADATA.map(async (entry) => {
    const bytes = await readFile(join(root, entry.file));
    if (bytes.length > 10 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('A Kame reference is not a supported JPEG or exceeds 10 MB.');
    }
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  }));
}

async function request(path: string, key: string, input?: ReturnType<typeof buildImageInput>): Promise<Prediction> {
  const response = await fetch(`${API}/${path}`, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    ...(input === undefined ? {} : { body: JSON.stringify({ input }) }),
    signal: AbortSignal.timeout(90000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Replicate returned HTTP ${response.status}; batch remains locked, no retry.`);
  const result = await response.json() as Partial<Prediction>;
  if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.id) || typeof result.status !== 'string') {
    throw new Error('Unexpected prediction response; batch remains locked.');
  }
  return result as Prediction;
}

async function completedPrediction(start: Prediction, key: string): Promise<Prediction> {
  let current = start;
  for (let attempt = 0; attempt < 120 && !TERMINAL.includes(current.status); attempt += 1) {
    await delay(4000);
    current = await request(`predictions/${current.id}`, key);
  }
  if (current.status !== 'succeeded') throw new Error(`Prediction ${current.id} ended ${current.status}; no new request will be made.`);
  return current;
}

async function saveOutput(result: Prediction, id: string): Promise<string> {
  const raw = typeof result.output === 'string' ? result.output : result.output?.[0];
  if (typeof raw !== 'string') throw new Error('Prediction has no image output.');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !(url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'))) {
    throw new Error('Unexpected image output host.');
  }
  // Credentials never accompany the public delivery request.
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Image download failed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Output is not a supported PNG or exceeds 20 MB.');
  }
  const folder = join(OUTPUT, id);
  await mkdir(folder);
  const path = join(folder, 'base.png');
  await writeFile(path, bytes, { flag: 'wx' });
  return path;
}

export async function main(argv: readonly string[]): Promise<void> {
  const execute = argv.includes('--execute');
  const referenceRoot = argument(argv, '--reference-root');
  const budget = Number(argument(argv, '--budget-usd'));
  const summary = { mode: execute ? 'execute' : 'dry-run', model: MODEL, quality: 'high', images: 3, expectedUsd: EXPECTED_TOTAL_USD, approval: 'Base images only; downstream production requires review.', assets: ASSET_PLAN.map(({ id }) => id) };
  if (!execute) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  validateBudget(budget);
  if (!referenceRoot) throw new Error('--reference-root is required for the two viewed Kame reference images.');
  const refs = await attachedReferences(referenceRoot);
  const key = await personalToken();
  const plan = ASSET_PLAN.map(({ id }) => ({ id, input: buildImageInput(id, id === 'kame-house' ? refs : []) }));
  await mkdir(dirname(RECEIPT), { recursive: true });
  await mkdir(OUTPUT, { recursive: true });
  const metadata = { ...summary, started: new Date().toISOString(), referenceSources: KAME_REFERENCE_METADATA };
  await writeFile(RECEIPT, JSON.stringify(metadata, null, 2), { flag: 'wx' });
  for (const item of plan) {
    const started = await request(`models/${MODEL}/predictions`, key, item.input);
    const receipt = join(dirname(RECEIPT), `${item.id}.json`);
    await writeFile(receipt, JSON.stringify({ id: started.id, asset: item.id, status: started.status }, null, 2), { flag: 'wx' });
    const complete = await completedPrediction(started, key);
    const file = await saveOutput(complete, item.id);
    await writeFile(receipt, JSON.stringify({ id: complete.id, asset: item.id, status: complete.status, file }, null, 2));
    process.stdout.write(`${JSON.stringify({ asset: item.id, file, status: complete.status })}\n`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Image preparation failed.'}\n`);
    process.exitCode = 1;
  });
}
