/**
 * Match seed selection (pure). Every match gets a fresh random seed so the island and the worm
 * spawns differ from one game to the next; a `?seed=N` in the URL pins it, which is how a test or
 * a bug report reproduces one exact map. The terrain generator and the spawner both derive from
 * this single number (setup.seed and mixSeed(setup.seed, salt)), so pinning it pins the world.
 */

import { MAX_SEED } from '../match/setup.ts';

export const SEED_PARAM = 'seed';

/** The integer in `?seed=N` when it is a valid match seed, else null (missing, malformed, out of range). */
export function parseSeedParam(search: string): number | null {
  const raw = new URLSearchParams(search).get(SEED_PARAM);
  if (raw === null || !/^\d{1,10}$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED ? value : null;
}

/** Fills 32 random bits; the browser passes crypto.getRandomValues, a test passes a stub. */
export type RandomFill = (target: Uint32Array) => Uint32Array;

/** A uniformly random seed in [0, MAX_SEED]. */
export function randomSeed(fill: RandomFill): number {
  const out = fill(new Uint32Array(1));
  const value = out[0] ?? 0;
  // MAX_SEED is exactly the Uint32 range, so no modulo bias is possible here.
  return Math.min(MAX_SEED, Math.max(0, value >>> 0));
}

/** URL pinned seed if present, otherwise a fresh random one. */
export function pickMatchSeed(search: string, fill: RandomFill): number {
  return parseSeedParam(search) ?? randomSeed(fill);
}

/**
 * The seed for a restart: a pinned URL seed stays pinned (the point of pinning is that R gives the
 * same map again), an unpinned game rolls a new one.
 */
export function pickRestartSeed(search: string, fill: RandomFill): number {
  return pickMatchSeed(search, fill);
}
