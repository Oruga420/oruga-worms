import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchConfig, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { findWorm } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState, type MatchSetup, type TeamSetup } from '@/match/setup.ts';
import type { MatchState, TeamController } from '@/match/state.ts';

const CONFIG: MatchConfig = GAME_CONFIG;

function team(name: string, colorIndex: 0 | 1, controller: TeamController, worms: readonly string[]): TeamSetup {
  return { name, colorIndex, controller, wormNames: worms };
}

function setup(): MatchSetup {
  return {
    seed: 42,
    teams: [team('Reds', 0, 'cpu', ['R1']), team('Blues', 1, 'cpu', ['B1'])],
    worldSize: { w: 1920, h: 696 },
    waterY: 640,
    startingTeamIndex: 0,
  };
}

function start(): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(42, CONFIG);
  const result = buildInitialState(setup(), CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.value, deps };
}

/** Patches the one worm with this id anywhere in the roster. */
function withWorm(state: MatchState, wormId: string, patch: Partial<MatchState['teams'][number]['worms'][number]>): MatchState {
  return { ...state, teams: state.teams.map((t) => ({ ...t, worms: t.worms.map((w) => (w.id === wormId ? { ...w, ...patch } : w)) })) };
}

function hpOf(state: MatchState, wormId: string): number {
  return findWorm(state, wormId)?.worm.hp ?? -1;
}

const damage = (wormId: string, amount: number, extra: Partial<MatchEvent> = {}): MatchEvent =>
  ({ type: 'DamageApplied', wormId, amount, sourceTeamId: 'team-2', sourceWormId: 'team-2-worm-1', ...extra }) as MatchEvent;

describe('new status event boundaries', () => {
  it.each([Number.NaN, Infinity, -1, 1.5])('rejects invalid shield duration %s', (ownTurns) => {
    const { state, deps } = start();
    expect(reduce(state, { type: 'ShieldApplied', casterId: 'team-1-worm-1', durability: 100, ownTurns }, deps)).toBe(state);
  });

  it.each([Number.NaN, Infinity, 0, -1])('rejects invalid shield strength %s', (durability) => {
    const { state, deps } = start();
    expect(reduce(state, { type: 'ShieldApplied', casterId: 'team-1-worm-1', durability, ownTurns: 1 }, deps)).toBe(state);
  });

  it('cannot freeze the roster from a missing or dead caster', () => {
    const { state, deps } = start();
    expect(reduce(state, { type: 'FreezeApplied', casterId: 'absent', turns: 1 }, deps)).toBe(state);
    const dead = withWorm(state, 'team-1-worm-1', { alive: false, hp: 0 });
    expect(reduce(dead, { type: 'FreezeApplied', casterId: 'team-1-worm-1', turns: 1 }, deps)).toBe(dead);
  });

  it.each([Number.NaN, 0, -1, 1.5])('rejects invalid freeze duration %s', (turns) => {
    const { state, deps } = start();
    expect(reduce(state, { type: 'FreezeApplied', casterId: 'team-1-worm-1', turns }, deps)).toBe(state);
  });

  it('rejects an invalid ROOM aim rather than casting a one-percent fallback', () => {
    const { state, deps } = start();
    expect(reduce(state, { type: 'RoomCast', casterId: 'team-1-worm-1', angleDeg: Number.NaN }, deps)).toBe(state);
  });
});

