import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUS_NAMES, isBusName, validateAudioManifest } from '@/engine/audio-manifest.ts';

type Json = Record<string, unknown>;

function asset(overrides: Json = {}): Json {
  return {
    id: 'wpn_bazooka_launch',
    bus: 'sfx',
    group: 'weapons',
    files: { ogg: 'audio/sfx/wpn_bazooka_launch.ogg', mp3: 'audio/sfx/wpn_bazooka_launch.mp3' },
    durationMs: 780,
    loop: false,
    loopStartMs: 0,
    loopEndMs: 0,
    gainDb: 0,
    pitchVariance: 0.08,
    channels: 1,
    source: { provider: 'elevenlabs', endpoint: 'sound-generation', model: 'eleven_text_to_sound_v2', attempts: 1, credits: 32, sha256: 'abc' },
    checks: { durationOk: true, silenceOk: true, clipOk: true, reasons: [], normalization: 'peak' },
    status: 'ok',
    ...overrides,
  };
}

function manifest(assets: readonly unknown[], extra: Json = {}): Json {
  return {
    version: 1,
    generatedAt: '2026-09-03T00:00:00Z',
    loudness: { sfx: -16, voice: -18, music: -20, truePeak: -1 },
    assets,
    ...extra,
  };
}

function expectError(input: unknown, code: string, path: string): void {
  const result = validateAudioManifest(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.path).toBe(path);
  }
}

describe('audio manifest: accepted shapes', () => {
  it('accepts the pipeline shape and ignores unknown fields at every level', () => {
    const result = validateAudioManifest(manifest([asset({ future: 'field' })], { voiceBanks: { en: {} }, future: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value.assets['wpn_bazooka_launch'];
    expect(info).toEqual({
      id: 'wpn_bazooka_launch',
      bus: 'sfx',
      group: 'weapons',
      files: { ogg: 'audio/sfx/wpn_bazooka_launch.ogg', mp3: 'audio/sfx/wpn_bazooka_launch.mp3' },
      durationMs: 780,
      loop: false,
      loopStartMs: 0,
      loopEndMs: 0,
      gainDb: 0,
      pitchVariance: 0.08,
    });
    expect(Object.isFrozen(info)).toBe(true);
    expect(result.value.skipped).toEqual([]);
    expect(result.value.version).toBe(1);
  });

  it('applies defaults for optional fields and accepts null loop points', () => {
    const result = validateAudioManifest(
      manifest([asset({ loopStartMs: null, loopEndMs: null, gainDb: undefined, pitchVariance: undefined, group: undefined, loop: undefined })]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assets['wpn_bazooka_launch']).toMatchObject({ loopStartMs: 0, loopEndMs: 0, gainDb: 0, pitchVariance: 0, group: '', loop: false });
  });

  it('keeps loop points and the loop flag for looping assets', () => {
    const result = validateAudioManifest(manifest([asset({ id: 'music_theme_loop', bus: 'music', loop: true, loopStartMs: 0, loopEndMs: 64000, durationMs: 66038 })]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assets['music_theme_loop']).toMatchObject({ loop: true, loopEndMs: 64000, durationMs: 66038 });
  });

  it('names the four buses', () => {
    expect(BUS_NAMES).toEqual(['sfx', 'voice', 'music', 'ui']);
    for (const bus of BUS_NAMES) expect(isBusName(bus)).toBe(true);
    expect(isBusName('master')).toBe(false);
    expect(isBusName(1)).toBe(false);
  });
});

describe('audio manifest: rejected shapes', () => {
  it('rejects a bad top level shape', () => {
    expectError(null, 'not_an_object', '');
    expectError([], 'not_an_object', '');
    expectError('manifest', 'not_an_object', '');
    expectError({ version: 2, assets: [] }, 'version', 'version');
    expectError({ assets: [] }, 'version', 'version');
    expectError({ version: 1, assets: {} }, 'assets', 'assets');
    expectError({ version: 1 }, 'assets', 'assets');
  });

  it('rejects malformed entries with the path of the offender', () => {
    expectError(manifest([asset({ id: 'Bad-Id' })]), 'asset', 'assets[0].id');
    expectError(manifest([asset({ id: '../escape' })]), 'asset', 'assets[0].id');
    expectError(manifest([asset({ bus: 'ambient' })]), 'asset', 'assets[0].bus');
    expectError(manifest([asset({ files: { ogg: 'audio/a.ogg' } })]), 'asset', 'assets[0].files.mp3');
    expectError(manifest([asset({ files: { ogg: '/audio/a.ogg', mp3: 'audio/a.mp3' } })]), 'asset', 'assets[0].files.ogg');
    expectError(manifest([asset({ files: { ogg: '../a.ogg', mp3: 'audio/a.mp3' } })]), 'asset', 'assets[0].files.ogg');
    expectError(manifest([asset({ files: 'audio/a.ogg' })]), 'asset', 'assets[0].files');
    expectError(manifest([asset({ durationMs: -1 })]), 'asset', 'assets[0].durationMs');
    expectError(manifest([asset({ durationMs: undefined })]), 'asset', 'assets[0].durationMs');
    expectError(manifest([asset({ loopEndMs: 'end' })]), 'asset', 'assets[0].loopEndMs');
    expectError(manifest([asset({ pitchVariance: 2 })]), 'asset', 'assets[0].pitchVariance');
    expectError(manifest([asset({ gainDb: 'loud' })]), 'asset', 'assets[0].gainDb');
    expectError(manifest([asset(), 'nope']), 'asset', 'assets[1]');
  });

  it('rejects duplicate ids, including a duplicate that is skipped', () => {
    expectError(manifest([asset(), asset({ status: 'failed' })]), 'duplicate', 'assets[1].id');
    expectError(manifest([asset(), asset()]), 'duplicate', 'assets[1].id');
  });
});

describe('audio manifest: status', () => {
  it('skips assets whose status is not ok and reports them, needing only their id', () => {
    const result = validateAudioManifest(
      manifest([
        asset(),
        asset({ id: 'a_failed', status: 'failed', bus: 'nonsense', files: null }),
        asset({ id: 'a_placeholder', status: 'placeholder' }),
        asset({ id: 'a_missing', status: undefined }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.assets)).toEqual(['wpn_bazooka_launch']);
    expect(result.value.skipped).toEqual([
      { id: 'a_failed', status: 'failed' },
      { id: 'a_placeholder', status: 'placeholder' },
      { id: 'a_missing', status: 'missing' },
    ]);
  });

  it('validates the manifest the audio pipeline actually wrote', () => {
    const path = fileURLToPath(new URL('../../../public/audio/manifest.json', import.meta.url));
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { assets: readonly { status: string }[] };
    const result = validateAudioManifest(parsed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const okCount = parsed.assets.filter((entry) => entry.status === 'ok').length;
    expect(Object.keys(result.value.assets)).toHaveLength(okCount);
    expect(result.value.skipped).toHaveLength(parsed.assets.length - okCount);
    for (const info of Object.values(result.value.assets)) {
      expect(info.files.ogg.startsWith('audio/')).toBe(true);
      expect(info.durationMs).toBeGreaterThan(0);
    }
  });
});
