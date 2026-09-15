import { describe, expect, it } from 'vitest';
import { parseSeedParam, pickMatchSeed, pickRestartSeed, randomSeed, type RandomFill } from '@/game/match-seed.ts';
import { MAX_SEED } from '@/match/setup.ts';

/** Deterministic stand in for crypto.getRandomValues. */
function fillWith(value: number): RandomFill {
  return (target) => {
    target[0] = value;
    return target;
  };
}

describe('parseSeedParam', () => {
  it('reads a valid integer seed from the query string', () => {
    expect(parseSeedParam('?seed=0')).toBe(0);
    expect(parseSeedParam('?seed=123')).toBe(123);
    expect(parseSeedParam(`?seed=${MAX_SEED}`)).toBe(MAX_SEED);
    expect(parseSeedParam('?overlay&seed=42&x=1')).toBe(42);
  });

  it('returns null when missing, malformed or out of range', () => {
    expect(parseSeedParam('')).toBeNull();
    expect(parseSeedParam('?overlay')).toBeNull();
    expect(parseSeedParam('?seed=')).toBeNull();
    expect(parseSeedParam('?seed=abc')).toBeNull();
    expect(parseSeedParam('?seed=-1')).toBeNull();
    expect(parseSeedParam('?seed=1.5')).toBeNull();
    expect(parseSeedParam(`?seed=${MAX_SEED + 1}`)).toBeNull();
    expect(parseSeedParam('?seed=99999999999')).toBeNull();
  });
});

describe('randomSeed', () => {
  it('returns the 32 random bits as an integer in the valid seed range', () => {
    expect(randomSeed(fillWith(0))).toBe(0);
    expect(randomSeed(fillWith(7))).toBe(7);
    expect(randomSeed(fillWith(0xffffffff))).toBe(MAX_SEED);
  });

  it('draws different seeds from different random bits, so two games differ', () => {
    expect(randomSeed(fillWith(1))).not.toBe(randomSeed(fillWith(2)));
  });
});

describe('pickMatchSeed / pickRestartSeed', () => {
  it('lets the URL pin the seed and otherwise rolls a random one', () => {
    expect(pickMatchSeed('?seed=555', fillWith(9))).toBe(555);
    expect(pickMatchSeed('', fillWith(9))).toBe(9);
    expect(pickMatchSeed('?seed=bad', fillWith(9))).toBe(9);
  });

  it('keeps a pinned seed across a restart and re-rolls an unpinned one', () => {
    expect(pickRestartSeed('?seed=555', fillWith(9))).toBe(555);
    expect(pickRestartSeed('', fillWith(11))).toBe(11);
  });
});
