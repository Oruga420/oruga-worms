import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCreditBudget, parseArgs, processItem, readApiKey } from '../../../../tools/audio/generate.ts';
import { createElevenClient, musicBody, sfxBody, ttsBody, type ElevenClient } from '../../../../tools/audio/elevenlabs.ts';
import { measureLevels } from '../../../../tools/audio/ffmpeg.ts';
import { err, ok } from '../../../../src/core/result.ts';
import type { SfxItem } from '../../../../tools/audio/plan.ts';

vi.mock('node:fs', () => ({ existsSync: vi.fn(), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() }));
vi.mock('../../../../tools/audio/ffmpeg.ts', async (original) => ({
  ...(await original<typeof import('../../../../tools/audio/ffmpeg.ts')>()),
  probe: vi.fn(async () => ok({ durationS: 2, channels: 1, sampleRate: 44100, codec: 'vorbis' })),
  measureLevels: vi.fn(async () => ok({ meanDb: -16, maxDb: -1 })),
  decodeAndShape: vi.fn(async () => ok(undefined)),
  normalize: vi.fn(async () => ok({ mode: 'loudnorm', detail: 'test' })),
  exportDual: vi.fn(async () => ok(undefined)),
}));

const ITEM: SfxItem = { kind: 'sfx', id: 'wpn_test', group: 'weapons', bus: 'sfx', description: 'original abstract pulse', seconds: 2, gainDb: 0, loop: false };
const MASTER = Buffer.from('test audio');
function client(): ElevenClient {
  return { sfx: vi.fn(async () => ok(MASTER)), tts: vi.fn(async () => ok(MASTER)), music: vi.fn(async () => ok(MASTER)), subscription: vi.fn(async () => ok({ tier: 'test', used: 0, limit: 1000, remaining: 1000 })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockImplementation((path) => {
    if (!String(path).replaceAll('\\', '/').includes('/public/audio/sfx/')) throw new Error('Hash must read the published export');
    return MASTER;
  });
  vi.mocked(measureLevels).mockResolvedValue(ok({ meanDb: -16, maxDb: -1 }));
});

afterEach(() => vi.unstubAllEnvs());

describe('bounded audio generation', () => {
  it('requires a project or explicitly provided key, never the unrelated global talk2me key', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', undefined);
    expect(readApiKey()).toBeUndefined();
    for (const [path] of vi.mocked(existsSync).mock.calls) expect(String(path)).not.toContain('talk2me');
  });

  it('uses an explicit process key', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-placeholder');
    expect(readApiKey()).toBe('test-placeholder');
  });

  it('accepts a single attempt, retaining the previous three-attempt default', () => {
    expect(parseArgs(['--attempts', '1']).attempts).toBe(1);
    expect(parseArgs([]).attempts).toBe(3);
    expect(parseArgs(['--attempts', '99']).attempts).toBe(3);
  });

  it('preserves an explicit zero cap instead of silently enabling the default budget', () => {
    expect(parseArgs(['--cap', '0']).cap).toBe(0);
    expect(parseArgs(['--min-remaining', '0']).minRemaining).toBe(0);
  });

  it.each([['--cap'], ['--cap', '-1'], ['--cap', 'nope'], ['--cap', '1x'], ['--attempts', '0'], ['--limit', '0'], ['--concurrency', '0']])('rejects malformed explicit limits: %j', (...argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it('hashes the same public export that the manifest serves', async () => {
    const result = await processItem(ITEM, client());
    expect(result.asset?.status).toBe('ok');
    expect(result.asset?.source.sha256).toBe(createHash('sha256').update(MASTER).digest('hex'));
    expect(readFileSync).toHaveBeenCalledWith(expect.stringMatching(/[\\/]public[\\/]audio[\\/]sfx[\\/]wpn_test\.ogg$/));
  });

  it('uses the public export for rejected placeholders too', async () => {
    vi.mocked(measureLevels).mockResolvedValue(ok({ meanDb: -70, maxDb: -40 }));
    const result = await processItem(ITEM, client(), false, { attempts: 1 });
    expect(result.asset?.status).toBe('placeholder');
    expect(result.credits).toBe(80);
  });

  it('does not retry a failed request in single-attempt mode', async () => {
    const api = client();
    vi.mocked(api.sfx).mockResolvedValue(err('http 503'));
    const result = await processItem(ITEM, api, false, { attempts: 1 });
    expect(api.sfx).toHaveBeenCalledTimes(1);
    expect(result.credits).toBe(80);
    expect(result.asset).toBeNull();
  });

  it('reserves credits before concurrent workers and retries can issue a request', async () => {
    const budget = createCreditBudget(160);
    const api = client();
    vi.mocked(api.sfx).mockResolvedValue(err('http 503'));
    const outcomes = await Promise.all([1, 2, 3].map((n) => processItem({ ...ITEM, id: `wpn_test_${n}` }, api, false, { attempts: 3, reserve: budget.reserve })));
    expect(api.sfx).toHaveBeenCalledTimes(2);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.credits, 0)).toBe(160);
    expect(budget.used()).toBe(160);
  });

  it('rejects a request larger than the remaining estimate without writing a raw file', async () => {
    const api = client();
    const budget = createCreditBudget(79);
    const result = await processItem(ITEM, api, false, { reserve: budget.reserve });
    expect(api.sfx).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(result.credits).toBe(0);
    expect(result.log).toContain('cap');
  });

  it('never turns a missing raw master in reprocess mode into paid generation', async () => {
    const api = client();
    const result = await processItem(ITEM, api, true);
    expect(api.sfx).not.toHaveBeenCalled();
    expect(result.asset).toBeNull();
    expect(result.credits).toBe(0);
    expect(result.log).toContain('raw');
  });

  it('reprocesses an existing master without reserving or generating', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const api = client();
    const reserve = vi.fn(() => false);
    const result = await processItem(ITEM, api, true, { reserve });
    expect(result.asset?.status).toBe('ok');
    expect(result.credits).toBe(0);
    expect(api.sfx).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('does not accept negative, zero or nonfinite budget reservations', () => {
    const budget = createCreditBudget(80);
    for (const cost of [-80, 0, Number.NaN, Number.POSITIVE_INFINITY]) expect(budget.reserve(cost)).toBe(false);
    expect(budget.used()).toBe(0);
    expect(budget.reserve(80)).toBe(true);
    expect(budget.reserve(1)).toBe(false);
  });

  it('rejects invalid caps', () => {
    for (const cap of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => createCreditBudget(cap)).toThrow();
  });
});

