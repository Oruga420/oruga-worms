/**
 * TDD, written before (then iterated alongside) the matching fx.ts change: Alejandro rejected the
 * code-looking procedural blast (a filled "flash" circle plus a stroked shock ring) and approved
 * painted raster sprites instead, same as the power-scenes.ts swap pinned by
 * painted-routing.test.ts. This suite pins the matching swap for ordinary GameEvent
 * `type: 'explosion'` blasts drawn by fx.ts's drawFxWorld.
 *
 * The swap is keyed on drawAuthoredPower's own return value, never on "PowerAssets is non-null"
 * alone: a blast only drops its procedural flash+ring once the authored sprite for THAT blast
 * actually drew (atlas missing the 'blast-burst' clip, or missing its 'rim' attach point, both
 * correctly keep the procedural fallback, same as assets being null/undefined).
 *
 * It exercises the real drawAuthoredPower -> ctx.drawImage path (no mocking of power-assets.ts):
 * the atlas fixture below carries a 16 frame 'blast-burst' animation on a 192px tile with a rim
 * attach point at (155.0625, 96), matching the real packer output (public/sprites/fx/painted-v2,
 * blast-burst, 16 frames at 20fps = 800ms).
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { createCamera } from '@/engine/camera.ts';
import { createAtlas } from '@/engine/atlas.ts';
import { validateAtlasManifest, type AtlasManifest } from '@/engine/atlas-schema.ts';
import { createParticleSystem } from '@/engine/particles.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';
import type { GameEvent } from '@/game/controller.ts';
import { MAX_PAINTED_BLASTS, advanceFx, applyFxEvents, createFx, drawFxWorld, type FxDeps } from '@/game/fx.ts';
import { createGore } from '@/game/gore.ts';
import type { PowerAssets } from '@/game/power-assets.ts';
import { createRecordingContext, type RecordingContext } from '../ui/recording-context.ts';

function deps(): FxDeps {
  return { gore: createGore(), particles: createParticleSystem(), rng: createRng(4), onScreen: () => true };
}

const viewport = { w: 800, h: 600 };

/** 192px tiles, matching the real packer's tile size (see painted-routing.test.ts's FRAME). */
const FRAME = 192;
const BLAST_FRAME_COUNT = 16;
/** The real packer's blast-burst rim, authored 155.0625,96 in a 192 tile pivoted at its center
 *  (96,96): 59.0625px out. Used verbatim so this fixture matches the actual asset's scale math. */
const RIM = { x: 155.0625, y: 96 };

function frameAt(index: number): Record<string, unknown> {
  const x = index * FRAME;
  return {
    frame: { x, y: 0, w: FRAME, h: FRAME },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: FRAME, h: FRAME },
    sourceSize: { w: FRAME, h: FRAME },
  };
}

function blastBurstFrames(): { readonly frames: Record<string, unknown>; readonly ids: string[] } {
  const frames: Record<string, unknown> = {};
  const ids: string[] = [];
  for (let i = 0; i < BLAST_FRAME_COUNT; i += 1) {
    const id = `blast-burst_${i}`;
    frames[id] = frameAt(i);
    ids.push(id);
  }
  return { frames, ids };
}

function manifestWith(options: { readonly withBlastClip: boolean; readonly withRim: boolean }): AtlasManifest {
  const { frames, ids } = blastBurstFrames();
  const json: Record<string, unknown> = {
    meta: { image: 'painted-v2.png', size: { w: FRAME * BLAST_FRAME_COUNT, h: FRAME }, pivot: { x: 0.5, y: 0.5 } },
    frames: options.withBlastClip ? frames : { placeholder: frameAt(0) },
    animations: options.withBlastClip ? { 'blast-burst': { frames: ids, fps: 20, loop: false } } : {},
    attachPoints: options.withBlastClip && options.withRim ? { 'blast-burst': { rim: RIM } } : {},
  };
  const result = validateAtlasManifest(json);
  if (!result.ok) throw new Error(`fixture manifest invalid: ${result.error.message}`);
  return result.value;
}

const paintedImage = { width: FRAME * BLAST_FRAME_COUNT, height: FRAME } as unknown as ImageSource;

function assetsWith(options: { readonly withBlastClip: boolean; readonly withRim: boolean }): PowerAssets {
  const result = createAtlas(manifestWith(options), paintedImage);
  if (!result.ok) throw new Error(`fixture atlas invalid: ${result.error.message}`);
  return Object.freeze({ atlas: result.value, image: paintedImage });
}

