import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emptyManifest, loadManifest, saveManifest, statusOf, summarize, upsertAsset, type AudioAsset } from '../../../../tools/audio/manifest.ts';

const dir = mkdtempSync(join(tmpdir(), 'orugas-manifest-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function asset(id: string, status: AudioAsset['status'] = 'ok'): AudioAsset {
  return {
    id,
    bus: 'sfx',
    group: 'weapons',
    files: { ogg: `audio/sfx/${id}.ogg`, mp3: `audio/sfx/${id}.mp3` },
    durationMs: 800,
    loop: false,
    loopStartMs: 0,
    loopEndMs: 0,
    gainDb: 0,
    pitchVariance: 0.08,
    channels: 1,
    source: { provider: 'elevenlabs', endpoint: '/v1/sound-generation', model: 'eleven_text_to_sound_v2', attempts: 1, credits: 32, sha256: 'abc' },
    checks: { durationOk: true, silenceOk: true, clipOk: true, reasons: [], normalization: 'peak' },
    status,
  };
}

describe('audio manifest', () => {
  it('upserts by id, keeps ids sorted and summarizes statuses', () => {
    let m = emptyManifest('t0');
    m = upsertAsset(m, asset('b'), 't1');
    m = upsertAsset(m, asset('a', 'failed'), 't2');
    m = upsertAsset(m, asset('b', 'placeholder'), 't3');
    expect(m.assets.map((a) => a.id)).toEqual(['a', 'b']);
    expect(statusOf(m, 'b')).toBe('placeholder');
    expect(statusOf(m, 'zzz')).toBeNull();
    expect(summarize(m)).toEqual({ ok: 0, failed: 1, placeholder: 1 });
    expect(m.generatedAt).toBe('t3');
  });

  it('round trips through disk and starts empty when the file is missing', () => {
    const path = join(dir, 'manifest.json');
    const fresh = loadManifest(path, 'now');
    expect(fresh.ok && fresh.value.assets.length === 0).toBe(true);
    const m = upsertAsset(emptyManifest('t'), asset('x'), 't');
    saveManifest(path, m);
    const back = loadManifest(path, 'later');
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.assets[0]?.id).toBe('x');
  });
});
