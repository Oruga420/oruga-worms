import { describe, expect, it } from 'vitest';
import { createAtlas, loadAtlas, mirrorPoint, ownerFrame, resolvePivot, type Atlas } from '@/engine/atlas.ts';
import { validateAtlasManifest, type AtlasManifest } from '@/engine/atlas-schema.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';

type Json = Record<string, unknown>;

const image = { width: 1024, height: 1024 } as unknown as ImageSource;

function fixture(): Json {
  const frame = (x: number, extra: Json = {}): Json => ({
    frame: { x, y: 0, w: 96, h: 96 },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: 96, h: 96 },
    sourceSize: { w: 96, h: 96 },
    ...extra,
  });
  return {
    meta: { image: 'worm_base.png', size: { w: 1024, h: 1024 }, frameSize: { w: 96, h: 96 }, pivot: { x: 0.5, y: 0.875 } },
    frames: {
      worm_walk_00: frame(0),
      worm_walk_01: frame(96),
      worm_aim_level: frame(192, { pivot: { x: 0.25, y: 0.5 } }),
      crate: frame(288),
    },
    animations: {
      walk: { frames: ['worm_walk_00', 'worm_walk_01'], fps: 18, loop: true },
      aim_level: { frames: ['worm_aim_level'], fps: 1, loop: false },
    },
    attachPoints: {
      aim_level: { hand: { x: 44, y: 34 } },
      crate: { chute: { x: 48, y: 4 } },
    },
  };
}

function manifest(): AtlasManifest {
  const result = validateAtlasManifest(fixture());
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function atlas(): Atlas {
  const result = createAtlas(manifest(), image);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('atlas: lookups', () => {
  it('finds frames and animations, undefined for unknown ids', () => {
    const a = atlas();
    expect(a.frame('worm_walk_01')?.frame).toEqual({ x: 96, y: 0, w: 96, h: 96 });
    expect(a.frame('nope')).toBeUndefined();
    expect(a.animation('walk')?.fps).toBe(18);
    expect(a.animation('nope')).toBeUndefined();
    expect(a.image).toBe(image);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('lists the frames behind an animation or a single frame', () => {
    const a = atlas();
    expect(a.frameIds('walk')).toEqual(['worm_walk_00', 'worm_walk_01']);
    expect(a.frameIds('crate')).toEqual(['crate']);
    expect(a.frameIds('nope')).toEqual([]);
  });

  it('resolves the pivot from the frame, then meta, then center', () => {
    const m = manifest();
    const a = atlas();
    const level = a.frame('worm_aim_level');
    const walk = a.frame('worm_walk_00');
    if (level === undefined || walk === undefined) throw new Error('fixture frames missing');
    expect(a.pivotOf(level)).toEqual({ x: 0.25, y: 0.5 });
    expect(a.pivotOf(walk)).toEqual({ x: 0.5, y: 0.875 });
    const noMeta: AtlasManifest = {
      ...m,
      meta: { image: m.meta.image, format: m.meta.format, size: m.meta.size, scale: m.meta.scale },
    };
    expect(resolvePivot(walk, noMeta)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('ownerFrame returns the frame itself or the first animation frame', () => {
    const m = manifest();
    expect(ownerFrame(m, 'crate')).toBe(m.frames['crate']);
    expect(ownerFrame(m, 'walk')).toBe(m.frames['worm_walk_00']);
    expect(ownerFrame(m, 'nope')).toBeUndefined();
  });
});

describe('atlas: attach points', () => {
  it('returns the authored point facing right and mirrors x facing left', () => {
    const a = atlas();
    expect(a.attachPoint('aim_level', 'hand')).toEqual({ x: 44, y: 34 });
    expect(a.attachPoint('aim_level', 'hand', true)).toEqual({ x: 96 - 44, y: 34 });
    expect(mirrorPoint({ x: 10, y: 3 }, 64)).toEqual({ x: 54, y: 3 });
  });

  it('works for frame owners too and is undefined for unknown points', () => {
    const a = atlas();
    expect(a.attachPoint('crate', 'chute')).toEqual({ x: 48, y: 4 });
    expect(a.attachPoint('crate', 'chute', true)).toEqual({ x: 48, y: 4 });
    expect(a.attachPoint('crate', 'nope')).toBeUndefined();
    expect(a.attachPoint('nope', 'hand')).toBeUndefined();
  });

  it('gives the offset from the pivot, mirrored with the facing', () => {
    const a = atlas();
    expect(a.attachOffset('aim_level', 'hand')).toEqual({ x: 44 - 0.25 * 96, y: 34 - 0.5 * 96 });
    expect(a.attachOffset('aim_level', 'hand', true)).toEqual({ x: 52 - 0.25 * 96, y: 34 - 0.5 * 96 });
    expect(a.attachOffset('nope', 'hand')).toBeUndefined();
  });
});

describe('atlas: loading', () => {
  it('loadAtlas validates then indexes', () => {
    const result = loadAtlas(fixture(), image);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.frameIds('walk')).toHaveLength(2);
  });

  it('propagates schema errors', () => {
    const result = loadAtlas({ meta: {} }, image);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('meta');
  });

  it('refuses rotated frames', () => {
    const input = fixture();
    (input['frames'] as Record<string, Json>)['crate'] = {
      ...((input['frames'] as Record<string, Json>)['crate'] as Json),
      rotated: true,
    };
    const result = loadAtlas(input, image);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rotated_frame');
      expect(result.error.path).toBe('frames.crate');
    }
  });
});
