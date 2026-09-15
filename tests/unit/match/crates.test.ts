import { describe, expect, it } from 'vitest';
import {
  UTILITY_CRATE_ITEMS,
  canDropCrate,
  crateOdds,
  healthCrateAmount,
  rollCrate,
  rollScheduledCrate,
  rollUtility,
  rollWeighted,
} from '@/match/crates.ts';
import { DEFAULT_MATCH_CONFIG } from '@/match/deps.ts';
import type { Rng } from '@/core/rng.ts';

const CONFIG = DEFAULT_MATCH_CONFIG;

/** A stub Rng: only next() is exercised by the crate code. */
function fixedRng(value: number): Rng {
  return { next: () => value } as unknown as Rng;
}

describe('crateOdds and caps', () => {
  it('turns the percentages into fractions with the remainder as none', () => {
    const odds = crateOdds(CONFIG);
    expect(odds.weapon).toBeCloseTo(CONFIG.crates.weaponPct / 100, 5);
    expect(odds.health).toBeCloseTo(CONFIG.crates.healthPct / 100, 5);
    expect(odds.utility).toBeCloseTo(CONFIG.crates.utilityPct / 100, 5);
    expect(odds.weapon + odds.health + odds.utility + odds.none).toBeCloseTo(1, 5);
  });

  it('can drop below the cap, not at it, and a pending drop counts', () => {
    expect(canDropCrate(0, CONFIG)).toBe(true);
    expect(canDropCrate(CONFIG.crates.maxOnMap - 1, CONFIG)).toBe(true);
    expect(canDropCrate(CONFIG.crates.maxOnMap, CONFIG)).toBe(false);
    expect(canDropCrate(CONFIG.crates.maxOnMap - 1, CONFIG, true)).toBe(false);
  });

  it('the health crate amount comes from the config', () => {
    expect(healthCrateAmount(CONFIG)).toBe(CONFIG.crates.healthAmount);
  });
});

describe('rollCrate', () => {
  const { weaponPct, healthPct } = CONFIG.crates;
  const weaponRoll = (weaponPct / 2) / 100;
  const healthRoll = (weaponPct + healthPct / 2) / 100;
  const utilityRoll = (weaponPct + healthPct + 0.5) / 100;

  it('returns each kind in its band and none above the bands', () => {
    expect(rollCrate(fixedRng(weaponRoll), CONFIG, 0)).toBe('weapon');
    expect(rollCrate(fixedRng(healthRoll), CONFIG, 0)).toBe('health');
    expect(rollCrate(fixedRng(utilityRoll), CONFIG, 0)).toBe('utility');
    expect(rollCrate(fixedRng(0.9), CONFIG, 0)).toBeNull();
  });

  it('suppresses the health crate in sudden death', () => {
    expect(rollCrate(fixedRng(healthRoll), CONFIG, 0, { suddenDeath: true })).toBeNull();
    // A weapon still drops in sudden death.
    expect(rollCrate(fixedRng(weaponRoll), CONFIG, 0, { suddenDeath: true })).toBe('weapon');
  });

  it('drops nothing once the map is full', () => {
    expect(rollCrate(fixedRng(weaponRoll), CONFIG, CONFIG.crates.maxOnMap)).toBeNull();
    expect(rollCrate(fixedRng(weaponRoll), CONFIG, CONFIG.crates.maxOnMap - 1, { pendingDrop: true })).toBeNull();
  });
});

describe('weighted picks', () => {
  it('returns undefined for an empty table or all non positive weights', () => {
    expect(rollWeighted(fixedRng(0.5), [])).toBeUndefined();
    expect(rollWeighted(fixedRng(0.5), [{ weight: 0 }, { weight: -3 }])).toBeUndefined();
  });

  it('picks the item whose cumulative weight contains the cursor', () => {
    const items = [{ id: 'a', weight: 10 }, { id: 'b', weight: 0 }, { id: 'c', weight: 30 }];
    expect(rollWeighted(fixedRng(0.1), items)?.id).toBe('a'); // cursor 4 of 40
    expect(rollWeighted(fixedRng(0.9), items)?.id).toBe('c'); // cursor 36 of 40
  });

  it('rollUtility returns a table id and falls back on an empty table', () => {
    expect(UTILITY_CRATE_ITEMS.map((i) => i.id)).toContain(rollUtility(fixedRng(0.0)));
    expect(rollUtility(fixedRng(0.5), [])).toBe('fast_walk');
  });
});


it('scheduled drops always pick a kind and never health in sudden death', () => {
  expect(rollScheduledCrate(fixedRng(0), CONFIG)).toBe('weapon');
  expect(rollScheduledCrate(fixedRng(0.7), CONFIG)).toBe('utility');
  expect(rollScheduledCrate(fixedRng(0.99), CONFIG)).toBe('health');
  expect(rollScheduledCrate(fixedRng(0.99), CONFIG, true)).toBe('utility');
});
