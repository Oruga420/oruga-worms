import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawAuthoredPower, loadPowerAssets } from '@/game/power-assets.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const manifest: unknown = JSON.parse(readFileSync(new URL('../../../public/sprites/fx/manimgx-fx.json', import.meta.url), 'utf8'));
const image = { width: 1280, height: 2400 } as ImageSource;

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

function browserStubs(mode: 'ok' | 'error' | 'timeout' = 'ok'): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => manifest })));
  vi.stubGlobal('Image', class {
    readonly width = 1280;
    readonly height = 2400;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
      if (mode === 'ok') queueMicrotask(() => this.onload?.());
      if (mode === 'error') queueMicrotask(() => this.onerror?.());
    }
  });
}

describe('actual ManimGX runtime assets', () => {
  it('loads through browser fetch and Image implementations', async () => {
    browserStubs();
    expect(await loadPowerAssets()).not.toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('falls back on a browser image decode failure', async () => {
    browserStubs('error');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await loadPowerAssets()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('times out an image that never finishes instead of waiting forever', async () => {
    vi.useFakeTimers();
    browserStubs('timeout');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loaded = loadPowerAssets();
    await vi.advanceTimersByTimeAsync(12000);
    expect(await loaded).toBeNull();
  });

  it('rejects an HTTP failure before consuming invalid atlas data', async () => {
    browserStubs();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await loadPowerAssets()).toBeNull();
  });
  it('loads the authored atlas through the production schema and plays its frame', async () => {
    const warn = vi.fn();
    const assets = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn });
    expect(assets).not.toBeNull();
    const ctx = createRecordingContext();
    expect(drawAuthoredPower(ctx, assets, 'hex-shield', 0.5, 100, 80, 120)).toBe(true);
    expect(ctx.calls.some((call) => call.name === 'drawImage' && call.args[0] === image)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps procedural effects available when asset requests fail', async () => {
    const warn = vi.fn();
    const assets = await loadPowerAssets({ readJson: async () => { throw new Error('offline'); }, readImage: async () => image, warn });
    expect(assets).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(drawAuthoredPower(createRecordingContext(), assets, 'room-bloom', 0, 0, 0, 120)).toBe(false);
  });

  it('rejects invalid playback progress, empty frames, and missing frames without drawing', async () => {
    const assets = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn: vi.fn() });
    if (!assets) throw new Error('Expected the checked-in atlas to load');
    const ctx = createRecordingContext();
    expect(drawAuthoredPower(ctx, assets, 'room-bloom', Number.NaN, 0, 0, 120)).toBe(false);
    expect(drawAuthoredPower(ctx, assets, 'room-bloom', 0, 0, 0, 0)).toBe(false);
    const empty = { ...assets, atlas: { ...assets.atlas, frameIds: () => [] } };
    expect(drawAuthoredPower(ctx, empty, 'room-bloom', 0, 0, 0, 120)).toBe(false);
    const missing = { ...assets, atlas: { ...assets.atlas, frameIds: () => ['missing'] } };
    expect(drawAuthoredPower(ctx, missing, 'room-bloom', 0, 0, 0, 120)).toBe(false);
    expect(ctx.calls).toHaveLength(0);
  });

  it('handles non-Error loading failures without leaking arbitrary response data', async () => {
    const warn = vi.fn();
    const assets = await loadPowerAssets({ readJson: vi.fn().mockRejectedValue({ upstream: 'opaque' }), readImage: async () => image, warn });
    expect(assets).toBeNull();
    expect(warn).toHaveBeenCalledWith('ManimGX atlas unavailable; procedural effects remain active. Asset error');
  });

  it('rejects malformed manifests instead of failing the game render loop', async () => {
    const warn = vi.fn();
    expect(await loadPowerAssets({ readJson: async () => ({}), readImage: async () => image, warn })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
