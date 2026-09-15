/**
 * Shared validation helpers for JSON read at system boundaries (asset manifest, audio manifest,
 * settings). Everything here is pure and never throws; callers turn a false or null into a
 * Result error with a path. The path rules implement the ultraplan security requirement that
 * manifests can only point inside the asset root: ids are ^[a-z0-9_]+$ and file paths are
 * relative, with no scheme, no leading slash, no backslash and no dot dot segment.
 */

export const ASSET_ID_PATTERN = /^[a-z0-9_]+$/;

const RELATIVE_PATH_PATTERN = /^[A-Za-z0-9_./-]+$/;

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The number itself when it is a finite JSON number, null for anything else (strings included). */
export function toFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

/** A path that stays inside the asset root once joined to it. */
export function isRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false;
  if (!RELATIVE_PATH_PATTERN.test(value)) return false;
  if (value.startsWith('/') || value.includes('//')) return false;
  return value.split('/').every((segment) => segment !== '..');
}

/** Joins a base URL or directory and a relative path with exactly one slash between them. */
export function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const trimmedPath = path.startsWith('./') ? path.slice(2) : path;
  return trimmedBase === '' ? trimmedPath : `${trimmedBase}/${trimmedPath}`;
}

/** The directory part of a URL or path, without the trailing slash; empty when there is none. */
export function dirnameUrl(url: string): string {
  const index = url.lastIndexOf('/');
  return index === -1 ? '' : url.slice(0, index);
}
