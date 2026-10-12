import { loadAtlas, type Atlas } from '../engine/atlas.ts';
import { assetUrl } from '../engine/asset-url.ts';
import type { Ctx2D, ImageSource } from '../engine/canvas-types.ts';
import { SPRITE_SCALE } from '../config/units.ts';

export interface PowerAssets {
  readonly atlas: Atlas;
  readonly image: ImageSource;
}
export interface PowerAssetDeps {
  readonly readJson: (url: string) => Promise<unknown>;
  readonly readImage: (url: string) => Promise<ImageSource>;
  readonly warn: (message: string) => void;
}
export type AuthoredPower = 'room-bloom' | 'hex-shield' | 'frost-burst' | 'slash-spark' | 'immortality-wings' | 'frozen-plate' | 'blast-burst';
export interface PowerDraw {
  readonly x: number;
  readonly y: number;
  readonly sizePx?: number;
  /** Screen-space radius anchored to the clip's authored rim, not its transparent tile boundary. */
  readonly radiusPx?: number;
  readonly alpha?: number;
  readonly flipX?: boolean;
}
const LOAD_TIMEOUT_MS = 12000;

function browserImage(url: string): Promise<ImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      reject(new Error('Power sheet loading timed out'));
    }, LOAD_TIMEOUT_MS);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('Power sheet loading failed')); };
    image.src = url;
  });
}

const BROWSER_DEPS: PowerAssetDeps = {
  readJson: async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Power atlas HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  },
  readImage: browserImage,
  warn: (message) => console.warn(message),
};

export async function loadPowerAssets(deps: PowerAssetDeps = BROWSER_DEPS): Promise<PowerAssets | null> {
  try {
    const [json, image] = await Promise.all([
      deps.readJson(assetUrl('/sprites/fx/painted-v2.json')),
      deps.readImage(assetUrl('/sprites/fx/painted-v2.png')),
    ]);
    const loaded = loadAtlas(json, image);
    if (!loaded.ok) throw new Error(loaded.error.message);
    return Object.freeze({ atlas: loaded.value, image });
  } catch (error: unknown) {
    deps.warn(`Painted sprite atlas unavailable; fallback effects remain active. ${error instanceof Error ? error.message : 'Asset error'}`);
    return null;
  }
}

/** A complete radius-bound clip can replace the legacy large particle cloud at emission time. */
export function canRenderRadiusSprite(assets: PowerAssets | null | undefined, animation: AuthoredPower): boolean {
  if (!assets) return false;
  const rim = assets.atlas.attachOffset(animation, 'rim');
  if (!rim || !Number.isFinite(Math.hypot(rim.x, rim.y)) || Math.hypot(rim.x, rim.y) <= 0) return false;
  const frames = assets.atlas.frameIds(animation);
  return frames.length > 0 && frames.every((id) => assets.atlas.frame(id) !== undefined);
}

/** The sim drives progress; sprite playback cannot advance or change the attack outcome. */
export function drawAuthoredPower(ctx: Ctx2D, assets: PowerAssets | null | undefined, animation: AuthoredPower, progress: number, draw: PowerDraw): boolean {
  if (!assets || ![progress, draw.x, draw.y, draw.alpha ?? 1].every(Number.isFinite)) return false;
  const frames = assets.atlas.frameIds(animation);
  const index = Math.min(frames.length - 1, Math.floor(Math.max(0, Math.min(1, progress)) * frames.length));
  const id = frames[index];
  const frame = id === undefined ? undefined : assets.atlas.frame(id);
  if (!frame) return false;
  let width = draw.sizePx ?? 0;
  if (draw.radiusPx !== undefined) {
    const rim = assets.atlas.attachOffset(animation, 'rim');
    const nominal = rim === undefined ? 0 : Math.hypot(rim.x, rim.y);
    if (!Number.isFinite(nominal) || nominal <= 0 || !Number.isFinite(draw.radiusPx) || draw.radiusPx <= 0) return false;
    width = frame.sourceSize.w * draw.radiusPx / nominal;
  }
  if (!Number.isFinite(width) || width <= 0) return false;
  const height = width * frame.sourceSize.h / frame.sourceSize.w;
  const pivot = assets.atlas.pivotOf(frame);
  const source = frame.frame;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * Math.max(0, Math.min(1, draw.alpha ?? 1));
  if (draw.flipX === true) {
    ctx.translate(draw.x, draw.y);
    ctx.scale(-1, 1);
    ctx.drawImage(assets.image, source.x, source.y, source.w, source.h, -pivot.x * width, -pivot.y * height, width, height);
  } else {
    ctx.drawImage(assets.image, source.x, source.y, source.w, source.h, draw.x - pivot.x * width, draw.y - pivot.y * height, width, height);
  }
  ctx.restore();
  return true;
}

export interface VictimSprite extends PowerAssets {
  readonly size?: number;
  readonly facing?: 1 | -1;
}

/** Detach the actual character's painted head; this is presentation only, after a confirmed kill. */
export function drawVictimHead(ctx: Ctx2D, sprite: VictimSprite | null | undefined, x: number, y: number, zoom: number, progress: number, direction: number): boolean {
  if (!sprite || ![x, y, zoom, progress].every(Number.isFinite) || zoom <= 0) return false;
  const frame = sprite.atlas.frame('idle_a');
  if (!frame) return false;
  const p = Math.max(0, Math.min(1, progress));
  const source = frame.frame;
  const sx = source.x + Math.round(source.w * 0.3);
  const sy = source.y + Math.round(source.h * 0.3);
  const sw = Math.round(source.w * 0.4);
  const sh = Math.round(source.h * 0.32);
  const scale = zoom * (sprite.size ?? 1) / SPRITE_SCALE;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (1 - p) * 3);
  ctx.translate(x + direction * p * 42 * zoom, y - (Math.sin(p * Math.PI) * 42 + 6) * zoom);
  ctx.rotate(direction * p * Math.PI * 1.6);
  if (sprite.facing === -1) ctx.scale(-1, 1);
  ctx.drawImage(sprite.image, sx, sy, sw, sh, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
  ctx.restore();
  return true;
}
