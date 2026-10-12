import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { measureLevels } from '../../../../tools/audio/ffmpeg.ts';
import { ok } from '../../../../src/core/result.ts';
import { MANIFEST_PATH, RECEIPT_PATH, MODEL_VERSION, run } from '../../../../tools/audio/replicate-powers.ts';
import type { AudioManifest } from '../../../../tools/audio/manifest.ts';

const memory = vi.hoisted(() => new Map<string, string | Buffer>());
vi.mock('node:fs', () => ({
  existsSync: vi.fn((path) => memory.has(String(path))),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((path) => {
    const value = memory.get(String(path));
    if (value === undefined) throw new Error('ENOENT');
    return value;
  }),
  writeFileSync: vi.fn((path, data, options) => {
    if (options?.flag === 'wx' && memory.has(String(path))) throw new Error('EEXIST');
    memory.set(String(path), data);
  }),
  renameSync: vi.fn((from, to) => {
    const data = memory.get(String(from));
    if (data === undefined) throw new Error('ENOENT');
    memory.set(String(to), data);
    memory.delete(String(from));
  }),
  rmSync: vi.fn((path) => memory.delete(String(path))),
}));
vi.mock('../../../../tools/audio/ffmpeg.ts', async (original) => ({
  ...(await original<typeof import('../../../../tools/audio/ffmpeg.ts')>()),
  probe: vi.fn(async (path: string) => ok({ durationS: 2, channels: 1, sampleRate: 44100, codec: path.endsWith('.ogg') ? 'vorbis' : path.endsWith('.mp3') ? 'mp3' : 'pcm_s16le' })),
  measureLevels: vi.fn(async () => ok({ meanDb: -16, maxDb: -1 })),
  decodeAndShape: vi.fn(async () => ok(undefined)),
  normalize: vi.fn(async () => ok({ mode: 'loudnorm', detail: 'test' })),
  exportDual: vi.fn(async (_norm, ogg, mp3) => {
    memory.set(ogg, Buffer.from('ogg audio'));
    memory.set(mp3, Buffer.from('mp3 audio'));
    return ok(undefined);
  }),
}));

const originalAssets = Array.from({ length: 124 }, (_, n) => ({
  id: `existing_${n}`, bus: 'sfx', group: 'weapons', files: { ogg: `audio/sfx/existing_${n}.ogg`, mp3: `audio/sfx/existing_${n}.mp3` },
  durationMs: 1000, loop: false, loopStartMs: 0, loopEndMs: 0, gainDb: 0, pitchVariance: 0, channels: 1,
  source: { provider: 'elevenlabs', endpoint: '/sound-generation', model: 'test', attempts: 1, credits: 40, sha256: 'test' },
  checks: { durationOk: true, silenceOk: true, clipOk: true, reasons: [], normalization: 'test' }, status: 'ok',
}));
const initial = { version: 1, generatedAt: 'old', assets: originalAssets };
const manifest = (): AudioManifest => JSON.parse(String(memory.get(MANIFEST_PATH))) as AudioManifest;

beforeEach(() => {
  vi.clearAllMocks();
  memory.clear();
  memory.set(MANIFEST_PATH, JSON.stringify(initial));
  vi.mocked(measureLevels).mockResolvedValue(ok({ meanDb: -16, maxDb: -1 }));
});

function fakeApi() {
  let sequence = 0;
  return vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      expect(memory.has(RECEIPT_PATH)).toBe(true);
      sequence += 1;
      return Response.json({ id: `prediction${sequence}`, status: 'succeeded', output: `https://replicate.delivery/test/${sequence}.wav` });
    }
    expect(init?.headers).toBeUndefined();
    return new Response('raw audio');
  });
}
const deps = (fetcher: typeof fetch) => ({ fetcher, token: () => 'test-placeholder', wait: async () => undefined, log: () => undefined });