/** The normal, fully authored fixture: blast-burst clip present, rim present. */
function paintedAssets(): PowerAssets {
  return assetsWith({ withBlastClip: true, withRim: true });
}

function drawImageCalls(ctx: RecordingContext): readonly { readonly args: readonly unknown[] }[] {
  return ctx.calls.filter((call) => call.name === 'drawImage');
}

function arcCalls(ctx: RecordingContext): readonly { readonly args: readonly unknown[] }[] {
  return ctx.calls.filter((call) => call.name === 'arc');
}

function strokeCalls(ctx: RecordingContext): readonly { readonly args: readonly unknown[] }[] {
  return ctx.calls.filter((call) => call.name === 'stroke');
}

function explosionAt(x: number, y: number, radius = 40): GameEvent {
  return { type: 'explosion', x, y, radius, particle: 'medium', shake: 4 };
}

const explosion: GameEvent = Object.freeze(explosionAt(120, 80));

describe('painted explosion blast: real drawImage path replaces the procedural flash+ring, keyed on actual draw success', () => {
  it('draws the blast-burst sprite via drawImage when PowerAssets are supplied, with no leftover blast flash arc or ring stroke', () => {
    const assets = paintedAssets();
    const fx = createFx();
    applyFxEvents(fx, [explosion], deps());
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets);

    const draws = drawImageCalls(ctx);
    expect(draws.length).toBeGreaterThan(0);
    const sourceXs = new Set(Array.from({ length: BLAST_FRAME_COUNT }, (_, i) => i * FRAME));
    expect(draws.some((call) => sourceXs.has(Number(call.args[1])))).toBe(true);

    // The old procedural look (filled blast flash arc, stroked shock ring) must not also appear.
    expect(arcCalls(ctx)).toHaveLength(0);
    expect(strokeCalls(ctx)).toHaveLength(0);
  });

  it('keeps the procedural flash+ring fallback when assets are null, drawing no sprite at all', () => {
    const fx = createFx();
    applyFxEvents(fx, [explosion], deps());
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, null);

    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(arcCalls(ctx).length).toBeGreaterThan(0);
    expect(strokeCalls(ctx).length).toBeGreaterThan(0);
  });

  it('keeps the same procedural fallback when assets are simply omitted (today\'s call sites, no PowerAssets arg)', () => {
    const fx = createFx();
    applyFxEvents(fx, [explosion], deps());
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport);

    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(arcCalls(ctx).length).toBeGreaterThan(0);
  });

  it('keeps the procedural fallback when PowerAssets are present but the atlas has no blast-burst clip at all', () => {
    const assets = assetsWith({ withBlastClip: false, withRim: false });
    const fx = createFx();
    applyFxEvents(fx, [explosion], deps());
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets);

    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(arcCalls(ctx).length).toBeGreaterThan(0);
    expect(strokeCalls(ctx).length).toBeGreaterThan(0);
  });

  it('keeps the procedural fallback when the blast-burst clip exists but its rim attach point is missing', () => {
    const assets = assetsWith({ withBlastClip: true, withRim: false });
    const fx = createFx();
    applyFxEvents(fx, [explosion], deps());
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets);

    // drawAuthoredPower itself reports failure here (no rim means no nominal scale to size
    // radiusPx against), so the procedural pair must still be the one on screen.
    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(arcCalls(ctx).length).toBeGreaterThan(0);
    expect(strokeCalls(ctx).length).toBeGreaterThan(0);
  });

  it('sizes the painted blast from the live camera zoom, with every drawImage arg finite', () => {
    const assets = paintedAssets();
    // Camera zoom is clamped to [ZOOM_MIN=2, ZOOM_MAX=3] (src/config/units.ts): a 2 -> 3 zoom
    // change is a real, in-range 1.5x scale the renderer must track.
    const fxNear = createFx();
    applyFxEvents(fxNear, [explosion], deps());
    const ctxZoom2 = createRecordingContext();
    drawFxWorld(ctxZoom2, fxNear, createCamera({ x: 0, y: 0, zoom: 2 }), viewport, undefined, 0, assets);

    const fxFar = createFx();
    applyFxEvents(fxFar, [explosion], deps());
    const ctxZoom3 = createRecordingContext();
    drawFxWorld(ctxZoom3, fxFar, createCamera({ x: 0, y: 0, zoom: 3 }), viewport, undefined, 0, assets);

    const drawAt = (ctx: RecordingContext): readonly unknown[] => {
      const draws = drawImageCalls(ctx);
      expect(draws.length).toBeGreaterThan(0);
      const call = draws[0];
      if (call === undefined) throw new Error('no drawImage call');
      return call.args;
    };
    const argsZoom2 = drawAt(ctxZoom2);
    const argsZoom3 = drawAt(ctxZoom3);
    for (const value of [...argsZoom2, ...argsZoom3]) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    const dw2 = Number(argsZoom2[7]);
    const dw3 = Number(argsZoom3[7]);
    expect(dw2).toBeGreaterThan(0);
    expect(dw3).toBeCloseTo(dw2 * 1.5, 5);
  });

  it('plays the painted blast for its full 800ms life, not cut off at the old 320ms ring window', () => {
    const assets = paintedAssets();
    const fx = createFx();
    applyFxEvents(fx, [explosion], deps());

    advanceFx(fx, 500, null, deps());
    const ctxStillPlaying = createRecordingContext();
    drawFxWorld(ctxStillPlaying, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets);
    expect(drawImageCalls(ctxStillPlaying).length).toBeGreaterThan(0);

    advanceFx(fx, 350, null, deps());
    const ctxExpired = createRecordingContext();
    drawFxWorld(ctxExpired, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets);
    expect(drawImageCalls(ctxExpired)).toHaveLength(0);
  });

  it('a bullet puff style explosion (radius under 10) still gets no painted blast and no procedural ring', () => {
    const assets = paintedAssets();
    const fx = createFx();
    const tiny: GameEvent = { type: 'explosion', x: 10, y: 10, radius: 4, particle: 'small', shake: 0 };
    applyFxEvents(fx, [tiny], deps());
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets);
    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(arcCalls(ctx)).toHaveLength(0);
  });

  it('does not mutate the explosion GameEvent or touch any sim state while rendering (fx is presentation only)', () => {
    const assets = paintedAssets();
    const before = { ...explosion };
    const fx = createFx();
    expect(() => applyFxEvents(fx, [explosion], deps())).not.toThrow();
    expect(explosion).toEqual(before);
    const ctx = createRecordingContext();
    expect(() => drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets)).not.toThrow();
    expect(explosion).toEqual(before);
  });
});

