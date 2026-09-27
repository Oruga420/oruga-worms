/**
 * Versioned URLs for the files under public/sprites and public/audio. vercel.json serves both
 * immutable for a year, so a file changed under the same URL never reaches a returning player:
 * the browser keeps its old copy without asking (a cached weapon atlas from before the Ryuko
 * Ranbu had no frame for it, so its icon and fist went missing). The build stamps each file's
 * content hash as __ASSET_VERSIONS__ (vite.config.ts) and assetUrl appends it, so a changed file
 * is a new URL and an unchanged one stays cached.
 */

declare const __ASSET_VERSIONS__: Readonly<Record<string, string>> | undefined;

export type AssetVersions = Readonly<Record<string, string>>;

/** Empty where nothing defines the map (unit tests): every path is then its own URL. */
const BUILD_VERSIONS: AssetVersions = typeof __ASSET_VERSIONS__ === 'undefined' ? {} : __ASSET_VERSIONS__;

/**
 * The URL to load a public file from: its path, plus ?v= and its content hash when the build has
 * one. The path may be absolute ("/sprites/...") or relative to the site root, as the mixer joins
 * the sound paths ("audio/sfx/...").
 */
export function assetUrl(path: string, versions: AssetVersions = BUILD_VERSIONS): string {
  const version = versions[path.startsWith('/') ? path : `/${path}`];
  return version === undefined ? path : `${path}?v=${version}`;
}
