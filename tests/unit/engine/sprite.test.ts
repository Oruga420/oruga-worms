import { describe, expect, it } from 'vitest';
import { SPRITE_SCALE } from '@/config/units.ts';
import type { AtlasFrame } from '@/engine/atlas-schema.ts';
import type { Ctx2D, ImageSource } from '@/engine/canvas-types.ts';
import { drawSprite, frameUnit, frameWorldSize, spriteTransform } from '@/engine/sprite.ts';

const image = {} as unknown as ImageSource;

const FRAME: AtlasFrame = Object.freeze({
  frame: { x: 192, y: 96, w: 96, h: 96 },
  rotated: false,
  trimmed: false,
  spriteSourceSize: { x: 0, y: 0, w: 96, h: 96 },
  sourceSize: { w: 96, h: 96 },
});

const TRIMMED: AtlasFrame = Object.freeze({
  frame: { x: 0, y: 0, w: 40, h: 60 },
  rotated: false,
  trimmed: true,
  spriteSourceSize: { x: 20, y: 30, w: 40, h: 60 },
  sourceSize: { w: 96, h: 96 },
});

const FEET = { x: 0.5, y: 0.875 };

describe('sprite: scale math', () => {
  it('draws a 3x authored frame at 1/3 world size times the zoom', () => {
    expect(SPRITE_SCALE).toBe(3);
    expect(frameUnit(3)).toBe(1);
    expect(frameUnit(2.5)).toBeCloseTo(2.5 / 3, 12);
    expect(frameUnit(2, 2)).toBeCloseTo(4 / 3, 12);
    expect(frameWorldSize(FRAME)).toEqual({ w: 32, h: 32 });
  });

  it('places the destination rect so the pivot lands on the screen point', () => {
    const t = spriteTransform(FRAME, FEET, { x: 100, y: 200, zoom: 3 });
    expect(t).toMatchObject({ sx: 192, sy: 96, sw: 96, sh: 96, dw: 96, dh: 96, x: 100, y: 200 });
    expect(t.dx).toBe(-48);
    expect(t.dy).toBe(-84);
    expect(t.direct).toBe(true);
    expect(Object.isFrozen(t)).toBe(true);
  });

  it('scales the destination with the zoom', () => {
    const t = spriteTransform(FRAME, FEET, { x: 0, y: 0, zoom: 2.5 });
    expect(t.dw).toBeCloseTo(80, 9);
    expect(t.dh).toBeCloseTo(80, 9);
    expect(t.dx).toBeCloseTo(-40, 9);
    expect(t.dy).toBeCloseTo(-70, 9);
  });

  it('accounts for trimmed frames through spriteSourceSize', () => {
    const t = spriteTransform(TRIMMED, FEET, { x: 0, y: 0, zoom: 3 });
    expect(t.dx).toBe(20 - 48);
    expect(t.dy).toBe(30 - 84);
    expect(t.dw).toBe(40);
    expect(t.dh).toBe(60);
  });

  it('flip, rotation, alpha and scale leave the direct path', () => {
    expect(spriteTransform(FRAME, FEET, { x: 0, y: 0, zoom: 3, flipX: true })).toMatchObject({ scaleX: -1, direct: false });
    expect(spriteTransform(FRAME, FEET, { x: 0, y: 0, zoom: 3, rotation: 0.5 })).toMatchObject({ rotation: 0.5, direct: false });
    expect(spriteTransform(FRAME, FEET, { x: 0, y: 0, zoom: 3, alpha: 0.5 })).toMatchObject({ alpha: 0.5, direct: false });
    expect(spriteTransform(FRAME, FEET, { x: 0, y: 0, zoom: 3, scale: 2 }).dw).toBe(192);
  });
});

function recordingCtx() {
  const calls: string[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}(${args.map((a) => (typeof a === 'number' ? Number(a.toFixed(3)) : typeof a === 'object' ? 'img' : String(a))).join(',')})`);
  };
  const ctx = {
    globalAlpha: 1,
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    drawImage: record('drawImage'),
  } as unknown as Ctx2D;
  return { ctx, calls };
}

describe('sprite: drawSprite', () => {
  it('draws directly when there is no flip, rotation or alpha', () => {
    const { ctx, calls } = recordingCtx();
    drawSprite(ctx, image, FRAME, FEET, { x: 100, y: 200, zoom: 3 });
    expect(calls).toEqual(['drawImage(img,192,96,96,96,52,116,96,96)']);
  });

  it('wraps flipped draws in a mirrored transform about the pivot', () => {
    const { ctx, calls } = recordingCtx();
    drawSprite(ctx, image, FRAME, FEET, { x: 100, y: 200, zoom: 3, flipX: true, rotation: 0.25 });
    expect(calls).toEqual([
      'save()',
      'translate(100,200)',
      'rotate(0.25)',
      'scale(-1,1)',
      'drawImage(img,192,96,96,96,-48,-84,96,96)',
      'restore()',
    ]);
  });

  it('sets the alpha inside the save and restore', () => {
    const { ctx, calls } = recordingCtx();
    drawSprite(ctx, image, FRAME, FEET, { x: 0, y: 0, zoom: 3, alpha: 0.5 });
    expect(calls[0]).toBe('save()');
    expect(calls[calls.length - 1]).toBe('restore()');
    expect(calls).not.toContain('rotate(0)');
    expect(calls).not.toContain('scale(1,1)');
  });
});
