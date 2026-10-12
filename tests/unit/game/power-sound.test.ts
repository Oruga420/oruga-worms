import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@/weapons/registry.ts';
import { collectCrates, spawnCrate, stepCrate } from '@/sim/crate.ts';
import { addWorm } from '@/sim/world.ts';
import { flatWorld } from '../sim/fixture.ts';

const root = new URL('../../../public/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('audio/manifest.json', root), 'utf8')) as { assets: { id: string; status: string; files: { ogg: string; mp3: string } }[] };
const powers = ['time_stop', 'force_field', 'adamantium_claws', 'room'] as const;

describe('new power sounds are actually used', () => {
  it.each(powers)('%s fires its own existing and validated sound', (id) => {
    const sound = `wpn_${id}`;
    expect(WEAPONS[id].sfx.fire).toBe(sound);
    const asset = manifest.assets.find((entry) => entry.id === sound);
    expect(asset?.status).toBe('ok');
    if (!asset) throw new Error(`Missing ${sound}`);
    expect(existsSync(new URL(asset.files.ogg, root))).toBe(true);
    expect(existsSync(new URL(asset.files.mp3, root))).toBe(true);
  });

  it('plays the original immortality cue when the worm takes the pickup', () => {
    const world = flatWorld({ floorY: 100, waterY: 280 });
    addWorm(world, { id: 'a', teamId: 'red', x: 100, y: 99 });
    const crate = spawnCrate(world, 'immortality', 100);
    stepCrate(world, crate, 20);
    collectCrates(world);
    expect(world.events.some((event) => event.type === 'sound' && event.id === 'wpn_immortality')).toBe(true);
    const asset = manifest.assets.find((entry) => entry.id === 'wpn_immortality');
    expect(asset?.status).toBe('ok');
  });
});