describe('force_field: absorbing and blocking', () => {
  it('absorbs ordinary damage up to its durability, leaves the worm alive, and never kills on its own', () => {
    const { state, deps } = start();
    const shielded = withWorm(state, 'team-1-worm-1', { hp: 100, shieldDurability: 40 });
    const hit = reduce(shielded, damage('team-1-worm-1', 25), deps);
    expect(hpOf(hit, 'team-1-worm-1')).toBe(100);
    const ref = findWorm(hit, 'team-1-worm-1');
    expect(ref?.worm.shieldDurability).toBe(15);
    expect(ref?.worm.alive).toBe(true);
  });

  it('breaks outright once the damage exceeds what is left, and the remainder still goes through', () => {
    const { state, deps } = start();
    const shielded = withWorm(state, 'team-1-worm-1', { hp: 100, shieldDurability: 10 });
    const hit = reduce(shielded, damage('team-1-worm-1', 30), deps);
    expect(hpOf(hit, 'team-1-worm-1')).toBe(80);
    expect(findWorm(hit, 'team-1-worm-1')?.worm.shieldDurability).toBe(0);
  });

  it('blocks an execute outright (the sim one hit kill amount), breaking the shield, the body stays alive', () => {
    const { state, deps } = start();
    const shielded = withWorm(state, 'team-1-worm-1', { hp: 100, shieldDurability: 100 });
    const hit = reduce(shielded, damage('team-1-worm-1', 1_000_000), deps);
    expect(hpOf(hit, 'team-1-worm-1')).toBe(100);
    expect(findWorm(hit, 'team-1-worm-1')?.worm.alive).toBe(true);
    expect(findWorm(hit, 'team-1-worm-1')?.worm.shieldDurability).toBe(0);
    expect(hit.pendingDeaths).toHaveLength(0);
  });

  it('a toll never looks at the shield: the super still costs the worm in full', () => {
    const { state, deps } = start();
    const shielded = withWorm(state, 'team-1-worm-1', { hp: 100, shieldDurability: 100 });
    const paid = reduce(shielded, { type: 'DamageApplied', wormId: 'team-1-worm-1', amount: 50, sourceTeamId: null, sourceWormId: null, toll: true }, deps);
    expect(hpOf(paid, 'team-1-worm-1')).toBe(50);
    expect(findWorm(paid, 'team-1-worm-1')?.worm.shieldDurability).toBe(100);
  });
});

