/** Three base candidates only. Review these before any downstream asset production. */
export const MODEL = 'openai/gpt-image-2.5-flare';
/** Coordinator supplied price for one 1024-square high-quality image; not a billing receipt. */
export const EXPECTED_IMAGE_USD = 0.128;
export const EXPECTED_TOTAL_USD = EXPECTED_IMAGE_USD * 3;
export const MAX_IMAGE_BUDGET_USD = 4;
export type AssetId = 'spaceship' | 'castle' | 'kame-house';

const STYLE = 'A single polished hand-painted 2D artillery-game environment prop, readable black-violet ink contours, precise warm rim lighting, detailed but clear cel-shaded volumes, designed for a small game screen. Orthographic side elevation with only a very slight three-quarter hint, full object uncropped, centered with a generous transparent margin. Transparent background, no ground plane, no cast shadow outside the object, no characters, no interface, no collage, no watermark.';

export const ASSET_PLAN: readonly { readonly id: AssetId; readonly prompt: string }[] = Object.freeze([
  {
    id: 'spaceship',
    prompt: `${STYLE} Design an ORIGINAL compact horizontal deep-space salvage ship, not from an existing franchise. Three rear engine housings on the left, segmented slate-blue metal hull, restrained amber cockpit glass at the right, stepped walkable upper deck, small antenna, bolted plating, directional wear, cyan internal lighting. Strong asymmetrical silhouette with a readable center of mass; industrial, a little whimsical, not photorealistic. No stars or planet in this isolated prop.`,
  },
  {
    id: 'castle',
    prompt: `${STYLE} Design an ORIGINAL storybook hill-fort castle, not a real landmark or existing franchise location. Two stout crenellated outer towers, a taller central keep, connecting defensive wall, pointed gate opening, slate stone blocks, terracotta-red small banners, warm amber window slits, violet twilight shadows. Strong coherent silhouette and a clear continuous lower wall. No mountain, forest, people or sky inside this isolated prop.`,
  },
  {
    id: 'kame-house',
    prompt: `${STYLE} Kame House, Master Roshi's house from Dragon Ball. Use BOTH attached reference images as visual evidence for the building; preserve its recognizable architecture and color relationships rather than inventing a different house. The anime still is the color/layout reference; the product photograph clarifies the unobstructed building form, but do NOT reproduce its toy assembly seams or miniature standees. Produce only the house as an isolated 2D game prop, with its KAME HOUSE facade lettering. Omit people, turtle, beach, palm trees, sea and the product base. Keep the pitched gable and red roof, not a dome. This is a stylized reference-conditioned base candidate, not an official render.`,
  },
]);

/** Publication/update dates only. Original frame/photo creation dates were not established. */
export const KAME_REFERENCE_METADATA = Object.freeze([
  {
    file: 'kame-as-wide/reference.jpg',
    source: 'https://en.as.com/meristation/news/dragon-ball-adapted-an-icon-poorly-and-this-37-year-old-toriyama-artwork-proves-it-n/',
    published: '2025-04-26',
    originalImageDate: 'unknown; archival anime frame republished in article',
  },
  {
    file: 'kame-707street-model/reference.jpg',
    source: 'https://707street.com/products/puremind-dragon-ball-kame-house-wood-construction-set-with-acrylic-figures',
    published: '2025-11-06',
    imageMetadataUpdated: '2026-03-04',
    originalImageDate: 'unknown; product photograph, not anime geometry authority',
  },
]);

export function validateBudget(budget: number): void {
  if (!Number.isFinite(budget) || budget < EXPECTED_TOTAL_USD || budget > MAX_IMAGE_BUDGET_USD) {
    throw new Error(`Explicit image budget must be between ${EXPECTED_TOTAL_USD} and ${MAX_IMAGE_BUDGET_USD} USD.`);
  }
}

export function buildImageInput(id: AssetId, referenceData: readonly string[]) {
  const item = ASSET_PLAN.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error('Unknown base asset.');
  if (id === 'kame-house' && (referenceData.length !== 2 || !referenceData.every((uri) => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(uri)))) {
    throw new Error('Kame House requires two attached JPEG image inputs.');
  }
  return {
    prompt: item.prompt,
    quality: 'high' as const,
    aspect_ratio: '1:1' as const,
    output_format: 'png' as const,
    background: 'transparent' as const,
    number_of_images: 1,
    ...(id === 'kame-house' ? { input_images: [...referenceData] } : {}),
  };
}
