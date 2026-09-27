import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { createCamera } from '@/engine/camera.ts';
import {
  bloodBurst,
  createGore,
  dripFrom,
  drawGore,
  drawLens,
  ejectCasing,
  gibBurst,
  goreCount,
  goreEnabledFromSearch,
  MAX_RESTING_CHUNKS,
  splatterLens,
  updateGore,
  type GoreBit,
  type GoreSystem,
} from '@/game/gore.ts';
import { carve } from '@/terrain/terrain.ts';
import { paintDots } from '@/terrain/tiles.ts';
import { flatTerrain } from '../sim/fixture.ts';
import { createRecordingContext } from '../ui/recording-context.ts';
import type { FakeContext } from '../terrain/fakes.ts';

const TICK = 1 / 60;

function bits(gore: GoreSystem): GoreBit[] {
  const out: GoreBit[] = [];
  gore.bits.forEach((bit) => out.push(bit));
  return out;
}

function run(gore: GoreSystem, seconds: number, terrain: ReturnType<typeof flatTerrain> | null, seed = 5): void {
  const rng = createRng(seed);
  for (let t = 0; t < seconds; t += TICK) updateGore(gore, TICK, terrain, rng);
}

function stainRects(terrain: ReturnType<typeof flatTerrain>): number {
  let count = 0;
  for (const tile of terrain.tiles.tiles) {
    const ctx = tile.ctx as unknown as FakeContext;
    count += ctx.rects.filter((r) => r.op === 'source-atop').length;
  }
  return count;
}

describe('gore: blood', () => {
  it('sprays along the blow, more blood for more damage', () => {
    const small = createGore();
    const big = createGore();
    bloodBurst(small, { x: 100, y: 100, dx: 1, dy: 0, amount: 5, cause: 'hit' }, createRng(1));
    bloodBurst(big, { x: 100, y: 100, dx: 1, dy: 0, amount: 40, cause: 'hit' }, createRng(1));
    expect(goreCount(big)).toBeGreaterThan(goreCount(small));
    const drops = bits(big).filter((b) => b.kind === 'drop');
    const forward = drops.filter((b) => b.vx > 0).length;
    // A bullet's exit wound: most of the blood leaves along the shot.
    expect(forward / drops.length).toBeGreaterThan(0.65);
  });

  it('stains the land where the drops fall, through the tiles, and only the land', () => {
    const terrain = flatTerrain({ width: 400, height: 300, floorY: 200, waterY: 280 });
    const gore = createGore();
    bloodBurst(gore, { x: 200, y: 185, dx: 0, dy: -1, amount: 30, cause: 'melee' }, createRng(2));
    run(gore, 4, terrain);
    expect(bits(gore).filter((b) => b.kind === 'drop')).toHaveLength(0);
    expect(gore.stains).toBeGreaterThan(0);
    expect(stainRects(terrain)).toBe(gore.stains);
  });

  it('loses the drops that reach the water without staining anything', () => {
    const terrain = flatTerrain({ width: 400, height: 300, floorY: 290, waterY: 150 });
    const gore = createGore();
    bloodBurst(gore, { x: 200, y: 140, dx: 0, dy: 1, amount: 20, cause: 'hit' }, createRng(3));
    run(gore, 3, terrain);
    expect(goreCount(gore)).toBe(0);
    expect(gore.stains).toBe(0);
  });

  it('a fall splashes up and out, never into the ground', () => {
    const gore = createGore();
    bloodBurst(gore, { x: 50, y: 50, dx: 0, dy: -1, amount: 20, cause: 'fall' }, createRng(4));
    for (const bit of bits(gore)) if (bit.kind === 'drop') expect(bit.vy).toBeLessThan(0);
  });

  it('wounded worms drip', () => {
    const gore = createGore();
    dripFrom(gore, 10, 10, createRng(1));
    expect(bits(gore).filter((b) => b.kind === 'drop')).toHaveLength(1);
  });
});

