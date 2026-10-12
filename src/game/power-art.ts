/** Original worm-scale effects; visual reference provenance lives in docs/visual-reference-sources.md. */
import type { Ctx2D } from '../engine/canvas-types.ts';
import { clamp, TWO_PI } from '../core/math.ts';

const ICE = '#a7f2ff';
const GOLD = '#ffe18b';
const BLUE = '#7edcff';
const WHITE = '#f5ffff';

function ring(ctx: Ctx2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.stroke();
}

function polygon(ctx: Ctx2D, x: number, y: number, radius: number, sides: number, angle = 0): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const a = angle + i * TWO_PI / sides;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Seven joined cells, translucent interiors rather than a solid blue disc. */
export function drawHexField(ctx: Ctx2D, x: number, y: number, zoom: number, strength: number, timeMs: number): void {
  const r = 11 * zoom;
  const centers = [{ x, y }, ...Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI / 6 + i * Math.PI / 3;
    return { x: x + Math.cos(angle) * r * Math.sqrt(3), y: y + Math.sin(angle) * r * Math.sqrt(3) };
  })];
  ctx.save();
  const pulse = 0.8 + Math.sin(timeMs / 240) * 0.1;
  for (const [i, center] of centers.entries()) {
    polygon(ctx, center.x, center.y, r, 6);
    ctx.globalAlpha = 0.1 + 0.09 * clamp(strength, 0, 1);
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.globalAlpha = pulse * (i === 0 ? 1 : 0.7);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(1, zoom * 1.3);
    ctx.stroke();
  }
  ctx.restore();
}

/** Geometry is supplied by the same clipped-area solver used for the cast. */
export function drawRoomField(ctx: Ctx2D, x: number, y: number, radius: number, progress: number, timeMs: number): void {
  if (!Number.isFinite(radius) || radius <= 0) return;
  ctx.save();
  ctx.fillStyle = BLUE;
  ctx.globalAlpha = 0.035 + 0.04 * clamp(progress, 0, 1);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ring(ctx, x, y, radius);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.2;
  ring(ctx, x, y, radius);
  // Curved latitude bands distinguish ROOM from the hexagonal defensive magic.
  for (const latitude of [-0.45, 0, 0.45]) {
    const halfWidth = radius * Math.sqrt(1 - latitude * latitude);
    ctx.beginPath();
    for (let step = 0; step <= 48; step += 1) {
      const a = step / 48 * TWO_PI;
      const px = x + Math.cos(a) * halfWidth;
      const py = y + latitude * radius + Math.sin(a) * radius * 0.12;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 0.65;
  const angle = timeMs / 1500;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, 3, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

export function drawFrozenMark(ctx: Ctx2D, x: number, feetY: number, zoom: number, turns: number, plate = true): void {
  if (turns <= 0) return;
  ctx.save();
  if (plate) {
    ctx.fillStyle = ICE;
    ctx.strokeStyle = WHITE;
    ctx.globalAlpha = 0.17;
    polygon(ctx, x, feetY - 12 * zoom, 25 * zoom, 6, Math.PI / 6);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1, zoom);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#10243c';
  ctx.fillRect(x - 36, feetY - 43 * zoom - 8, 72, 16);
  ctx.fillStyle = ICE;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`FROZEN ${turns}`, x, feetY - 43 * zoom);
  ctx.restore();
}

export function drawImmortalMark(ctx: Ctx2D, x: number, feetY: number, zoom: number, charges: number, timeMs: number, halo = true): void {
  if (charges <= 0) return;
  const count = Math.min(3, Math.floor(charges));
  ctx.save();
  if (halo) {
    ctx.strokeStyle = GOLD;
    ctx.globalAlpha = 0.2 + Math.sin(timeMs / 250) * 0.06;
    ctx.lineWidth = 3 * zoom;
    ring(ctx, x, feetY - 12 * zoom, 25 * zoom);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = GOLD;
  for (let i = 0; i < count; i += 1) {
    ctx.beginPath();
    ctx.arc(x + (i - (count - 1) / 2) * 10 * zoom, feetY - 43 * zoom, 3 * zoom, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

export function drawTimeStop(ctx: Ctx2D, x: number, y: number, zoom: number, progress: number): void {
  const p = clamp(progress, 0, 1);
  const r = (24 + 64 * p) * zoom;
  ctx.save();
  ctx.globalAlpha = 1 - p * 0.8;
  ctx.strokeStyle = ICE;
  ctx.lineWidth = 2 * zoom;
  ring(ctx, x, y, r);
  for (let i = 0; i < 12; i += 1) {
    const a = i * TWO_PI / 12;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.84, y + Math.sin(a) * r * 0.84);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.6);
  ctx.lineTo(x, y);
  ctx.lineTo(x + r * 0.4, y);
  ctx.stroke();
  ctx.restore();
}

/** A cartoon finisher, requested only after the authoritative kill and never for a blocked slash. */
export function drawClawFinish(ctx: Ctx2D, x: number, y: number, zoom: number, progress: number, facing: number): void {
  const p = clamp(progress, 0, 1);
  ctx.save();
  ctx.globalAlpha = Math.min(1, (1 - p) * 3);
  ctx.translate(x + facing * p * 42 * zoom, y - (Math.sin(p * Math.PI) * 42 + 6) * zoom);
  ctx.rotate(facing * p * Math.PI * 1.6);
  ctx.fillStyle = '#a42339';
  ctx.fillRect(-4 * zoom, 4 * zoom, 8 * zoom, 3 * zoom);
  ctx.fillStyle = '#d9ae88';
  ctx.beginPath();
  ctx.arc(0, 0, 6 * zoom, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = '#392536';
  ctx.lineWidth = zoom;
  ctx.stroke();
  ctx.fillStyle = '#58b99d';
  ctx.fillRect(-6 * zoom, -4 * zoom, 12 * zoom, 3 * zoom);
  ctx.fillStyle = '#ffffff';
  for (const dx of [-2, 2]) {
    ctx.beginPath();
    ctx.arc(dx * zoom, 0, 1.7 * zoom, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Three metal trails; red accent obeys the game's existing gore preference. */
export function drawClawStrike(ctx: Ctx2D, x: number, y: number, zoom: number, progress: number, gore: boolean): void {
  const p = clamp(progress, 0, 1);
  ctx.save();
  ctx.globalAlpha = Math.sin(p * Math.PI);
  for (let i = 0; i < 3; i += 1) {
    const offset = (i - 1) * 10 * zoom;
    ctx.beginPath();
    ctx.moveTo(x - 35 * zoom + offset, y + 34 * zoom);
    ctx.lineTo(x + 25 * zoom + offset, y - 30 * zoom);
    ctx.strokeStyle = gore ? '#ef4c50' : GOLD;
    ctx.lineWidth = 8 * zoom;
    ctx.stroke();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 2 * zoom;
    ctx.stroke();
  }
  ctx.restore();
}
