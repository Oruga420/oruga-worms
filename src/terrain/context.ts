/**
 * Structural 2D context types for the terrain layer. The terrain never touches the DOM: every
 * drawing call goes through Context2DLike, which a real CanvasRenderingContext2D (or an
 * OffscreenCanvasRenderingContext2D) satisfies structurally, while Vitest injects recording
 * fakes (tests/unit/terrain/fakes.ts) and asserts the exact call list.
 *
 * The surface is deliberately tiny: the tile layer only needs rect fills, rect clears, a radial
 * gradient for the scorch ring and a 9 argument drawImage for the culled blit. getImageData is
 * absent on purpose; the only readback lives in png-level.ts behind its own ReadbackContext.
 */

/** Anything with pixel dimensions: an image, a canvas or a manifest size entry. */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/** A canvas like object usable as a drawImage source; HTMLCanvasElement and OffscreenCanvas satisfy it. */
export type SurfaceLike = PixelSize;

/** What drawImage accepts: a browser image source or one of our own tile surfaces. */
export type ImageLike = SurfaceLike | CanvasImageSource;

export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface PatternLike {
  setTransform(transform?: unknown): void;
}

export type FillStyleLike = string | GradientLike | PatternLike;

export interface Context2DLike {
  readonly canvas: SurfaceLike;
  globalCompositeOperation: GlobalCompositeOperation;
  imageSmoothingEnabled: boolean;
  fillStyle: FillStyleLike;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): GradientLike;
  drawImage(
    image: ImageLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Creates a fresh drawing surface of the given size and returns its context. */
export type ContextFactory = (width: number, height: number) => Context2DLike;

/** Axis aligned rectangle; the unit (world px, tile px or screen px) is stated at each use. */
export interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Browser factory: a detached canvas per call. Kept here so main.ts has one line to wire and so
 * the terrain files themselves never mention document. Returns null when 2D contexts are
 * unavailable (headless, disabled canvas), which callers turn into a Result.
 */
export function createDomContextFactory(doc: Document): ContextFactory | null {
  const probe = doc.createElement('canvas');
  if (probe.getContext('2d') === null) return null;
  return (width, height) => {
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D context unavailable after a successful probe');
    return ctx;
  };
}
