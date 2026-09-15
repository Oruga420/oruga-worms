/**
 * PNG level loader (architecture.md section B). The asset pipeline ships level_XX_mask.png where
 * alpha above 128 means solid. The loader draws the image once on an offscreen surface, reads
 * the pixels back ONCE, writes the byte mask and marks the outer 2 px ring as bedrock so nothing
 * can carve the world open.
 *
 * getImageData NOTE: this file is the single place under src/terrain where a pixel readback is
 * allowed (eslint.config.js, rule orugas/no-get-image-data-in-hot-paths). It runs at load time,
 * never during play; a readback stalls the GPU pipeline and would destroy frame time. Every
 * other terrain file reads the Uint8Array mask instead.
 *
 * Failures come back as Result values (core/result.ts), never as throws across the boundary:
 * a manifest with a bad size, a decoded image whose size disagrees with the manifest, a tainted
 * canvas that refuses the readback, or a decoder that returns a short buffer.
 */

import { err, ok, type Result } from '../core/result.ts';
import type { Context2DLike, PixelSize } from './context.ts';
import { SOLID, createMask, isValidDimension, markBorderBedrock, type TerrainMask } from './mask.ts';

/** Alpha strictly above this is solid; 128 itself is air. */
export const SOLID_ALPHA_THRESHOLD = 128;

export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes, row major, 4 per pixel. */
  readonly data: Uint8ClampedArray;
}

/** A drawing context that can also read pixels back; only this loader may ask for one. */
export interface ReadbackContext extends Context2DLike {
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageDataLike;
}

export type ReadbackContextFactory = (width: number, height: number) => ReadbackContext;

export type PngLevelError =
  | { readonly code: 'invalid_size'; readonly message: string; readonly expected: PixelSize }
  | {
      readonly code: 'size_mismatch';
      readonly message: 'level mask size mismatch';
      readonly expected: PixelSize;
      readonly actual: PixelSize;
    }
  | { readonly code: 'readback_failed'; readonly message: string };

function plainSize(size: PixelSize): PixelSize {
  return Object.freeze({ width: size.width, height: size.height });
}

function describe(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * Builds a mask from RGBA bytes: alpha above the threshold is SOLID, then the border ring is
 * bedrock. Pure over its inputs apart from the mask it returns.
 */
export function maskFromAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = SOLID_ALPHA_THRESHOLD,
): TerrainMask {
  const mask = createMask(width, height);
  const bytes = mask.data;
  for (let i = 0, alphaIndex = 3; i < bytes.length; i += 1, alphaIndex += 4) {
    if ((data[alphaIndex] ?? 0) > threshold) bytes[i] = SOLID;
  }
  markBorderBedrock(mask);
  return mask;
}

/**
 * Loads a decoded level image into a terrain mask. The manifest entry is validated first and the
 * image size is checked against it before any surface is created, so a mismatch costs nothing.
 */
export function loadPngLevel(
  image: PixelSize,
  expected: PixelSize,
  createContext: ReadbackContextFactory,
): Result<TerrainMask, PngLevelError> {
  if (!isValidDimension(expected.width) || !isValidDimension(expected.height)) {
    return err(
      Object.freeze({
        code: 'invalid_size' as const,
        message: `level manifest size must be positive integers, got ${expected.width} x ${expected.height}`,
        expected: plainSize(expected),
      }),
    );
  }
  if (image.width !== expected.width || image.height !== expected.height) {
    return err(
      Object.freeze({
        code: 'size_mismatch' as const,
        message: 'level mask size mismatch' as const,
        expected: plainSize(expected),
        actual: plainSize(image),
      }),
    );
  }

  const { width, height } = expected;
  let pixels: ImageDataLike;
  try {
    const ctx = createContext(width, height);
    ctx.drawImage(image, 0, 0, width, height, 0, 0, width, height);
    // The one allowed readback in the terrain layer; see the file comment.
    pixels = ctx.getImageData(0, 0, width, height);
  } catch (thrown: unknown) {
    return err(Object.freeze({ code: 'readback_failed' as const, message: `level mask readback failed: ${describe(thrown)}` }));
  }

  const needed = width * height * 4;
  if (pixels.data.length < needed) {
    return err(
      Object.freeze({
        code: 'readback_failed' as const,
        message: `level mask readback returned ${pixels.data.length} bytes, expected ${needed}`,
      }),
    );
  }
  return ok(maskFromAlpha(pixels.data, width, height));
}
