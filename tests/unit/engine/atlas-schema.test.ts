import { describe, expect, it } from 'vitest';
import { validateAtlasManifest, type AtlasError, type AtlasManifest } from '@/engine/atlas-schema.ts';
import type { Result } from '@/core/result.ts';

type Json = Record<string, unknown>;

function fixture(): Json {
  const frame = (x: number): Json => ({
    frame: { x, y: 0, w: 96, h: 96 },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: 96, h: 96 },
    sourceSize: { w: 96, h: 96 },
    pivot: { x: 0.5, y: 0.875 },
  });
  return {
    meta: {
      image: 'worm_base.png',
      format: 'RGBA8888',
      size: { w: 1024, h: 1024 },
      scale: '1',
      frameSize: { w: 96, h: 96 },
      pivot: { x: 0.5, y: 0.875 },
    },
    frames: {
      worm_walk_00: frame(0),
      worm_walk_01: frame(96),
      worm_aim_level: frame(192),
    },
    animations: {
      walk: { frames: ['worm_walk_00', 'worm_walk_01'], fps: 18, loop: true },
      aim_level: { frames: ['worm_aim_level'], fps: 1, loop: false },
    },
    attachPoints: {
      aim_level: { hand: { x: 44, y: 34 } },
    },
  };
}

function unwrap(result: Result<AtlasManifest, AtlasError>): AtlasManifest {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function unwrapErr(result: Result<AtlasManifest, AtlasError>): AtlasError {
  if (result.ok) throw new Error('expected an error');
  return result.error;
}

describe('atlas manifest validation', () => {
  it('accepts the documented fixture and normalizes it', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const manifest = unwrap(validateAtlasManifest(input));
    expect(manifest.meta.scale).toBe(1);
    expect(manifest.meta.size).toEqual({ w: 1024, h: 1024 });
    expect(Object.keys(manifest.frames)).toEqual(['worm_walk_00', 'worm_walk_01', 'worm_aim_level']);
    expect(manifest.frames['worm_walk_01']?.frame).toEqual({ x: 96, y: 0, w: 96, h: 96 });
    expect(manifest.animations['walk']).toEqual({ frames: ['worm_walk_00', 'worm_walk_01'], fps: 18, loop: true });
    expect(manifest.attachPoints['aim_level']?.['hand']).toEqual({ x: 44, y: 34 });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns a frozen manifest', () => {
    const manifest = unwrap(validateAtlasManifest(fixture()));
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.frames)).toBe(true);
    expect(Object.isFrozen(manifest.frames['worm_walk_00'])).toBe(true);
    expect(Object.isFrozen(manifest.animations['walk']?.frames)).toBe(true);
    expect(Object.isFrozen(manifest.attachPoints['aim_level'])).toBe(true);
  });

  it('fills defaults for optional frame fields', () => {
    const input = fixture();
    input['frames'] = { only: { frame: { x: 0, y: 0, w: 10, h: 12 } } };
    input['animations'] = {};
    input['attachPoints'] = {};
    const manifest = unwrap(validateAtlasManifest(input));
    expect(manifest.frames['only']).toEqual({
      frame: { x: 0, y: 0, w: 10, h: 12 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 10, h: 12 },
      sourceSize: { w: 10, h: 12 },
    });
  });

  it('rejects a frame entry without its rect', () => {
    const input = fixture();
    const frames = input['frames'] as Record<string, Json>;
    frames['worm_walk_01'] = { trimmed: false };
    const error = unwrapErr(validateAtlasManifest(input));
    expect(error.code).toBe('frame');
    expect(error.path).toBe('frames.worm_walk_01.frame');
  });

  it('rejects an animation that references a frame that does not exist', () => {
    const input = fixture();
    const animations = input['animations'] as Record<string, Json>;
    animations['walk'] = { frames: ['worm_walk_00', 'worm_walk_99'], fps: 18, loop: true };
    const error = unwrapErr(validateAtlasManifest(input));
    expect(error.code).toBe('animation');
    expect(error.path).toBe('animations.walk.frames');
    expect(error.message).toContain('worm_walk_99');
  });

  it('rejects a frame that exceeds the sheet', () => {
    const input = fixture();
    const frames = input['frames'] as Record<string, Json>;
    frames['worm_walk_00'] = { ...frames['worm_walk_00'], frame: { x: 1000, y: 0, w: 96, h: 96 } };
    const error = unwrapErr(validateAtlasManifest(input));
    expect(error.code).toBe('frame');
    expect(error.message).toContain('1024 x 1024');
  });

  it('rejects an attach point whose owner is neither an animation nor a frame', () => {
    const input = fixture();
    input['attachPoints'] = { aim_up: { hand: { x: 42, y: 26 } } };
    const error = unwrapErr(validateAtlasManifest(input));
    expect(error.code).toBe('attach_point');
    expect(error.path).toBe('attachPoints.aim_up');
  });

  it('rejects structural problems with a code and a path', () => {
    expect(unwrapErr(validateAtlasManifest(null)).code).toBe('not_an_object');
    expect(unwrapErr(validateAtlasManifest([])).code).toBe('not_an_object');

    const noImage = fixture();
    noImage['meta'] = { ...(noImage['meta'] as Json), image: '' };
    expect(unwrapErr(validateAtlasManifest(noImage))).toMatchObject({ code: 'meta', path: 'meta.image' });

    const emptyFrames = fixture();
    emptyFrames['frames'] = {};
    expect(unwrapErr(validateAtlasManifest(emptyFrames)).code).toBe('frames');

    const badFps = fixture();
    (badFps['animations'] as Record<string, Json>)['walk'] = { frames: ['worm_walk_00'], fps: 0, loop: true };
    expect(unwrapErr(validateAtlasManifest(badFps))).toMatchObject({ code: 'animation', path: 'animations.walk.fps' });
  });
});