describe('generation transport requests', () => {
  const settings = { stability: 0.5, similarity_boost: 0.5, style: 0, use_speaker_boost: false, speed: 1 };

  it('bounds endpoint inputs and preserves explicitly selected models', () => {
    expect(sfxBody('pulse', 0, 2, true)).toMatchObject({ duration_seconds: 0.5, prompt_influence: 1, loop: true, model_id: 'eleven_text_to_sound_v2' });
    expect(sfxBody('pulse', 50, -1, false)).toMatchObject({ duration_seconds: 30, prompt_influence: 0 });
    expect(ttsBody('hello', settings)).not.toHaveProperty('seed');
    expect(ttsBody('hello', settings, 1001)).toMatchObject({ seed: 1001, model_id: 'eleven_multilingual_v2' });
    expect(musicBody('pulse', 1)).toMatchObject({ music_length_ms: 3000, force_instrumental: true });
    expect(musicBody('pulse', 900000)).toMatchObject({ music_length_ms: 600000 });
  });

  it('returns audio for one request per explicit generation call', async () => {
    const fetcher = vi.fn(async () => new Response('test audio'));
    const api = createElevenClient('test-placeholder', fetcher);
    expect(await api.sfx('pulse', 2, 0.3, false)).toEqual(ok(MASTER));
    expect(await api.tts('voice/example', 'hello', settings, 1001)).toEqual(ok(MASTER));
    expect(await api.music('pulse', 3000)).toEqual(ok(MASTER));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/text-to-speech/voice%2Fexample?'), expect.objectContaining({ method: 'POST' }));
  });

  it('returns generation network failures without retry', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    expect(await createElevenClient('test-placeholder', fetcher).sfx('pulse', 2, 0.3, false)).toEqual(err('network: offline'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads allowance without sending a generation POST', async () => {
    const fetcher = vi.fn(async () => Response.json({ tier: 'test', character_count: 40, character_limit: 100 }));
    expect(await createElevenClient('test-placeholder', fetcher).subscription()).toEqual(ok({ tier: 'test', used: 40, limit: 100, remaining: 60 }));
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/user\/subscription$/), expect.not.objectContaining({ method: 'POST' }));
  });

  it('treats absent allowance fields as zero remaining, not unlimited', async () => {
    const api = createElevenClient('test-placeholder', async () => Response.json({}));
    expect(await api.subscription()).toEqual(ok({ tier: 'unknown', used: 0, limit: 0, remaining: 0 }));
  });

  it('returns subscription HTTP and network failures', async () => {
    expect((await createElevenClient('test-placeholder', async () => new Response('denied', { status: 401 })).subscription()).ok).toBe(false);
    expect(await createElevenClient('test-placeholder', async () => { throw new Error('offline'); }).subscription()).toEqual(err('network: offline'));
  });

  it.each([429, 500])('does not hide a second billable POST after HTTP %s', async (status) => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async () => new Response('unavailable', { status }));
      const api = createElevenClient('test-placeholder', fetcher);
      const pending = api.sfx(ITEM.description, 2, 0.3, false);
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
