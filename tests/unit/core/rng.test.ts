import { describe, expect, it } from 'vitest';
import { createRng, mixSeed, mulberry32Step, restoreRng, seedFromString } from '@/core/rng.ts';

/** Reference mulberry32 as published (Tommy Ettinger), used to pin the algorithm. */
function referenceMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rng: mulberry32', () => {
  it('matches the reference implementation for 2000 draws', () => {
    const rng = createRng(12345);
    const reference = referenceMulberry32(12345);
    for (let i = 0; i < 2000; i += 1) expect(rng.next()).toBe(reference());
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    const seqC = Array.from({ length: 10 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('exposes a pure step function', () => {
    const first = mulberry32Step(99);
    const again = mulberry32Step(99);
    expect(first).toEqual(again);
    expect(first.value).toBeGreaterThanOrEqual(0);
    expect(first.value).toBeLessThan(1);
    expect(first.state).not.toBe(99);
  });

  it('stays in [0, 1) over many draws', () => {
    const rng = createRng(2026);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rng: helpers', () => {
  it('nextFloat stays inside [min, max)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng.nextFloat(-3, 2);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(2);
    }
  });

  it('nextInt is inclusive on both ends and hits every value', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const v = rng.nextInt(-2, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(rng.nextInt(5, 5)).toBe(5);
    expect(rng.nextInt(4, 2)).toBeGreaterThanOrEqual(2);
  });

  it('pick returns elements of the array and undefined for empty', () => {
    const rng = createRng(4);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i += 1) expect(items).toContain(rng.pick(items));
    expect(rng.pick([])).toBeUndefined();
  });

  it('nextBool respects the probability at the extremes', () => {
    const rng = createRng(5);
    for (let i = 0; i < 50; i += 1) {
      expect(rng.nextBool(1)).toBe(true);
      expect(rng.nextBool(0)).toBe(false);
    }
  });

  it('freezes the generator object', () => {
    expect(Object.isFrozen(createRng(1))).toBe(true);
  });
});

describe('rng: fork and state', () => {
  it('forks with a salt are reproducible and independent from the parent', () => {
    const parent = createRng(100);
    const before = parent.state();
    const forkA = parent.fork(1);
    const forkB = parent.fork(1);
    const forkC = parent.fork(2);
    expect(parent.state()).toBe(before);
    const a = Array.from({ length: 5 }, () => forkA.next());
    expect(a).toEqual(Array.from({ length: 5 }, () => forkB.next()));
    expect(a).not.toEqual(Array.from({ length: 5 }, () => forkC.next()));
  });

  it('forks without a salt advance the parent once', () => {
    const parent = createRng(100);
    const twin = createRng(100);
    parent.fork();
    twin.next();
    expect(parent.state()).toBe(twin.state());
  });

  it('mixSeed spreads adjacent salts apart', () => {
    const seen = new Set<number>();
    for (let salt = 0; salt < 1000; salt += 1) seen.add(mixSeed(42, salt));
    expect(seen.size).toBe(1000);
  });

  it('seedFromString is stable and case sensitive', () => {
    expect(seedFromString('Orugas')).toBe(seedFromString('Orugas'));
    expect(seedFromString('Orugas')).not.toBe(seedFromString('orugas'));
    expect(seedFromString('')).toBe(0x811c9dc5);
  });

  it('restoreRng continues exactly from a saved state', () => {
    const original = createRng(77);
    for (let i = 0; i < 13; i += 1) original.next();
    const saved = original.state();
    const restored = restoreRng(77, saved);
    expect(restored.seed).toBe(77);
    for (let i = 0; i < 20; i += 1) expect(restored.next()).toBe(original.next());
    expect(restored.state()).toBe(original.state());
  });
});