describe('immortality: three lethal attacks at 1 hp', () => {
  function immortal(state: MatchState, hp = 10): MatchState {
    return withWorm(state, 'team-1-worm-1', { hp, immortalityCharges: 3 });
  }

  it('clamps a lethal hit to 1 hp and spends exactly one charge', () => {
    const { state, deps } = start();
    const hit = reduce(immortal(state), damage('team-1-worm-1', 1_000_000), deps);
    expect(hpOf(hit, 'team-1-worm-1')).toBe(1);
    const ref = findWorm(hit, 'team-1-worm-1');
    expect(ref?.worm.alive).toBe(true);
    expect(ref?.worm.immortalityCharges).toBe(2);
    expect(hit.pendingDeaths).toHaveLength(0);
  });

  it('a multi pellet shot only ever costs one charge: every further hit of the same attack is free', () => {
    const { state, deps } = start();
    const active = reduce(immortal(state), { type: 'BannerDone' }, deps);
    // One FireStarted opens the whole burst: every pellet inside it shares that one attack id.
    const opened = reduce(active, { type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 0 }, deps);
    const pelletA = reduce(opened, damage('team-1-worm-1', 40), deps);
    expect(hpOf(pelletA, 'team-1-worm-1')).toBe(1);
    expect(findWorm(pelletA, 'team-1-worm-1')?.worm.immortalityCharges).toBe(2);
    const pelletB = reduce(pelletA, damage('team-1-worm-1', 40), deps);
    expect(hpOf(pelletB, 'team-1-worm-1')).toBe(1);
    // Still 2: the second pellet of the same shot did not spend a second charge.
    expect(findWorm(pelletB, 'team-1-worm-1')?.worm.immortalityCharges).toBe(2);
  });

  it('a later, different attack spends its own charge even from 1 hp already', () => {
    const { state, deps } = start();
    const active = reduce(immortal(state), { type: 'BannerDone' }, deps);
    const opened = reduce(active, { type: 'FireStarted', weaponId: 'bazooka', shotsRemaining: 0 }, deps);
    const first = reduce(opened, damage('team-1-worm-1', 1_000_000), deps);
    expect(findWorm(first, 'team-1-worm-1')?.worm.immortalityCharges).toBe(2);
    // A fresh FireStarted bumps attackSeq regardless of phase; forced back to Active only to focus
    // this test on that identity, not on the full Retreat/Resolving/TurnEnd cycle tested elsewhere.
    const reopened = reduce({ ...first, phase: 'Active' }, { type: 'FireStarted', weaponId: 'bazooka', shotsRemaining: 0 }, deps);
    const second = reduce(reopened, damage('team-1-worm-1', 5), deps);
    expect(hpOf(second, 'team-1-worm-1')).toBe(1);
    expect(findWorm(second, 'team-1-worm-1')?.worm.immortalityCharges).toBe(1);
  });

  it('does not give unlimited protection to separate environmental hits with no open shot', () => {
    const { state, deps } = start();
    let current = immortal(state, 1);
    for (let hit = 0; hit < 3; hit += 1) {
      current = reduce(current, damage('team-1-worm-1', 100, { sourceTeamId: null, sourceWormId: null }), deps);
      expect(hpOf(current, 'team-1-worm-1')).toBe(1);
      expect(findWorm(current, 'team-1-worm-1')?.worm.immortalityCharges).toBe(2 - hit);
    }
    current = reduce(current, damage('team-1-worm-1', 100, { sourceTeamId: null, sourceWormId: null }), deps);
    expect(hpOf(current, 'team-1-worm-1')).toBe(0);
  });

  it('the fourth lethal attack, with no charges left, kills outright', () => {
    const { state, deps } = start();
    const exhausted = withWorm(state, 'team-1-worm-1', { hp: 1, immortalityCharges: 0, lastProtectedAttack: 'spent' });
    const hit = reduce(exhausted, damage('team-1-worm-1', 1_000_000), deps);
    expect(hpOf(hit, 'team-1-worm-1')).toBe(0);
    expect(hit.pendingDeaths.map((d) => d.wormId)).toEqual(['team-1-worm-1']);
  });

  it('a toll never looks at immortality either', () => {
    const { state, deps } = start();
    const paid = reduce(immortal(state, 50), { type: 'DamageApplied', wormId: 'team-1-worm-1', amount: 50, sourceTeamId: null, sourceWormId: null, toll: true }, deps);
    expect(hpOf(paid, 'team-1-worm-1')).toBe(0);
    expect(findWorm(paid, 'team-1-worm-1')?.worm.immortalityCharges).toBe(3);
    expect(paid.pendingDeaths).toHaveLength(1);
  });
});

describe('unique immortality pickup', () => {
  it('does not refill charges or grant a second worm another use', () => {
    const { state, deps } = start();
    const claimed = reduce(state, { type: 'CratePicked', wormId: 'team-1-worm-1', crate: 'immortality' }, deps);
    expect(claimed.immortalityEverDropped).toBe(true);
    const spent = reduce(claimed, damage('team-1-worm-1', 1000), deps);
    const duplicate = reduce(spent, { type: 'CratePicked', wormId: 'team-1-worm-1', crate: 'immortality' }, deps);
    expect(findWorm(duplicate, 'team-1-worm-1')?.worm.immortalityCharges).toBe(2);
    const second = reduce(duplicate, { type: 'CratePicked', wormId: 'team-2-worm-1', crate: 'immortality' }, deps);
    expect(findWorm(second, 'team-2-worm-1')?.worm.immortalityCharges).toBe(0);
  });
});

describe('drowning bypasses every protection', () => {
  it('drowns a shielded and immortal worm just the same', () => {
    const { state, deps } = start();
    const protected_ = withWorm(state, 'team-1-worm-1', { hp: 50, shieldDurability: 100, immortalityCharges: 3 });
    const drowned = reduce(protected_, { type: 'WormDrowned', wormId: 'team-1-worm-1' }, deps);
    expect(findWorm(drowned, 'team-1-worm-1')?.worm.alive).toBe(false);
  });
});