describe('painted blast pool cap: a large explosion batch does not grow fx.paintedBlasts unbounded', () => {
  it('caps fx.paintedBlasts at MAX_PAINTED_BLASTS even when one tick fires far more explosions than that', () => {
    const fx = createFx();
    const batch: GameEvent[] = Array.from({ length: MAX_PAINTED_BLASTS * 3 }, (_, i) => explosionAt(i, i));
    applyFxEvents(fx, batch, deps());
    expect(fx.paintedBlasts.length).toBeLessThanOrEqual(MAX_PAINTED_BLASTS);
    expect(fx.paintedBlasts.length).toBe(MAX_PAINTED_BLASTS);
  });

  it('keeps the newest blasts when the cap evicts (drops the oldest, not the newest)', () => {
    const fx = createFx();
    const batch: GameEvent[] = Array.from({ length: MAX_PAINTED_BLASTS + 5 }, (_, i) => explosionAt(i, i));
    applyFxEvents(fx, batch, deps());
    const xs = fx.paintedBlasts.map((b) => b.x);
    // The first 5 explosions (x = 0..4) should have been evicted; the most recent ones remain.
    expect(xs).not.toContain(0);
    expect(xs).toContain(batch.length - 1);
  });

  it('still renders cleanly (bounded drawImage calls, no throw) after an oversized batch', () => {
    const assets = paintedAssets();
    const fx = createFx();
    const batch: GameEvent[] = Array.from({ length: MAX_PAINTED_BLASTS * 3 }, (_, i) => explosionAt(i * 2, i * 2));
    applyFxEvents(fx, batch, deps());
    const ctx = createRecordingContext();
    expect(() => drawFxWorld(ctx, fx, createCamera({ x: 0, y: 0 }), viewport, undefined, 0, assets)).not.toThrow();
    expect(drawImageCalls(ctx).length).toBeLessThanOrEqual(MAX_PAINTED_BLASTS);
  });
});
