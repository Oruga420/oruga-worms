import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRenderRadiusSprite, drawAuthoredPower, drawVictimHead, loadPowerAssets } from '@/game/power-assets.ts';
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

describe('sprite atlas loading and drawing', () => {
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
    expect(drawAuthoredPower(ctx, assets, 'hex-shield', 0.5, { x: 100, y: 80, sizePx: 120 })).toBe(true);
    expect(ctx.calls.some((call) => call.name === 'drawImage' && call.args[0] === image)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps procedural effects available when asset requests fail', async () => {
    const warn = vi.fn();
    const assets = await loadPowerAssets({ readJson: async () => { throw new Error('offline'); }, readImage: async () => image, warn });
    expect(assets).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(drawAuthoredPower(createRecordingContext(), assets, 'room-bloom', 0, { x: 0, y: 0, sizePx: 120 })).toBe(false);
  });

  it('rejects invalid playback progress, empty frames, and missing frames without drawing', async () => {
    const assets = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn: vi.fn() });
    if (!assets) throw new Error('Expected the checked-in atlas to load');
    const ctx = createRecordingContext();
    expect(drawAuthoredPower(ctx, assets, 'room-bloom', Number.NaN, { x: 0, y: 0, sizePx: 120 })).toBe(false);
    expect(drawAuthoredPower(ctx, assets, 'room-bloom', 0, { x: 0, y: 0, sizePx: 0 })).toBe(false);
    const empty = { ...assets, atlas: { ...assets.atlas, frameIds: () => [] } };
    expect(drawAuthoredPower(ctx, empty, 'room-bloom', 0, { x: 0, y: 0, sizePx: 120 })).toBe(false);
    const missing = { ...assets, atlas: { ...assets.atlas, frameIds: () => ['missing'] } };
    expect(drawAuthoredPower(ctx, missing, 'room-bloom', 0, { x: 0, y: 0, sizePx: 120 })).toBe(false);
    expect(ctx.calls).toHaveLength(0);
  });

  it('handles non-Error loading failures without leaking arbitrary response data', async () => {
    const warn = vi.fn();
    const assets = await loadPowerAssets({ readJson: vi.fn().mockRejectedValue({ upstream: 'opaque' }), readImage: async () => image, warn });
    expect(assets).toBeNull();
    expect(warn).toHaveBeenCalledWith('Painted sprite atlas unavailable; fallback effects remain active. Asset error');
  });

  it('sizes a painted boundary from its authored rim instead of a fixed icon box', async () => {
    const loaded = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn: vi.fn() });
    if (!loaded) throw new Error('Fixture atlas failed');
    const assets = { ...loaded, atlas: { ...loaded.atlas, attachOffset: () => ({ x: 40, y: 0 }) } };
    const ctx = createRecordingContext();
    expect(drawAuthoredPower(ctx, assets, 'room-bloom', 0.5, { x: 100, y: 80, radiusPx: 200 })).toBe(true);
    expect(ctx.calls.find((call) => call.name === 'drawImage')?.args.slice(5)).toEqual([-300, -320, 800, 800]);
  });

  it('refuses invalid geometry or a radius without an authored rim', async () => {
    const assets = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn: vi.fn() });
    const ctx = createRecordingContext();
    for (const draw of [
      { x: 0, y: 0, radiusPx: 100 }, { x: 0, y: 0, radiusPx: 0 },
      { x: Infinity, y: 0, sizePx: 120 }, { x: 0, y: 0, sizePx: Infinity },
      { x: 0, y: 0, sizePx: 120, alpha: Number.NaN },
    ]) expect(drawAuthoredPower(ctx, assets, 'room-bloom', 0.5, draw)).toBe(false);
    expect(ctx.calls).toHaveLength(0);
  });

  it('flips a slash about its pivot without affecting another draw', async () => {
    const assets = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn: vi.fn() });
    const ctx = createRecordingContext();
    expect(drawAuthoredPower(ctx, assets, 'slash-spark', 0.5, { x: 100, y: 80, sizePx: 120, flipX: true, alpha: 0.5 })).toBe(true);
    expect(ctx.calls.find((call) => call.name === 'translate')?.args).toEqual([100, 80]);
    expect(ctx.calls.find((call) => call.name === 'scale')?.args).toEqual([-1, 1]);
    expect(ctx.calls.at(-1)?.name).toBe('restore');
  });

  it('uses the actual character artwork for the detached head, not a geometric face', async () => {
    const character: unknown = JSON.parse(readFileSync(new URL('../../../public/sprites/olive_commando/atlas.json', import.meta.url), 'utf8'));
    const characterImage = { width: 480, height: 480 } as ImageSource;
    const sprite = await loadPowerAssets({ readJson: async () => character, readImage: async () => characterImage, warn: vi.fn() });
    const ctx = createRecordingContext();
    expect(drawVictimHead(ctx, sprite, 100, 100, 2, 0.5, 1)).toBe(true);
    expect(ctx.calls.some((call) => call.name === 'drawImage' && call.args[0] === characterImage)).toBe(true);
    expect(ctx.calls.filter((call) => call.name === 'arc')).toHaveLength(0);
    expect(ctx.calls.at(-1)?.name).toBe('restore');
  });

  it('declines a missing victim portrait or invalid playback without drawing a substitute face', () => {
    const ctx = createRecordingContext();
    expect(drawVictimHead(ctx, null, 100, 100, 2, 0.5, 1)).toBe(false);
    expect(ctx.calls).toHaveLength(0);
  });

  it('only replaces legacy blast particles when every painted frame and its rim are present', async () => {
    const loaded = await loadPowerAssets({ readJson: async () => manifest, readImage: async () => image, warn: vi.fn() });
    if (!loaded) throw new Error('Fixture atlas failed');
    expect(canRenderRadiusSprite(null, 'room-bloom')).toBe(false);
    expect(canRenderRadiusSprite(loaded, 'room-bloom')).toBe(false);
    const withRim = { ...loaded, atlas: { ...loaded.atlas, attachOffset: () => ({ x: 40, y: 0 }) } };
    expect(canRenderRadiusSprite(withRim, 'room-bloom')).toBe(true);
    expect(canRenderRadiusSprite({ ...withRim, atlas: { ...withRim.atlas, frame: () => undefined } }, 'room-bloom')).toBe(false);
  });

  it('rejects malformed manifests instead of failing the game render loop', async () => {
    const warn = vi.fn();
    expect(await loadPowerAssets({ readJson: async () => ({}), readImage: async () => image, warn })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
