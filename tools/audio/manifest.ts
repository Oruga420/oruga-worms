/**
 * The audio manifest the engine loads (assets/audio/manifest.json). Shape agreed with the engine
 * loader: { version, assets: [{ id, bus, files: { ogg, mp3 }, durationMs, loop, loopStartMs,
 * loopEndMs, gainDb, pitchVariance }] } plus provenance and check fields the engine ignores.
 * Idempotent: the loop upserts one entry at a time and skips entries already ok unless forced.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { err, ok, type Result } from '../../src/core/result.ts';
import type { Bus } from './plan.ts';

export type AssetStatus = 'ok' | 'failed' | 'placeholder';

export interface AssetSource {
  readonly provider: 'elevenlabs';
  readonly endpoint: string;
  readonly model: string;
  readonly prompt?: string;
  readonly text?: string;
  readonly voiceId?: string;
  readonly promptInfluence?: number;
  readonly requestedSeconds?: number;
  readonly attempts: number;
  readonly credits: number;
  readonly sha256: string;
}

export interface AssetChecks {
  readonly durationOk: boolean;
  readonly silenceOk: boolean;
  readonly clipOk: boolean;
  readonly reasons: readonly string[];
  readonly normalization: string;
}

export interface AudioAsset {
  readonly id: string;
  readonly bus: Bus;
  readonly group: string;
  readonly files: { readonly ogg: string; readonly mp3: string };
  readonly durationMs: number;
  readonly loop: boolean;
  readonly loopStartMs: number;
  readonly loopEndMs: number;
  readonly gainDb: number;
  readonly pitchVariance: number;
  readonly channels: number;
  readonly source: AssetSource;
  readonly checks: AssetChecks;
  readonly status: AssetStatus;
}

export interface AudioManifest {
  readonly version: 1;
  readonly generatedAt: string;
  readonly loudness: { readonly sfx: number; readonly voice: number; readonly music: number; readonly truePeak: number };
  readonly assets: readonly AudioAsset[];
}

export function emptyManifest(generatedAt: string): AudioManifest {
  return { version: 1, generatedAt, loudness: { sfx: -16, voice: -18, music: -20, truePeak: -1 }, assets: [] };
}

export function upsertAsset(manifest: AudioManifest, asset: AudioAsset, generatedAt: string): AudioManifest {
  const others = manifest.assets.filter((a) => a.id !== asset.id);
  const assets = [...others, asset].sort((a, b) => a.id.localeCompare(b.id));
  return { ...manifest, generatedAt, assets };
}

export function statusOf(manifest: AudioManifest, id: string): AssetStatus | null {
  return manifest.assets.find((a) => a.id === id)?.status ?? null;
}

export function summarize(manifest: AudioManifest): Readonly<Record<AssetStatus, number>> {
  const out = { ok: 0, failed: 0, placeholder: 0 };
  for (const asset of manifest.assets) out[asset.status] += 1;
  return out;
}

export function loadManifest(path: string, now: string): Result<AudioManifest, string> {
  if (!existsSync(path)) return ok(emptyManifest(now));
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AudioManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.assets)) return err(`manifest ${path} has an unexpected shape`);
    return ok({ ...emptyManifest(now), ...parsed, assets: parsed.assets });
  } catch (error: unknown) {
    return err(`cannot read manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function saveManifest(path: string, manifest: AudioManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
