/** Decode all optional terrain art before game setup; never replace a running mask. */
import { z } from 'zod';
import { assetUrl } from '../engine/asset-url.ts';
import type { ImageLike } from '../terrain/context.ts';
import { makeRasterAsset, type SceneryAssets } from '../terrain/raster.ts';

const IDS = ['spaceship', 'castle', 'kame_house'] as const;
const TIMEOUT_MS = 15000;
const LocalPath = z.string().regex(/^\/scenery\/rendered\/[a-z0-9/-]+\.(png|json)$/);
const Entry = z.object({ color: LocalPath, occupancy: LocalPath });
const Manifest = z.object({ version: z.literal(1), assets: z.object({ spaceship: Entry.optional(), castle: Entry.optional(), kame_house: Entry.optional() }) });

export interface SceneryAssetDeps {
  readonly fetchJson: (url: string) => Promise<unknown>;
  readonly loadImage: (url: string) => Promise<ImageLike>;
  readonly warn: (message: string) => void;
}

function imageFromUrl(url: string): Promise<ImageLike> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('Scenery image timed out.'));
    }, TIMEOUT_MS);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('Scenery image failed to decode.')); };
    image.src = url;
  });
}

const BROWSER_DEPS: SceneryAssetDeps = {
  async fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Scenery fetch returned ${response.status}.`);
    return response.json();
  },
  loadImage: imageFromUrl,
  warn: (message) => console.warn(`[scenery] ${message}`),
};

export async function loadSceneryAssets(deps: SceneryAssetDeps = BROWSER_DEPS): Promise<SceneryAssets> {
  let manifest: z.infer<typeof Manifest>;
  try {
    manifest = Manifest.parse(await deps.fetchJson(assetUrl('/scenery/rendered/manifest.json')));
  } catch {
    deps.warn('Raster manifest unavailable or invalid; keeping vector scenery.');
    return Object.freeze({});
  }
  const entries = await Promise.all(IDS.map(async (id) => {
    const source = manifest.assets[id];
    if (source === undefined) return null;
    try {
      const [image, occupancy] = await Promise.all([deps.loadImage(assetUrl(source.color)), deps.fetchJson(assetUrl(source.occupancy))]);
      const raster = makeRasterAsset(image, occupancy);
      if (raster === null) throw new Error('Raster dimensions or occupancy invalid.');
      return [id, raster] as const;
    } catch {
      deps.warn(`${id} raster unavailable or invalid; keeping its vector fallback.`);
      return null;
    }
  }));
  return Object.freeze(Object.fromEntries(entries.filter((entry) => entry !== null)));
}
