import { describe, expect, it } from 'vitest';
import { fbm1D, fbm2D, latticeValue, mulberry32, valueNoise1D, valueNoise2D } from '@/terrain/noise.ts';

describe('noise: mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 1000; i += 1) {
      const va = a();
      expect(va).toBe(b());
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
    }
  });

  it('gives different streams for different seeds and a roughly uniform mean', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const firstA = Array.from({ length: 8 }, () => a());
    const firstB = Array.from({ length: 8 }, () => b());
    expect(firstA).not.toEqual(firstB);

    const rng = mulberry32(99);
    let sum = 0;
    for (let i = 0; i < 20_000; i += 1) sum += rng();
    expect(Math.abs(sum / 20_000 - 0.5)).toBeLessThan(0.02);
  });

  it('accepts any finite seed, including negatives, fractions and huge numbers', () => {
    for (const seed of [-5, 0, 0.5, 2 ** 40, -(2 ** 33)]) {
      const rng = mulberry32(seed);
      const value = rng();
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('noise: lattice hash and value noise', () => {
  it('latticeValue is deterministic, seeded and in [0, 1)', () => {
    expect(latticeValue(3, 4, 7)).toBe(latticeValue(3, 4, 7));
    expect(latticeValue(3, 4, 7)).not.toBe(latticeValue(4, 3, 7));
    expect(latticeValue(3, 4, 7)).not.toBe(latticeValue(3, 4, 8));
    for (let i = -50; i < 50; i += 1) {
      const v = latticeValue(i, i * 3, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('value noise equals the lattice value at integer coordinates and interpolates between them', () => {
    expect(valueNoise2D(3, 4, 7)).toBeCloseTo(latticeValue(3, 4, 7), 12);
    expect(valueNoise2D(-2, 9, 7)).toBeCloseTo(latticeValue(-2, 9, 7), 12);
    expect(valueNoise1D(5, 7)).toBeCloseTo(latticeValue(5, 0, 7), 12);
    const lo = latticeValue(3, 4, 7);
    const hi = latticeValue(4, 4, 7);
    const mid = valueNoise2D(3.5, 4, 7);
    expect(mid).toBeGreaterThanOrEqual(Math.min(lo, hi) - 1e-12);
    expect(mid).toBeLessThanOrEqual(Math.max(lo, hi) + 1e-12);
  });

  it('is continuous: a tiny step changes the value by a tiny amount', () => {
    for (let i = 0; i < 200; i += 1) {
      const x = i * 0.137;
      const y = i * 0.071;
      expect(Math.abs(valueNoise2D(x + 0.001, y, 3) - valueNoise2D(x, y, 3))).toBeLessThan(0.01);
      expect(Math.abs(valueNoise1D(x + 0.001, 3) - valueNoise1D(x, 3))).toBeLessThan(0.01);
    }
  });
});

describe('noise: fractional Brownian motion', () => {
  it('is deterministic, seeded and normalized to [0, 1)', () => {
    for (let i = 0; i < 300; i += 1) {
      const x = i * 0.37 - 20;
      const y = i * 0.11;
      const v = fbm2D(x, y, 5);
      expect(v).toBe(fbm2D(x, y, 5));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const w = fbm1D(x, 5);
      expect(w).toBe(fbm1D(x, 5));
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(1);
    }
    expect(fbm2D(1.5, 2.5, 5)).not.toBe(fbm2D(1.5, 2.5, 6));
    expect(fbm1D(1.5, 5)).not.toBe(fbm1D(1.5, 6));
  });

  it('defaults to 4 octaves and reduces to plain value noise with a single octave', () => {
    expect(fbm2D(2.25, 3.75, 9, { octaves: 1 })).toBeCloseTo(valueNoise2D(2.25, 3.75, 9), 12);
    expect(fbm1D(2.25, 9, { octaves: 1 })).toBeCloseTo(valueNoise1D(2.25, 9), 12);
    expect(fbm2D(2.25, 3.75, 9)).toBe(fbm2D(2.25, 3.75, 9, { octaves: 4, lacunarity: 2, gain: 0.5 }));
    expect(fbm2D(2.25, 3.75, 9)).not.toBe(fbm2D(2.25, 3.75, 9, { octaves: 1 }));
  });

  it('has more variation than a single octave over short distances', () => {
    let single = 0;
    let multi = 0;
    for (let i = 0; i < 500; i += 1) {
      const x = i * 0.05;
      single += Math.abs(fbm1D(x + 0.05, 21, { octaves: 1 }) - fbm1D(x, 21, { octaves: 1 }));
      multi += Math.abs(fbm1D(x + 0.05, 21) - fbm1D(x, 21));
    }
    expect(multi).toBeGreaterThan(single);
  });
});
