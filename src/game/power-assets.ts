import { loadAtlas, type Atlas } from '../engine/atlas.ts';
import { assetUrl } from '../engine/asset-url.ts';
import type { Ctx2D, ImageSource } from '../engine/canvas-types.ts';

export interface PowerAssets {
  readonly atlas: Atlas;
  readonly image: ImageSource;
}
export interface PowerAssetDeps {
  readonly readJson: (url: string) => Promise<unknown>;
  readonly readImage: (url: string) => Promise<ImageSource>;
  readonly warn: (message: string) => void;
}
export type AuthoredPower = 'room-bloom' | 'hex-shield' | 'time-stop-clock' | 'slash-spark' | 'immortality-wings';
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
      deps.readJson(assetUrl('/sprites/fx/manimgx-fx.json')),
      deps.readImage(assetUrl('/sprites/fx/manimgx-fx.png')),
    ]);
    const loaded = loadAtlas(json, image);
    if (!loaded.ok) throw new Error(loaded.error.message);
    return Object.freeze({ atlas: loaded.value, image });
  } catch (error: unknown) {
    deps.warn(`ManimGX atlas unavailable; procedural effects remain active. ${error instanceof Error ? error.message : 'Asset error'}`);
    return null;
  }
}

/** The sim drives progress; sprite playback cannot advance or change the attack outcome. */
export function drawAuthoredPower(ctx: Ctx2D, assets: PowerAssets | null | undefined, animation: AuthoredPower, progress: number, x: number, y: number, size: number): boolean {
  if (!assets || !Number.isFinite(progress) || size <= 0) return false;
  const frames = assets.atlas.frameIds(animation);
  const index = Math.min(frames.length - 1, Math.floor(Math.max(0, Math.min(1, progress)) * frames.length));
  const id = frames[index];
  const frame = id === undefined ? undefined : assets.atlas.frame(id);
  if (!frame) return false;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  const source = frame.frame;
  ctx.drawImage(assets.image, source.x, source.y, source.w, source.h, x - size / 2, y - size / 2, size, size);
  ctx.restore();
  return true;
}
