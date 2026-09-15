import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_MAX } from '@/config/constants.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';
import {
  DEFAULT_RETRY_POLICY,
  backoffMs,
  countFetches,
  loadAssets,
  validateAssetManifest,
  withRetry,
  type LoadProgress,
  type LoaderIo,
} from '@/engine/loader.ts';

type Json = Record<string, unknown>;

const URLS = {
  manifest: '/assets/manifest.json',
  atlasImage: '/assets/atlases/worm_base.png',
  atlasJson: '/assets/atlases/worm_base.json',
  sky: '/assets/images/bg_sky.png',
  audio: '/assets/audio/manifest.json',
  mask: '/assets/levels/island_mask.png',
  texture: '/assets/levels/island_tex.png',
} as const;

const ATLAS_JSON: Json = {
  meta: { image: 'worm_base.png', size: { w: 1024, h: 1024 } },
  frames: {
    worm_walk_00: { frame: { x: 0, y: 0, w: 96, h: 96 } },
    worm_walk_01: { frame: { x: 96, y: 0, w: 96, h: 96 } },
  },
  animations: { walk: { frames: ['worm_walk_00', 'worm_walk_01'], fps: 18, loop: true } },
};

const AUDIO_JSON: Json = {
  version: 1,
  assets: [{ id: 'shot', bus: 'sfx', files: { ogg: 'audio/shot.ogg', mp3: 'audio/shot.mp3' }, durationMs: 100, status: 'ok' }],
};

function manifest(overrides: Json = {}): Json {
  return {
    version: 1,
    atlases: [{ id: 'worm_base', image: 'atlases/worm_base.png', json: 'atlases/worm_base.json' }],
    images: [{ id: 'bg_sky', src: 'images/bg_sky.png' }],
    audio: 'audio/manifest.json',
    levels: [{ id: 'island', mask: 'levels/island_mask.png', texture: 'levels/island_tex.png', width: 1920, height: 696 }],
    ...overrides,
  };
}

interface FakeIoScript {
  readonly json?: Readonly<Record<string, unknown>>;
  /** Number of times each url fails before it succeeds. */
  readonly failures?: Readonly<Record<string, number>>;
}

function fakeIo(script: FakeIoScript = {}) {
  const calls: string[] = [];
  const delays: number[] = [];
  const failuresLeft = new Map(Object.entries(script.failures ?? {}));
  const json: Readonly<Record<string, unknown>> = script.json ?? {
    [URLS.manifest]: manifest(),
    [URLS.atlasJson]: ATLAS_JSON,
    [URLS.audio]: AUDIO_JSON,
  };
  const maybeFail = (url: string): void => {
    const left = failuresLeft.get(url) ?? 0;
    if (left > 0) {
      failuresLeft.set(url, left - 1);
      throw new Error(`boom ${url}`);
    }
  };
  const io: LoaderIo = {
    fetchJson: async (url) => {
      calls.push(`json ${url}`);
      maybeFail(url);
      if (!(url in json)) throw new Error(`404 ${url}`);
      return json[url];
    },
    loadImage: async (url) => {
      calls.push(`image ${url}`);
      maybeFail(url);
      return { url } as unknown as ImageSource;
    },
    delay: async (ms) => {
      delays.push(ms);
    },
  };
  return { io, calls, delays };
}

function expectManifestError(input: unknown, code: string, path: string): void {
  const result = validateAssetManifest(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.path).toBe(path);
  }
}

