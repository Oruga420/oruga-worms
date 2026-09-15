/**
 * Sprite drawing (architecture.md section G). Sprites are authored at SPRITE_SCALE times world
 * resolution (config/units.ts: a 16 px worm is a 48 px figure in a 96 px frame), so one frame
 * pixel covers zoom / SPRITE_SCALE screen pixels. spriteTransform is the pure math: it turns a
 * frame, its pivot and the draw options into the exact drawImage arguments plus the transform
 * to apply around the pivot. drawSprite applies it to a Ctx2D; flipX is a negative x scale about
 * the pivot so mirrored frames stay anchored at the feet.
 */

import { SPRITE_SCALE } from '../config/units.ts';
import type { AtlasFrame, AtlasPoint } from './atlas-schema.ts';
import type { Ctx2D, ImageSource, Size } from './canvas-types.ts';

export interface SpriteOptions {
  /** Screen position of the pivot in CSS px. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly flipX?: boolean;
  /** Radians, clockwise on screen, about the pivot. */
  readonly rotation?: number;
  /** Extra multiplier on top of the zoom, 1 by default. */
  readonly scale?: number;
  readonly alpha?: number;
}

export interface SpriteDraw {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** Destination rect relative to the pivot, before rotation and flip. */
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: 1 | -1;
  readonly alpha: number;
  /** True when translate, rotate and scale can be skipped and drawImage placed directly. */
  readonly direct: boolean;
}

/** Screen px per frame px at this zoom and extra scale. */
export function frameUnit(zoom: number, scale = 1): number {
  return (zoom * scale) / SPRITE_SCALE;
}

/** World size covered by an untrimmed frame. */
export function frameWorldSize(frame: AtlasFrame): Size {
  return Object.freeze({ w: frame.sourceSize.w / SPRITE_SCALE, h: frame.sourceSize.h / SPRITE_SCALE });
}

export function spriteTransform(frame: AtlasFrame, pivot: AtlasPoint, options: SpriteOptions): SpriteDraw {
  const unit = frameUnit(options.zoom, options.scale ?? 1);
  const rotation = options.rotation ?? 0;
  const flipX = options.flipX ?? false;
  const alpha = options.alpha ?? 1;
  const { frame: rect, spriteSourceSize, sourceSize } = frame;
  return Object.freeze({
    sx: rect.x,
    sy: rect.y,
    sw: rect.w,
    sh: rect.h,
    dx: (spriteSourceSize.x - pivot.x * sourceSize.w) * unit,
    dy: (spriteSourceSize.y - pivot.y * sourceSize.h) * unit,
    dw: rect.w * unit,
    dh: rect.h * unit,
    x: options.x,
    y: options.y,
    rotation,
    scaleX: flipX ? -1 : 1,
    alpha,
    direct: rotation === 0 && !flipX && alpha === 1,
  });
}

/** Draws one frame through the minimal context interface. */
export function drawSprite(ctx: Ctx2D, image: ImageSource, frame: AtlasFrame, pivot: AtlasPoint, options: SpriteOptions): void {
  const t = spriteTransform(frame, pivot, options);
  if (t.direct) {
    ctx.drawImage(image, t.sx, t.sy, t.sw, t.sh, t.x + t.dx, t.y + t.dy, t.dw, t.dh);
    return;
  }
  ctx.save();
  ctx.translate(t.x, t.y);
  if (t.rotation !== 0) ctx.rotate(t.rotation);
  if (t.scaleX !== 1) ctx.scale(t.scaleX, 1);
  if (t.alpha !== 1) ctx.globalAlpha = t.alpha;
  ctx.drawImage(image, t.sx, t.sy, t.sw, t.sh, t.dx, t.dy, t.dw, t.dh);
  ctx.restore();
}
