/** Decoded static prop silhouettes; only world borders, never prop bounds, become bedrock. */
import { z } from 'zod';
import type { ImageLike, RectLike } from './context.ts';
import { BEDROCK, SOLID, type Span, type TerrainMask } from './mask.ts';
import type { ScenarioId } from './scenarios.ts';

const MAX_ASSET_SIZE = 2048;
const SpanSchema = z.object({ y: z.number().int().nonnegative(), x0: z.number().int().nonnegative(), x1: z.number().int().nonnegative() });
const OccupancySchema = z.object({
  width: z.number().int().min(1).max(MAX_ASSET_SIZE),
  height: z.number().int().min(1).max(MAX_ASSET_SIZE),
  spans: z.array(SpanSchema).min(1).max(MAX_ASSET_SIZE * 64),
}).refine((value) => value.spans.every((span) => span.y < value.height && span.x0 <= span.x1 && span.x1 < value.width));

export interface RasterAsset {
  readonly image: ImageLike;
  readonly width: number;
  readonly height: number;
  readonly spans: readonly Span[];
}
export type SceneryAssets = Readonly<Partial<Record<ScenarioId, RasterAsset>>>;

export function makeRasterAsset(image: ImageLike, occupancy: unknown): RasterAsset | null {
  const result = OccupancySchema.safeParse(occupancy);
  if (!result.success || !('width' in image) || !('height' in image)) return null;
  const data = result.data;
  if (image.width !== data.width || image.height !== data.height) return null;
  return Object.freeze({ image, width: data.width, height: data.height, spans: Object.freeze(data.spans.map((span) => Object.freeze(span))) });
}

/** Letterbox, anchored at the bottom of the available world rectangle. */
export function fitRaster(asset: RasterAsset, box: RectLike): RectLike {
  const scale = Math.min(box.w / asset.width, box.h / asset.height);
  const w = Math.max(1, Math.round(asset.width * scale));
  const h = Math.max(1, Math.round(asset.height * scale));
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + box.h - h), w, h };
}

/** Nearest-neighbor pixel-center mapping, matching an unsmoothed drawImage. */
export function stampRaster(mask: TerrainMask, asset: RasterAsset, rect: RectLike): void {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) || rect.w <= 0 || rect.h <= 0) throw new RangeError('Raster placement requires integer pixels and positive dimensions.');
  for (const span of asset.spans) {
    const y0 = Math.max(0, rect.y + Math.ceil(span.y * rect.h / asset.height - 0.5));
    const y1 = Math.min(mask.height - 1, rect.y + Math.ceil((span.y + 1) * rect.h / asset.height - 0.5) - 1);
    const x0 = Math.max(0, rect.x + Math.ceil(span.x0 * rect.w / asset.width - 0.5));
    const x1 = Math.min(mask.width - 1, rect.x + Math.ceil((span.x1 + 1) * rect.w / asset.width - 0.5) - 1);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const index = y * mask.width + x;
        if (mask.data[index] !== BEDROCK) mask.data[index] = SOLID;
      }
    }
  }
}
