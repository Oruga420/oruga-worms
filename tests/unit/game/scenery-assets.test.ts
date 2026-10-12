import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSceneryAssets } from '@/game/scenery-assets.ts';

const entry = { color: '/scenery/rendered/spaceship/color.png', occupancy: '/scenery/rendered/spaceship/occupancy.json' };
const pixels = { width: 4, height: 2, spans: [{ y: 0, x0: 0, x1: 3 }, { y: 1, x0: 0, x1: 3 }] };

function deps(manifest: unknown = { version: 1, assets: { spaceship: entry } }) {
  return {
    fetchJson: vi.fn(async (url: string) => url.includes('manifest') ? manifest : pixels),
    loadImage: vi.fn(async () => ({ width: 4, height: 2 })),
    warn: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function browserDeps(mode: 'load' | 'error' | 'timeout') {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('manifest') ? { version: 1, assets: { spaceship: entry } } : pixels))));
  vi.stubGlobal('Image', class {
    width = 4;
    height = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      if (mode !== 'timeout') queueMicrotask(() => mode === 'load' ? this.onload?.() : this.onerror?.());
    }
  });
}

describe('preloaded scenery assets', () => {
  it('uses browser fetch and Image decoding when no test dependency is passed', async () => {
    browserDeps('load');
    expect((await loadSceneryAssets()).spaceship?.width).toBe(4);
  });

  it('handles real Image error callbacks without stalling startup', async () => {
    browserDeps('error');
    expect(await loadSceneryAssets()).toEqual({});
    expect(console.warn).toHaveBeenCalled();
  });

  it('bounds the browser image loading wait and keeps the vector fallback', async () => {
    vi.useFakeTimers();
    browserDeps('timeout');
    const pending = loadSceneryAssets();
    await vi.advanceTimersByTimeAsync(15001);
    expect(await pending).toEqual({});
  });

  it('handles an HTTP manifest failure through the default browser adapter', async () => {
    browserDeps('load');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await loadSceneryAssets()).toEqual({});
  });

  it('returns fully decoded assets, not pending placeholders', async () => {
    const d = deps();
    const assets = await loadSceneryAssets(d);
    expect(assets.spaceship?.width).toBe(4);
    expect(assets.spaceship?.spans).toEqual(pixels.spans);
    expect(Object.isFrozen(assets)).toBe(true);
    expect(d.warn).not.toHaveBeenCalled();
  });

  it('returns an empty vector fallback when the manifest is absent', async () => {
    const d = deps();
    d.fetchJson.mockRejectedValueOnce(new Error('404'));
    expect(await loadSceneryAssets(d)).toEqual({});
    expect(d.warn).toHaveBeenCalled();
    expect(d.loadImage).not.toHaveBeenCalled();
  });

  it('omits only a broken image so other maps can still use their real rasters', async () => {
    const d = deps({ version: 1, assets: { spaceship: entry, castle: { ...entry, color: '/scenery/rendered/castle/color.png' } } });
    d.loadImage.mockImplementation(async (url?: string) => {
      if (url?.includes('castle')) throw new Error('bad image');
      return { width: 4, height: 2 };
    });
    const assets = await loadSceneryAssets(d);
    expect(assets.spaceship).toBeDefined();
    expect(assets.castle).toBeUndefined();
    expect(d.warn).toHaveBeenCalled();
  });

  it('refuses external asset URLs and dimension mismatches', async () => {
    const foreign = deps({ version: 1, assets: { spaceship: { ...entry, color: 'https://foreign.test/image.png' } } });
    expect(await loadSceneryAssets(foreign)).toEqual({});
    expect(foreign.loadImage).not.toHaveBeenCalled();
    const mismatch = deps();
    mismatch.loadImage.mockResolvedValue({ width: 8, height: 2 });
    expect(await loadSceneryAssets(mismatch)).toEqual({});
  });
});
