import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAtlasManifest } from '@/engine/atlas-schema.ts';
import { WEAPONS } from '@/weapons/registry.ts';

const raw: unknown = JSON.parse(readFileSync(new URL('../../../public/sprites/weapons/atlas.json', import.meta.url), 'utf8'));
const checked = validateAtlasManifest(raw);
if (!checked.ok) throw new Error(checked.error.message);
const atlas = checked.value;

describe('painted power inventory icons', () => {
  it.each(['time_stop', 'force_field', 'adamantium_claws', 'room'] as const)('%s has a real image frame instead of a letter placeholder', (id) => {
    const frame = atlas.frames[WEAPONS[id].icon];
    expect(frame).toBeDefined();
    expect(frame?.frame.w).toBe(64);
    expect(frame?.frame.h).toBe(64);
  });

  it('keeps the PNG dimensions consistent with the indexed image', () => {
    const png = readFileSync(new URL('../../../public/sprites/weapons/sheet.png', import.meta.url));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(atlas.meta.size.w);
    expect(png.readUInt32BE(20)).toBe(atlas.meta.size.h);
  });
});
