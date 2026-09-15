/**
 * Seeded value noise and fractional Brownian motion for the procedural generator
 * (architecture.md section B: "seed a mulberry32 PRNG so every level is reproducible").
 *
 * The PRNG is the one from core/rng.ts (mulberry32Step is the pure core, mixSeed the avalanche
 * used for lattice hashing), so the terrain and the simulation share a single algorithm and a
 * level seed can be derived from the match seed with the same mixing. Everything here is a pure
 * function of its arguments except the generator closure returned by mulberry32, whose single
 * state cell is the documented exception.
 *
 * Noise values are in [0, 1). Lattice coordinates are integers; value noise interpolates the
 * lattice with a cubic smoothstep so the surface profile has continuous slopes.
 */

import { mixSeed, mulberry32Step } from '../core/rng.ts';

const UINT32_RANGE = 4294967296;

/** Any finite number to a 32 bit seed: floor, then wrap. Non finite seeds become 0. */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.floor(seed) >>> 0;
}

/** A generator of uniform values in [0, 1), deterministic per seed. */
export function mulberry32(seed: number): () => number {
  // The only mutable cell in this file: the generator state, advanced on every draw.
  let state = normalizeSeed(seed);
  return () => {
    const step = mulberry32Step(state);
    state = step.state;
    return step.value;
  };
}

function latticeRaw(ix: number, iy: number, seed32: number): number {
  return mixSeed(mixSeed(seed32, ix | 0), iy | 0) / UINT32_RANGE;
}

/** Hash of an integer lattice point and a seed, in [0, 1). */
export function latticeValue(ix: number, iy: number, seed: number): number {
  return latticeRaw(ix, iy, normalizeSeed(seed));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise1D(x: number, seed32: number): number {
  const x0 = Math.floor(x);
  const t = smoothstep(x - x0);
  const a = latticeRaw(x0, 0, seed32);
  const b = latticeRaw(x0 + 1, 0, seed32);
  return a + (b - a) * t;
}

function noise2D(x: number, y: number, seed32: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const v00 = latticeRaw(x0, y0, seed32);
  const v10 = latticeRaw(x0 + 1, y0, seed32);
  const v01 = latticeRaw(x0, y0 + 1, seed32);
  const v11 = latticeRaw(x0 + 1, y0 + 1, seed32);
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/** Value noise along one axis; equals latticeValue(x, 0, seed) at integer x. */
export function valueNoise1D(x: number, seed: number): number {
  return noise1D(x, normalizeSeed(seed));
}

/** Value noise on the plane; equals latticeValue(x, y, seed) at integer coordinates. */
export function valueNoise2D(x: number, y: number, seed: number): number {
  return noise2D(x, y, normalizeSeed(seed));
}

export interface FbmOptions {
  /** Layers summed; 1 reduces to plain value noise. */
  readonly octaves?: number;
  /** Frequency multiplier per octave. */
  readonly lacunarity?: number;
  /** Amplitude multiplier per octave. */
  readonly gain?: number;
}

export const DEFAULT_FBM: Required<FbmOptions> = Object.freeze({ octaves: 4, lacunarity: 2, gain: 0.5 });

interface FbmParams {
  readonly octaves: number;
  readonly lacunarity: number;
  readonly gain: number;
}

function resolveFbm(options: FbmOptions): FbmParams {
  return {
    octaves: Math.max(1, Math.floor(options.octaves ?? DEFAULT_FBM.octaves)),
    lacunarity: options.lacunarity ?? DEFAULT_FBM.lacunarity,
    gain: options.gain ?? DEFAULT_FBM.gain,
  };
}

/** Octave 0 keeps the caller's seed so a single octave is plain value noise; later octaves decorrelate. */
function octaveSeed(seed32: number, octave: number): number {
  return octave === 0 ? seed32 : mixSeed(seed32, octave);
}

/** fBm over x, normalized to [0, 1) by the sum of the amplitudes. */
export function fbm1D(x: number, seed: number, options: FbmOptions = {}): number {
  const { octaves, lacunarity, gain } = resolveFbm(options);
  const seed32 = normalizeSeed(seed);
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * noise1D(x * frequency, octaveSeed(seed32, i));
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

/** fBm over the plane, normalized to [0, 1) by the sum of the amplitudes. */
export function fbm2D(x: number, y: number, seed: number, options: FbmOptions = {}): number {
  const { octaves, lacunarity, gain } = resolveFbm(options);
  const seed32 = normalizeSeed(seed);
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * noise2D(x * frequency, y * frequency, octaveSeed(seed32, i));
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}