describe('bounded Replicate power sounds', () => {
  it('defaults to a zero-network dry run', async () => {
    const fetcher = fakeApi();
    expect(await run([], deps(fetcher))).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['0', '0.99', '1.01', '2', 'nope'])('rejects cap %s before reserving or sending', async (cap) => {
    const fetcher = fakeApi();
    expect(await run(['--execute', '--cap-usd', cap], deps(fetcher))).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(memory.has(RECEIPT_PATH)).toBe(false);
  });

  it('requires an explicit cap and personal token', async () => {
    const fetcher = fakeApi();
    expect(await run(['--execute'], deps(fetcher))).toBe(1);
    expect(await run(['--execute', '--cap-usd', '1'], { ...deps(fetcher), token: () => undefined })).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('makes exactly five version-pinned two-second POSTs and keeps all 124 original entries', async () => {
    const fetcher = fakeApi();
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(0);
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(5);
    for (const [url, init] of posts) {
      expect(String(url)).toBe('https://api.replicate.com/v1/predictions');
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body))).toMatchObject({ version: MODEL_VERSION, input: { duration: 2, steps: 8, cfg_scale: 1 } });
      expect(JSON.parse(String(init?.body)).input.prompt).toContain('no voices');
    }
    const saved = manifest();
    expect(saved.assets).toHaveLength(129);
    expect(saved.assets.filter((asset) => asset.id.startsWith('existing_'))).toEqual([...originalAssets].sort((a, b) => a.id.localeCompare(b.id)));
    const fresh = saved.assets.filter((asset) => asset.id.startsWith('wpn_'));
    expect(fresh).toHaveLength(5);
    for (const asset of fresh) {
      expect(asset.source).toMatchObject({ provider: 'replicate', model: 'stability-ai/stable-audio-2.5', estimatedCostUsd: 0.2, attempts: 1 });
      expect(asset.source).not.toHaveProperty('credits');
      expect(asset.status).toBe('ok');
    }
    expect(renameSync).toHaveBeenCalledTimes(5);
    expect(vi.mocked(writeFileSync).mock.calls.filter(([path]) => String(path) === MANIFEST_PATH)).toHaveLength(0);
    const receipt = JSON.parse(String(memory.get(RECEIPT_PATH)));
    expect(receipt.reservedCents).toBe(100);
    expect(receipt.entries.every((entry: { state: string }) => entry.state === 'published')).toBe(true);
    expect(readFileSync).toHaveBeenCalledWith(expect.stringMatching(/[\\/]public[\\/]audio[\\/]sfx[\\/]wpn_time_stop\.ogg$/));
  });

  it('blocks an existing exclusive receipt before any paid request', async () => {
    memory.set(RECEIPT_PATH, 'previous receipt, possibly interrupted');
    const fetcher = fakeApi();
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(2);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not retry a rejected POST and leaves the manifest unchanged', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('unavailable', { status: 500 }));
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(manifest().assets).toEqual(originalAssets);
    expect(renameSync).not.toHaveBeenCalled();
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('never publishes failed audio validation or retries to improve it', async () => {
    vi.mocked(measureLevels).mockResolvedValue(ok({ meanDb: -70, maxDb: -40 }));
    const fetcher = fakeApi();
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(5);
    expect(manifest().assets).toEqual(originalAssets);
    expect(renameSync).not.toHaveBeenCalled();
  });

  it('polls an accepted prediction using GET without resubmitting the generation', async () => {
    let sequence = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === 'POST') {
        sequence += 1;
        return Response.json({ id: `prediction${sequence}`, status: 'processing', output: null });
      }
      if (String(url).startsWith('https://api.replicate.com/')) return Response.json({ id: `prediction${sequence}`, status: 'succeeded', output: `https://replicate.delivery/test/${sequence}.wav` });
      expect(init?.headers).toBeUndefined();
      return new Response('raw audio');
    });
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(0);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(5);
    expect(fetcher).toHaveBeenCalledTimes(15);
  });

  it('accepts success on the final allowed polling GET without a fresh POST', async () => {
    let sequence = 0;
    let polls = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === 'POST') {
        sequence += 1;
        polls = 0;
        return Response.json({ id: `prediction${sequence}`, status: 'processing', output: null });
      }
      if (String(url).startsWith('https://api.replicate.com/')) {
        polls += 1;
        return Response.json({ id: `prediction${sequence}`, status: polls === 180 ? 'succeeded' : 'processing', output: polls === 180 ? `https://replicate.delivery/test/${sequence}.wav` : null });
      }
      return new Response('raw audio');
    });
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(0);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(5);
    expect(manifest().assets).toHaveLength(129);
  });

  it.each(['failed', 'canceled'])('records terminal %s predictions without downloads or extra POSTs', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 'prediction1', status, output: null }));
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(renameSync).not.toHaveBeenCalled();
  });

  it('rejects non-Replicate download URLs without exposing the token to them', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 'prediction1', status: 'succeeded', output: 'https://unrelated.example/private' }));
    expect(await run(['--execute', '--cap-usd', '1'], deps(fetcher))).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(renameSync).not.toHaveBeenCalled();
  });
});
