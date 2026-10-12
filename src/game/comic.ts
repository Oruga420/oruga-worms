import type { Ctx2D, Rect, Size } from '../engine/canvas-types.ts';

export const COMIC = Object.freeze({
  ink: '#101c2c', paper: '#fff1cc', yellow: '#ffd34e', red: '#f05246', cyan: '#67dfdb',
});
const GUTTER = 16;
const PANEL_WIDTH = 680;
const PANEL_HEIGHT = 470;
const DOT_SPACING = 24;

export function comicPanel(viewport: Size): Rect {
  const w = Math.max(0, Math.min(PANEL_WIDTH, viewport.w - GUTTER * 2));
  const h = Math.max(0, Math.min(PANEL_HEIGHT, viewport.h - GUTTER * 2));
  return { x: (viewport.w - w) / 2, y: (viewport.h - h) / 2, w, h };
}

/** Bounded ink and paper texture; no image downloads, layout state or simulation RNG. */
export function drawComicBackdrop(ctx: Ctx2D, viewport: Size, edition: string): void {
  const panel = comicPanel(viewport);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8, 19, 32, 0.84)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  ctx.fillStyle = COMIC.cyan;
  for (let row = 0; row < 16; row += 1) {
    const y = viewport.h * row / 16;
    ctx.globalAlpha = 0.13;
    ctx.fillRect(0, y, Math.max(0, panel.x - 28 - (row % 4) * 18), 3);
    ctx.fillRect(panel.x + panel.w + 28 + (row % 3) * 18, y + 12, viewport.w * 0.3, 3);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COMIC.red;
  ctx.fillRect(panel.x + 9, panel.y + 9, panel.w, panel.h);
  ctx.fillStyle = COMIC.ink;
  ctx.fillRect(panel.x - 3, panel.y - 3, panel.w + 6, panel.h + 6);
  ctx.fillStyle = COMIC.paper;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.fillStyle = COMIC.ink;
  ctx.globalAlpha = 0.08;
  for (let y = panel.y + 12; y < panel.y + panel.h - 10; y += DOT_SPACING) {
    for (let x = panel.x + 12; x < panel.x + panel.w - 10; x += DOT_SPACING) {
      if (x < panel.x + 90 || x > panel.x + panel.w - 90) ctx.fillRect(x, y, 3, 3);
    }
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COMIC.ink;
  ctx.fillRect(panel.x, panel.y, panel.w, 32);
  ctx.fillStyle = COMIC.paper;
  ctx.font = '700 11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(edition, viewport.w / 2, panel.y + 16, Math.max(0, panel.w - 24));
  ctx.restore();
}

export function drawComicLabel(ctx: Ctx2D, text: string, x: number, y: number, width: number, fontSize: number, color: string): void {
  ctx.save();
  ctx.fillStyle = COMIC.ink;
  ctx.fillRect(x - width / 2 + 4, y - fontSize * 0.8 + 4, width, fontSize * 1.6);
  ctx.fillStyle = color;
  ctx.fillRect(x - width / 2, y - fontSize * 0.8, width, fontSize * 1.6);
  ctx.fillStyle = COMIC.ink;
  ctx.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y, Math.max(0, width - 16));
  ctx.restore();
}