describe('loader: asset manifest schema', () => {
  it('accepts the documented shape and freezes it', () => {
    const result = validateAssetManifest(manifest({ extra: 'ignored' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.atlases[0]).toEqual({ id: 'worm_base', image: 'atlases/worm_base.png', json: 'atlases/worm_base.json' });
    expect(result.value.levels[0]).toMatchObject({ id: 'island', width: 1920, height: 696 });
    expect(result.value.audio).toBe('audio/manifest.json');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(countFetches(result.value)).toBe(6);
  });

  it('treats missing lists as empty but requires the audio manifest path', () => {
    const result = validateAssetManifest({ version: 1, audio: 'audio/manifest.json' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(countFetches(result.value)).toBe(1);
    expectManifestError({ version: 1 }, 'audio', 'audio');
    expectManifestError({ version: 1, audio: '/audio/manifest.json' }, 'audio', 'audio');
  });

  it('rejects bad top level shapes', () => {
    expectManifestError(null, 'not_an_object', '');
    expectManifestError({ version: 2, audio: 'a.json' }, 'version', 'version');
    expectManifestError({ version: 1, audio: 'a.json', atlases: {} }, 'list', 'atlases');
    expectManifestError({ version: 1, audio: 'a.json', images: 'x' }, 'list', 'images');
    expectManifestError({ version: 1, audio: 'a.json', levels: [1] }, 'entry', 'levels[0]');
  });

  it('rejects bad ids, escaping paths, duplicates and oversize levels with a path', () => {
    expectManifestError(manifest({ atlases: [{ id: 'Worm', image: 'a.png', json: 'a.json' }] }), 'entry', 'atlases[0].id');
    expectManifestError(manifest({ atlases: [{ id: 'worm', image: '../a.png', json: 'a.json' }] }), 'entry', 'atlases[0].image');
    expectManifestError(manifest({ atlases: [{ id: 'worm', image: 'a.png', json: 'http://x/a.json' }] }), 'entry', 'atlases[0].json');
    expectManifestError(manifest({ images: [{ id: 'sky', src: '/sky.png' }] }), 'entry', 'images[0].src');
    expectManifestError(manifest({ images: [{ id: 'sky', src: 'a.png' }, { id: 'sky', src: 'b.png' }] }), 'duplicate', 'images[1].id');
    expectManifestError(
      manifest({ levels: [{ id: 'big', mask: 'm.png', texture: 't.png', width: WORLD_SIZE_MAX.w + 1, height: 100 }] }),
      'entry',
      'levels[0].width',
    );
    expectManifestError(manifest({ levels: [{ id: 'frac', mask: 'm.png', texture: 't.png', width: 100.5, height: 100 }] }), 'entry', 'levels[0].width');
    expectManifestError(manifest({ levels: [{ id: 'nomask', texture: 't.png', width: 100, height: 100 }] }), 'entry', 'levels[0].mask');
  });
});

describe('loader: retry', () => {
  it('backs off exponentially from the base delay', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({ attempts: 3, baseDelayMs: 200, factor: 2 });
    expect(backoffMs(1)).toBe(200);
    expect(backoffMs(2)).toBe(400);
    expect(backoffMs(3)).toBe(800);
    expect(backoffMs(1, { attempts: 5, baseDelayMs: 50, factor: 3 })).toBe(50);
    expect(backoffMs(3, { attempts: 5, baseDelayMs: 50, factor: 3 })).toBe(450);
  });

  it('succeeds on the third attempt and waits between attempts', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error(`fail ${calls}`);
        return 'done';
      },
      async (ms) => {
        delays.push(ms);
      },
    );
    expect(result).toEqual({ ok: true, value: 'done' });
    expect(calls).toBe(3);
    expect(delays).toEqual([200, 400]);
  });

  it('gives up after the configured attempts with the last message', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        throw new Error(`fail ${calls}`);
      },
      async () => {},
    );
    expect(calls).toBe(3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ attempts: 3, message: 'fail 3' });
    const single = await withRetry(
      async () => {
        throw 'plain';
      },
      async () => {},
      { attempts: 1, baseDelayMs: 1, factor: 1 },
    );
    expect(single.ok).toBe(false);
    if (!single.ok) expect(single.error).toEqual({ attempts: 1, message: 'plain' });
  });
});