describe('gore: gibs', () => {
  it('bursts into meat, guts, two eyes, bones and the bandana, with blood everywhere', () => {
    const gore = createGore();
    const chunks = gibBurst(gore, { x: 200, y: 150, vx: 300, vy: -200, colorIndex: 1 }, createRng(9));
    expect(chunks).toBeGreaterThanOrEqual(15);
    const shapes = new Set(bits(gore).filter((b) => b.kind === 'chunk').map((b) => b.shape));
    expect([...shapes].sort()).toEqual(['bandana', 'bone', 'eye', 'flesh', 'guts']);
    expect(bits(gore).filter((b) => b.kind === 'drop').length).toBeGreaterThan(40);
    // The pieces carry the body's momentum.
    const chunkVx = bits(gore).filter((b) => b.kind === 'chunk').reduce((sum, b) => sum + b.vx, 0);
    expect(chunkVx).toBeGreaterThan(0);
  });

  it('the pieces land, come to rest on the ground and bleed on it', () => {
    const terrain = flatTerrain({ width: 600, height: 300, floorY: 200, waterY: 290 });
    const gore = createGore();
    gibBurst(gore, { x: 300, y: 180, vx: 0, vy: 0, colorIndex: 0 }, createRng(11));
    run(gore, 6, terrain);
    const chunks = bits(gore).filter((b) => b.kind === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.resting).toBe(true);
      expect(chunk.y).toBeLessThan(200);
      expect(chunk.y).toBeGreaterThan(190);
    }
    expect(gore.stains).toBeGreaterThan(0);
  });

  it('a resting piece falls again when the ground under it is blown away', () => {
    const terrain = flatTerrain({ width: 600, height: 400, floorY: 200, waterY: 390 });
    const gore = createGore();
    gibBurst(gore, { x: 300, y: 185, vx: 0, vy: 0, colorIndex: 2 }, createRng(12));
    run(gore, 6, terrain);
    const resting = bits(gore).filter((b) => b.kind === 'chunk' && b.resting);
    expect(resting.length).toBeGreaterThan(0);
    for (const chunk of resting) carve(terrain, Math.round(chunk.x), Math.round(chunk.y) + 8, 12);
    updateGore(gore, TICK, terrain, createRng(1));
    expect(bits(gore).filter((b) => b.kind === 'chunk' && b.resting).length).toBeLessThan(resting.length);
  });

  it('over the cap only the extra pieces fade: the rest stay on the ground', () => {
    const terrain = flatTerrain({ width: 1200, height: 300, floorY: 200, waterY: 290 });
    const gore = createGore();
    const rng = createRng(21);
    let chunks = 0;
    for (let i = 0; i < 6; i += 1) chunks += gibBurst(gore, { x: 150 + i * 180, y: 185, vx: 0, vy: 0, colorIndex: i % 4 }, rng);
    expect(chunks).toBeGreaterThan(MAX_RESTING_CHUNKS);
    run(gore, 8, terrain);
    expect(bits(gore).filter((b) => b.kind === 'chunk' && b.resting)).toHaveLength(MAX_RESTING_CHUNKS);
  });

  it('casings bounce off without a drop of blood', () => {
    const terrain = flatTerrain({ width: 400, height: 300, floorY: 200, waterY: 290 });
    const gore = createGore();
    ejectCasing(gore, 200, 180, 1, createRng(3));
    run(gore, 3, terrain);
    expect(bits(gore).every((b) => b.shape === 'casing')).toBe(true);
    expect(gore.stains).toBe(0);
  });
});

describe('gore: switches and screen', () => {
  it('is on unless the URL turns it off', () => {
    expect(goreEnabledFromSearch('')).toBe(true);
    expect(goreEnabledFromSearch('?seed=4')).toBe(true);
    expect(goreEnabledFromSearch('?gore=0')).toBe(false);
    expect(goreEnabledFromSearch('?seed=4&gore=off')).toBe(false);
    expect(goreEnabledFromSearch('?gore=FALSE&seed=1')).toBe(false);
    expect(goreEnabledFromSearch('?gore=01')).toBe(true);
  });

  it('spawns nothing when turned off', () => {
    const gore = createGore();
    gore.enabled = false;
    bloodBurst(gore, { x: 1, y: 1, dx: 1, dy: 0, amount: 50, cause: 'blast' }, createRng(1));
    gibBurst(gore, { x: 1, y: 1, vx: 0, vy: 0, colorIndex: 0 }, createRng(1));
    splatterLens(gore, 4, 1, createRng(1));
    expect(goreCount(gore)).toBe(0);
    expect(gore.lens).toHaveLength(0);
  });

  it('lens blood runs down and dries up', () => {
    const gore = createGore();
    splatterLens(gore, 3, 1, createRng(8));
    expect(gore.lens).toHaveLength(3);
    run(gore, 0.5, null);
    expect(gore.lens.every((s) => s.drip > 0)).toBe(true);
    run(gore, 4, null);
    expect(gore.lens).toHaveLength(0);
  });

  it('draws the bits and the lens without throwing', () => {
    const gore = createGore();
    gibBurst(gore, { x: 200, y: 150, vx: 0, vy: 0, colorIndex: 3 }, createRng(9));
    splatterLens(gore, 2, 0.5, createRng(2));
    const ctx = createRecordingContext();
    drawGore(ctx, gore, createCamera({ x: 200, y: 150 }), { w: 800, h: 600 });
    drawLens(ctx, gore, { w: 800, h: 600 });
    expect(ctx.calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(20);
    expect(ctx.calls.some((c) => c.name === 'arc')).toBe(true);
  });
});

describe('tiles: paintDots', () => {
  it('paints over the land only and marks the tile dirty', () => {
    const terrain = flatTerrain({ width: 400, height: 300, floorY: 200 });
    terrain.tiles.dirty.fill(0);
    const rects = paintDots(terrain.tiles, [{ x: 100, y: 201, r: 1 }, { x: -50, y: 10, r: 1 }, { x: 10, y: 10, r: 0 }], 'red');
    expect(rects).toBe(1);
    const ctx = terrain.tiles.tiles[0]?.ctx as unknown as FakeContext;
    const painted = ctx.rects.at(-1);
    expect(painted).toMatchObject({ op: 'source-atop', style: 'red', x: 297, y: 600, w: 6, h: 6 });
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(terrain.tiles.dirty[0]).toBe(1);
  });
});
