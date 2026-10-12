import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAtlas } from '@/engine/atlas.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';

const base = new URL('../../../public/sprites/fx/', import.meta.url);
const png = readFileSync(new URL('painted-v2.png', base));
const raw: unknown = JSON.parse(readFileSync(new URL('painted-v2.json', base), 'utf8'));
const result = loadAtlas(raw, { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } as ImageSource);
if (!result.ok) throw new Error(result.error.message);
const atlas = result.value;
const shots = ['slash-spark', 'hex-shield', 'frost-burst', 'room-bloom', 'immortality-wings', 'blast-burst'] as const;

describe('production painted sprite atlas', () => {
  it('ships all six painted animations plus the intact frozen-status alias', () => {
    expect(Object.keys(atlas.manifest.animations).sort()).toEqual([...shots, 'frozen-plate'].sort());
    for (const id of shots) {
      expect(atlas.animation(id)).toMatchObject({ fps: 20, loop: false });
      expect(atlas.frameIds(id)).toHaveLength(16);
    }
    expect(atlas.frameIds('frozen-plate')).toEqual(atlas.frameIds('frost-burst').slice(8, 12));
  });

  it('uses a bounded transparent RGBA atlas with frames inside the actual PNG', () => {
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png[25]).toBe(6);
    expect(png.length).toBeLessThan(4 * 1024 * 1024);
    expect(atlas.manifest.meta.size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
    for (const frame of Object.values(atlas.manifest.frames)) {
      expect(frame.rotated).toBe(false);
      expect(frame.trimmed).toBe(false);
      expect(frame.sourceSize).toEqual({ w: 192, h: 192 });
      expect(frame.frame.x + frame.frame.w).toBeLessThanOrEqual(atlas.manifest.meta.size.w);
      expect(frame.frame.y + frame.frame.h).toBeLessThanOrEqual(atlas.manifest.meta.size.h);
    }
  });

  it.each(['room-bloom', 'blast-burst'])('%s has the authored rim needed for truthful radius scaling', (id) => {
    expect(atlas.attachOffset(id, 'rim')).toEqual({ x: 59.0625, y: 0 });
  });
});
