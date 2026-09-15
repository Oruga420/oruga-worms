/**
 * Recording fakes for the terrain tests. The terrain layer never touches the DOM: every drawing
 * call goes through the structural Context2DLike interface, so tests inject these fakes and
 * assert the exact call list (the rects an erase produced, the gradient a scorch ring used, the
 * tiles a blit drew). The readback fake plays the offscreen canvas of the PNG level loader.
 */

import type { Context2DLike, ContextFactory, FillStyleLike, GradientLike } from '@/terrain/context.ts';
import type { ImageDataLike, ReadbackContext, ReadbackContextFactory } from '@/terrain/png-level.ts';

export interface RecordedRect {
  readonly op: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The fill style at the time of the call: a colour string, or "gradient". */
  readonly style: string;
}

export interface RecordedStop {
  readonly offset: number;
  readonly color: string;
}

export interface RecordedGradient {
  readonly x0: number;
  readonly y0: number;
  readonly r0: number;
  readonly x1: number;
  readonly y1: number;
  readonly r1: number;
  readonly stops: RecordedStop[];
}

export interface RecordedDraw {
  readonly image: object;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

export interface FakeSurface {
  readonly width: number;
  readonly height: number;
}

export interface FakeContext extends Context2DLike {
  readonly canvas: FakeSurface;
  readonly rects: RecordedRect[];
  readonly clears: RecordedRect[];
  readonly gradients: RecordedGradient[];
  readonly draws: RecordedDraw[];
}

export function createFakeContext(width: number, height: number): FakeContext {
  const rects: RecordedRect[] = [];
  const clears: RecordedRect[] = [];
  const gradients: RecordedGradient[] = [];
  const draws: RecordedDraw[] = [];
  let fillStyle: FillStyleLike = '#000000';
  const styleLabel = (): string => (typeof fillStyle === 'string' ? fillStyle : 'gradient');

  const ctx: FakeContext = {
    canvas: { width, height },
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    get fillStyle(): FillStyleLike {
      return fillStyle;
    },
    set fillStyle(value: FillStyleLike) {
      fillStyle = value;
    },
    rects,
    clears,
    gradients,
    draws,
    fillRect(x, y, w, h) {
      rects.push({ op: ctx.globalCompositeOperation, x, y, w, h, style: styleLabel() });
    },
    clearRect(x, y, w, h) {
      clears.push({ op: ctx.globalCompositeOperation, x, y, w, h, style: styleLabel() });
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const stops: RecordedStop[] = [];
      gradients.push({ x0, y0, r0, x1, y1, r1, stops });
      const gradient: GradientLike = {
        addColorStop(offset, color) {
          stops.push({ offset, color });
        },
      };
      return gradient;
    },
    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
      draws.push({ image, sx, sy, sw, sh, dx, dy, dw, dh });
    },
  };
  return ctx;
}

export interface FakeFactory {
  readonly factory: ContextFactory;
  readonly created: FakeContext[];
}

/** A context factory that remembers every context it handed out, in creation order. */
export function createFakeFactory(): FakeFactory {
  const created: FakeContext[] = [];
  const factory: ContextFactory = (width, height) => {
    const ctx = createFakeContext(width, height);
    created.push(ctx);
    return ctx;
  };
  return { factory, created };
}

export interface FakeReadbackContext extends FakeContext, ReadbackContext {
  readonly readbacks: number;
}

export interface FakeReadbackOptions {
  /** Simulate a tainted canvas: the readback throws. */
  readonly throwOnRead?: boolean;
  /** Return a buffer of the wrong length, as a broken decoder would. */
  readonly truncate?: boolean;
}

export interface FakeReadbackFactory {
  readonly factory: ReadbackContextFactory;
  readonly created: FakeReadbackContext[];
}

/** An offscreen canvas stand in whose single readback returns the given RGBA bytes. */
export function createReadbackFactory(
  pixels: Uint8ClampedArray,
  options: FakeReadbackOptions = {},
): FakeReadbackFactory {
  const created: FakeReadbackContext[] = [];
  const factory: ReadbackContextFactory = (width, height) => {
    const base = createFakeContext(width, height);
    let readbacks = 0;
    const ctx: FakeReadbackContext = {
      ...base,
      get fillStyle(): FillStyleLike {
        return base.fillStyle;
      },
      set fillStyle(value: FillStyleLike) {
        base.fillStyle = value;
      },
      get readbacks(): number {
        return readbacks;
      },
      getImageData(sx, sy, sw, sh): ImageDataLike {
        readbacks += 1;
        if (options.throwOnRead) throw new Error('canvas is tainted');
        const data = options.truncate ? pixels.subarray(0, pixels.length - 4) : pixels;
        return { width: sw + sx * 0, height: sh + sy * 0, data };
      },
    };
    created.push(ctx);
    return ctx;
  };
  return { factory, created };
}

/** Builds an RGBA buffer for a width x height image from a per pixel alpha function. */
export function alphaImage(width: number, height: number, alphaAt: (x: number, y: number) => number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = 90;
      pixels[i + 1] = 60;
      pixels[i + 2] = 30;
      pixels[i + 3] = alphaAt(x, y);
    }
  }
  return pixels;
}

/** FNV-1a over a byte array, as a short hex string, for determinism tests. */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
