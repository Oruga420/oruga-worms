import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { main } from '../../../../tools/audio/generate.ts';
import { createElevenClient, type ElevenClient } from '../../../../tools/audio/elevenlabs.ts';
import { err, ok } from '../../../../src/core/result.ts';
import type { SfxItem } from '../../../../tools/audio/plan.ts';

vi.mock('node:fs', () => ({ existsSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('../../../../tools/audio/elevenlabs.ts', async (original) => ({ ...(await original<typeof import('../../../../tools/audio/elevenlabs.ts')>()), createElevenClient: vi.fn() }));
vi.mock('../../../../tools/audio/ffmpeg.ts', async (original) => ({
  ...(await original<typeof import('../../../../tools/audio/ffmpeg.ts')>()),
  probe: vi.fn(async () => ok({ durationS: 2, channels: 1, sampleRate: 44100, codec: 'vorbis' })),
  measureLevels: vi.fn(async () => ok({ meanDb: -16, maxDb: -1 })),
  decodeAndShape: vi.fn(async () => ok(undefined)),
  normalize: vi.fn(async () => ok({ mode: 'loudnorm', detail: 'test' })),
  exportDual: vi.fn(async () => ok(undefined)),
}));

const ITEM: SfxItem = { kind: 'sfx', id: 'wpn_test', group: 'weapons', bus: 'sfx', description: 'original abstract pulse', seconds: 2, gainDb: 0, loop: false };
const ITEMS = [1, 2, 3, 4, 5].map((n) => ({ ...ITEM, id: `wpn_test_${n}` }));
const PLAN = JSON.stringify({ version: 1, generatedAt: 'test', source: 'test', items: ITEMS });
let api: ElevenClient;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-placeholder');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockImplementation((path) => String(path).endsWith('sounds.plan.json') ? PLAN : Buffer.from('test audio'));
  api = {
    sfx: vi.fn(async () => ok(Buffer.from('test audio'))),
    tts: vi.fn(async () => err('not requested')),
    music: vi.fn(async () => err('not requested')),
    subscription: vi.fn(async () => ok({ tier: 'test', used: 0, limit: 100000, remaining: 100000 })),
  };
  vi.mocked(createElevenClient).mockReturnValue(api);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('audio CLI budget wiring', () => {
  it('dry-runs the selected prefix without authentication, writes or generation', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', undefined);
    expect(await main(['--dry-run', '--only', 'wpn_test', '--limit', '5', '--attempts', '1', '--cap', '400'])).toBe(0);
    expect(createElevenClient).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('5 item(s) selected, about 400'));
  });

  it('finishes exactly five single requests at the cap and persists each asset', async () => {
    expect(await main(['--limit', '5', '--attempts', '1', '--concurrency', '4', '--cap', '400'])).toBe(0);
    expect(api.sfx).toHaveBeenCalledTimes(5);
    const writes = vi.mocked(writeFileSync).mock.calls.filter(([path]) => String(path).endsWith('manifest.json'));
    expect(writes).toHaveLength(5);
    const saved = JSON.parse(String(writes.at(-1)?.[1])) as { assets: unknown[] };
    expect(saved.assets).toHaveLength(5);
  });

  it('stops concurrent workers before a request would cross the cap', async () => {
    expect(await main(['--attempts', '1', '--concurrency', '4', '--cap', '80'])).toBe(2);
    expect(api.sfx).toHaveBeenCalledTimes(1);
  });

  it('keeps the subscription floor when the command cap is larger', async () => {
    vi.mocked(api.subscription).mockResolvedValue(ok({ tier: 'test', used: 0, limit: 20080, remaining: 20080 }));
    expect(await main(['--attempts', '1', '--concurrency', '4', '--cap', '400'])).toBe(2);
    expect(api.sfx).toHaveBeenCalledTimes(1);
  });

  it('returns failure for failed single attempts rather than reporting success', async () => {
    vi.mocked(api.sfx).mockResolvedValue(err('http 401'));
    expect(await main(['--limit', '1', '--attempts', '1'])).toBe(1);
    expect(api.sfx).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate when selection is empty', async () => {
    expect(await main(['--only', 'not_a_power'])).toBe(0);
    expect(createElevenClient).not.toHaveBeenCalled();
  });

  it('requires an explicit personal project key before contacting the service', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', undefined);
    expect(await main([])).toBe(1);
    expect(createElevenClient).not.toHaveBeenCalled();
  });

  it('fails closed when subscription access is denied', async () => {
    vi.mocked(api.subscription).mockResolvedValue(err('http 401'));
    expect(await main([])).toBe(1);
    expect(api.sfx).not.toHaveBeenCalled();
  });

  it('fails closed when allowance is below the requested floor', async () => {
    vi.mocked(api.subscription).mockResolvedValue(ok({ tier: 'test', used: 0, limit: 10, remaining: 10 }));
    expect(await main([])).toBe(1);
    expect(api.sfx).not.toHaveBeenCalled();
  });

  it('rejects malformed plans without contacting the service', async () => {
    vi.mocked(readFileSync).mockReturnValue('{');
    expect(await main([])).toBe(1);
    expect(createElevenClient).not.toHaveBeenCalled();
  });

  it('rejects malformed existing manifests without contacting the service', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((path) => String(path).endsWith('sounds.plan.json') ? PLAN : '{');
    expect(await main([])).toBe(1);
    expect(createElevenClient).not.toHaveBeenCalled();
  });
});
