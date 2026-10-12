import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAtlasManifest } from '../../src/engine/atlas-schema.ts';
import { animDurationMs, currentFrameId, startAnim } from '../../src/engine/animator.ts';

const output = new URL('../../public/sprites/fx/', import.meta.url);
const ids = ['room-bloom', 'hex-shield', 'time-stop-clock', 'slash-spark', 'immortality-wings'];

describe('real ManimGX FX export', () => {
  it('loads all five transparent sprite clips through the production atlas contract', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('manimgx-fx.json', output), 'utf8'));
    const parsed = validateAtlasManifest(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const manifest = parsed.value;
    expect(Object.keys(manifest.animations)).toEqual(ids);
    expect(manifest.meta.frameSize).toEqual({ w: 160, h: 160 });
    expect(manifest.meta.image).toBe('manimgx-fx.png');
    for (const id of ids) {
      const clip = manifest.animations[id]!;
      expect(clip.fps).toBe(24);
      expect(clip.loop).toBe(false);
      expect(clip.frames.length).toBeGreaterThanOrEqual(12);
      expect(animDurationMs(clip)).toBeLessThanOrEqual(1500);
      expect(currentFrameId(startAnim(id), clip)).toBe(clip.frames[0]);
    }
    const png = readFileSync(fileURLToPath(new URL(manifest.meta.image, output)));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(manifest.meta.size.w);
    expect(png.readUInt32BE(20)).toBe(manifest.meta.size.h);
    expect(png[25]).toBe(6); // PNG color type 6 is RGBA, not an opaque RGB sheet.
  });
});
