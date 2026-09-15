/**
 * Seeded PRNG (architecture.md section C: every random draw in the sim goes through a seeded
 * generator carried on the world, never Math.random, so tests reproduce and the heuristic AI
 * agrees with the shot it later fires). Algorithm: mulberry32, 32 bit state, period 2^32.
 *
 * mulberry32Step is the pure core. createRng wraps one mutable state cell because a generator
 * that returns a new object per draw would allocate in the physics hot path; the mutation is
 * confined to that closure and the state is readable through state() for snapshots.
 */

export interface RngStep {
  /** Uniform in [0, 1). */
  readonly value: number;
  /** Next 32 bit state. */
  readonly state: number;
}

const UINT32_RANGE = 4294967296;

/** One mulberry32 step from a 32 bit state; pure. */
export function mulberry32Step(state: number): RngStep {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  return { value, state: next };
}

/** FNV-1a over a string, for level names and team names used as seeds. */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mixes a parent seed with a salt so sub streams do not correlate with the parent. */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface Rng {
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform unsigned 32 bit integer. */
  nextUint32(): number;
  /** Uniform in [min, max). */
  nextFloat(min: number, max: number): number;
  /** Uniform integer in [min, max], both ends inclusive. */
  nextInt(min: number, max: number): number;
  nextBool(probability?: number): boolean;
  /** One element, or undefined for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Independent sub stream. With no salt the seed is drawn from this stream. */
  fork(salt?: number): Rng;
  /** Current 32 bit state, for snapshots and replays. */
  state(): number;
}

function fromState(seed: number, initialState: number): Rng {
  // The only mutable cell: advanced on every draw (see the file comment).
  let state = initialState >>> 0;

  const next = (): number => {
    const step = mulberry32Step(state);
    state = step.state;
    return step.value;
  };

  return Object.freeze({
    seed: seed >>> 0,
    next,
    nextUint32: () => Math.floor(next() * UINT32_RANGE),
    nextFloat: (min: number, max: number) => min + next() * (max - min),
    nextInt: (min: number, max: number) => {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    nextBool: (probability = 0.5) => next() < probability,
    pick: <T>(items: readonly T[]) => (items.length === 0 ? undefined : items[Math.floor(next() * items.length)]),
    fork: (salt?: number) => createRng(salt === undefined ? Math.floor(next() * UINT32_RANGE) : mixSeed(seed, salt)),
    state: () => state,
  });
}

export function createRng(seed: number): Rng {
  return fromState(seed, seed);
}

/** Restores a generator that continues exactly from a saved state, for replays. */
export function restoreRng(seed: number, state: number): Rng {
  return fromState(seed, state);
}
