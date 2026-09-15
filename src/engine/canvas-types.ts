/**
 * Minimal Canvas 2D interfaces the engine draws through. CanvasRenderingContext2D satisfies
 * Ctx2D structurally (it is a strict subset), so the browser context is passed as is, while
 * tests hand in recording fakes. Vitest runs in node with no canvas, which is why every draw
 * path takes one of these instead of the DOM class.
 *
 * getImageData is deliberately absent from Ctx2D: the only readback in the engine is the tint
 * bake at load time, which uses the separate ReadbackCtx2D below.
 */

export type ImageSource = CanvasImageSource;

export type FillStyle = string | CanvasGradient | CanvasPattern;

export interface Ctx2D {
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  imageSmoothingEnabled: boolean;
  fillStyle: FillStyle;
  strokeStyle: FillStyle;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  drawImage(
    image: ImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

/** Pixel readback, allowed only in the tint bake at load time (engine/tint.ts). */
export interface ReadbackCtx2D extends Ctx2D {
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imageData: ImageData, dx: number, dy: number): void;
}

/** What the renderer needs from a canvas element; HTMLCanvasElement satisfies it. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): Ctx2D | null;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