describe('loader: loadAssets', () => {
  it('fetches everything the manifest lists and indexes it', async () => {
    const fake = fakeIo();
    const progress: LoadProgress[] = [];
    const result = await loadAssets(URLS.manifest, fake.io, { onProgress: (p) => progress.push(p) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = result.value;
    expect(loaded.atlases.get('worm_base')?.frameIds('walk')).toEqual(['worm_walk_00', 'worm_walk_01']);
    expect(loaded.atlases.get('worm_base')?.image).toEqual({ url: URLS.atlasImage });
    expect(loaded.images.get('bg_sky')).toEqual({ url: URLS.sky });
    expect(loaded.levels.get('island')).toEqual({
      entry: { id: 'island', mask: 'levels/island_mask.png', texture: 'levels/island_tex.png', width: 1920, height: 696 },
      mask: { url: URLS.mask },
      texture: { url: URLS.texture },
    });
    expect(Object.keys(loaded.audio.assets)).toEqual(['shot']);
    expect(loaded.audioBaseUrl).toBe('/assets');
    expect(loaded.manifest.version).toBe(1);
    expect(fake.delays).toEqual([]);
  });

  it('reports progress once per completed fetch up to the total', async () => {
    const fake = fakeIo();
    const progress: LoadProgress[] = [];
    await loadAssets(URLS.manifest, fake.io, { onProgress: (p) => progress.push(p) });
    expect(progress).toHaveLength(6);
    expect(progress.map((p) => p.loaded)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress.every((p) => p.total === 6)).toBe(true);
    expect(new Set(progress.map((p) => p.url))).toEqual(new Set([URLS.atlasImage, URLS.atlasJson, URLS.sky, URLS.audio, URLS.mask, URLS.texture]));
  });

  it('retries a fetch that fails then succeeds, with backoff', async () => {
    const fake = fakeIo({ failures: { [URLS.sky]: 2, [URLS.atlasJson]: 1 } });
    const result = await loadAssets(URLS.manifest, fake.io);
    expect(result.ok).toBe(true);
    expect(fake.calls.filter((call) => call === `image ${URLS.sky}`)).toHaveLength(3);
    expect(fake.calls.filter((call) => call === `json ${URLS.atlasJson}`)).toHaveLength(2);
    expect([...fake.delays].sort((a, b) => a - b)).toEqual([200, 200, 400]);
  });

  it('fails with the url and attempt count when a fetch keeps failing', async () => {
    const fake = fakeIo({ failures: { [URLS.mask]: 5 } });
    const result = await loadAssets(URLS.manifest, fake.io);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'fetch', url: URLS.mask, attempts: 3, path: null, message: `boom ${URLS.mask}` });
    }
    expect(fake.calls.filter((call) => call === `image ${URLS.mask}`)).toHaveLength(3);
  });

  it('honours a custom retry policy', async () => {
    const fake = fakeIo({ failures: { [URLS.sky]: 1 } });
    const result = await loadAssets(URLS.manifest, fake.io, { retry: { attempts: 1, baseDelayMs: 10, factor: 2 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'fetch', url: URLS.sky, attempts: 1 });
    expect(fake.delays).toEqual([]);
  });

  it('fails on a manifest that cannot be fetched or does not validate', async () => {
    const missing = fakeIo({ json: {} });
    const unreachable = await loadAssets(URLS.manifest, missing.io);
    expect(unreachable.ok).toBe(false);
    if (!unreachable.ok) expect(unreachable.error).toMatchObject({ code: 'fetch', url: URLS.manifest, attempts: 3 });

    const invalid = fakeIo({ json: { [URLS.manifest]: manifest({ version: 3 }) } });
    const rejected = await loadAssets(URLS.manifest, invalid.io);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toMatchObject({ code: 'manifest', url: URLS.manifest, attempts: 0, path: 'version' });
  });

  it('fails on an atlas that does not pass its schema, naming the atlas file', async () => {
    const fake = fakeIo({
      json: { [URLS.manifest]: manifest(), [URLS.atlasJson]: { meta: {} }, [URLS.audio]: AUDIO_JSON },
    });
    const result = await loadAssets(URLS.manifest, fake.io);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'atlas', url: URLS.atlasJson, path: 'meta.image' });
  });

  it('fails on an audio manifest that does not pass its schema', async () => {
    const fake = fakeIo({
      json: { [URLS.manifest]: manifest(), [URLS.atlasJson]: ATLAS_JSON, [URLS.audio]: { version: 1, assets: [{ id: 'BAD', status: 'ok' }] } },
    });
    const result = await loadAssets(URLS.manifest, fake.io);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'audio_manifest', url: URLS.audio, path: 'assets[0].id' });
  });

  it('resolves paths against the manifest directory, including a bare file name', async () => {
    const fake = fakeIo({
      json: { 'manifest.json': manifest({ atlases: [], images: [], levels: [] }), 'audio/manifest.json': AUDIO_JSON },
    });
    const result = await loadAssets('manifest.json', fake.io);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.audioBaseUrl).toBe('');
    expect(fake.calls).toEqual(['json manifest.json', 'json audio/manifest.json']);
  });
});
