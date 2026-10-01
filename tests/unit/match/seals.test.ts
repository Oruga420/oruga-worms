import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { activeWormSealed, sealedWorms } from '@/match/seals.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';
import { nextWormIndex } from '@/match/turn.ts';

/**
 * The Tesoro del Cielo in the ledger: the sealed worm sits its turns out while its team plays on
 * with the others, and the treasure strikes it as each of those turns settles (the strikes are left
 * for the controller to play); only when the sealed worm is all its team has left is the turn taken
 * whole. The seal breaks when the caster or the target dies first. And Antares' price, half of what
 * its user has.
 */

function setup(): MatchSetup {
  return {
    seed: 42,
    teams: [
      { name: 'Reds', colorIndex: 0, controller: 'cpu', wormNames: ['R1', 'R2'] },
      { name: 'Blues', colorIndex: 1, controller: 'cpu', wormNames: ['B1', 'B2'] },
    ],
    worldSize: { w: 1920, h: 696 },
    waterY: 640,
    startingTeamIndex: 0,
  };
}

function start(): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(42, GAME_CONFIG);
  const result = buildInitialState(setup(), GAME_CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.value, deps };
}

function run(state: MatchState, deps: MatchDeps, events: readonly MatchEvent[]): MatchState {
  return events.reduce((current, event) => reduce(current, event, deps), state);
}

const banner: MatchEvent = { type: 'BannerDone' };
const rest: MatchEvent = { type: 'AllBodiesAtRest' };
const skip: MatchEvent = { type: 'SkipTurn', reason: 'skip' };

/** From a resolving turn to the next team's TurnStart. */
function toNextTurnStart(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [rest, banner, banner]);
}

function kill(state: MatchState, wormId: string): MatchState {
  return { ...state, teams: state.teams.map((t) => ({ ...t, worms: t.worms.map((w) => (w.id === wormId ? { ...w, alive: false, hp: 0 } : w)) })) };
}

/** Reds' R1 casts the treasure on Blues' B1, and the turn plays out to Blues' TurnStart (after `then`, if given). */
function sealB1(then: (state: MatchState) => MatchState = (state) => state): { state: MatchState; deps: MatchDeps } {
  const { state, deps } = start();
  const active = reduce({ ...state, turn: 10 }, banner, deps);
  expect(active.phase).toBe('Active');
  const cast = run(active, deps, [
    { type: 'FireStarted', weaponId: 'tenbu_horin', shotsRemaining: 0 },
    { type: 'WormSealed', weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', targetId: 'team-2-worm-1', hits: 3, hitToll: 15 },
    { type: 'FireCompleted' },
    { type: 'RetreatDone' },
  ]);
  return { state: toNextTurnStart(then(cast), deps), deps };
}

describe('seals: the cast', () => {
  it('keeps the seal: caster, target, both teams, three strikes of 15', () => {
    const { state } = sealB1();
    expect(state.seals).toEqual([{ weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', casterTeamId: 'team-1', targetId: 'team-2-worm-1', targetTeamId: 'team-2', hits: 3, hitsLeft: 3, hitToll: 15 }]);
    expect(state.log.some((entry) => entry.kind === 'seal' && entry.text.includes('B1 is sealed by R1'))).toBe(true);
    expect(activeTeamOf(state)?.name).toBe('Blues');
    expect(sealedWorms(state)('team-2-worm-1')).toBe(true);
    expect(sealedWorms(state)('team-2-worm-2')).toBe(false);
  });

  it('ignores a seal on a team mate, on a dead worm, or with no strikes', () => {
    const { state, deps } = start();
    const active = reduce({ ...state, turn: 10 }, banner, deps);
    const same = reduce(active, { type: 'WormSealed', weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', targetId: 'team-1-worm-2', hits: 3, hitToll: 15 }, deps);
    expect(same.seals).toEqual([]);
    const none = reduce(active, { type: 'WormSealed', weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', targetId: 'team-2-worm-1', hits: 0, hitToll: 15 }, deps);
    expect(none.seals).toEqual([]);
    const ghost = reduce(active, { type: 'WormSealed', weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', targetId: 'nobody', hits: 3, hitToll: 15 }, deps);
    expect(ghost.seals).toEqual([]);
  });
});

describe('seals: the sealed worm sits its turns out', () => {
  it('is passed over by the rotation while its team has another worm to play', () => {
    const { state } = sealB1();
    const blues = state.teams[1];
    if (blues === undefined) throw new Error('no Blues');
    // Without the seal B1 would be next; with it the turn goes to B2, and B1 is next only when it is all there is.
    expect(nextWormIndex(blues)).toBe(0);
    expect(nextWormIndex(blues, sealedWorms(state))).toBe(1);
    expect(nextWormIndex({ ...blues, worms: blues.worms.map((w, i) => (i === 1 ? { ...w, alive: false } : w)) }, sealedWorms(state))).toBe(0);
    expect(activeWormOf(state)?.id).toBe('team-2-worm-2');
    expect(activeWormSealed(state)).toBe(false);
  });

  it('lets its team play the turn, then strikes it as the turn settles, once, before the turn ends', () => {
    const { state, deps } = sealB1();
    const played = reduce(state, banner, deps);
    expect(played.phase).toBe('Active');
    expect(played.strikes).toEqual([]);
    const struck = run(played, deps, [skip, rest]);
    expect(struck.phase).toBe('Resolving');
    expect(struck.strikes).toEqual([{ weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', casterTeamId: 'team-1', targetId: 'team-2-worm-1', hit: 1, fatal: false, hitToll: 15 }]);
    expect(struck.seals[0]?.hitsLeft).toBe(2);
    expect(struck.log.some((entry) => entry.kind === 'seal.strike')).toBe(true);
    // The strike plays out and the turn settles for good: no second strike, and Reds come up.
    const ended = reduce(struck, rest, deps);
    expect(ended.phase).toBe('TurnEnd');
    expect(ended.strikes).toHaveLength(1);
    const reds = run(ended, deps, [banner, banner]);
    expect(activeTeamOf(reds)?.name).toBe('Reds');
    expect(reds.strikes).toEqual([]);
  });

  it('strikes on three of its team\'s turns, the third the last, and then the worm is back in the rotation', () => {
    let { state } = sealB1();
    const { deps } = sealB1();
    const hits: { hit: number; fatal: boolean }[] = [];
    for (let round = 0; round < 3; round += 1) {
      expect(activeWormOf(state)?.id).toBe('team-2-worm-2');
      state = run(state, deps, [banner, skip, rest]);
      hits.push(...state.strikes.map((s) => ({ hit: s.hit, fatal: s.fatal })));
      // The strike settles, then Reds play a turn in between: skip it.
      state = run(state, deps, [rest, banner, banner, banner, skip, rest, banner, banner]);
    }
    expect(hits).toEqual([{ hit: 1, fatal: false }, { hit: 2, fatal: false }, { hit: 3, fatal: true }]);
    expect(state.seals).toEqual([]);
    // In a match the third strike has killed it; here the ledger only shows the seal is spent.
    expect(activeWormOf(state)?.id).toBe('team-2-worm-1');
  });

  it('takes the turn whole when the sealed worm is all its team has left', () => {
    const { state, deps } = sealB1((cast) => kill(cast, 'team-2-worm-2'));
    expect(activeWormOf(state)?.id).toBe('team-2-worm-1');
    expect(activeWormSealed(state)).toBe(true);
    const taken = reduce(state, banner, deps);
    expect(taken.phase).toBe('Resolving');
    expect(taken.strikes).toEqual([{ weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', casterTeamId: 'team-1', targetId: 'team-2-worm-1', hit: 1, fatal: false, hitToll: 15 }]);
    expect(taken.log.some((entry) => entry.kind === 'turn.sealed')).toBe(true);
    // Its one strike this turn: the turn settles straight on to TurnEnd.
    const ended = reduce(taken, rest, deps);
    expect(ended.phase).toBe('TurnEnd');
    expect(ended.seals[0]?.hitsLeft).toBe(2);
  });

  it('breaks when the caster dies first: no strike, and the log says so', () => {
    const { state, deps } = sealB1();
    const played = reduce(kill(state, 'team-1-worm-1'), banner, deps);
    expect(played.phase).toBe('Active');
    expect(played.seals).toEqual([]);
    expect(played.log.some((entry) => entry.kind === 'seal.broken')).toBe(true);
    const ended = run(played, deps, [skip, rest]);
    expect(ended.phase).toBe('TurnEnd');
    expect(ended.strikes).toEqual([]);
  });
});

describe('a toll by share', () => {
  it('costs half of what the worm has, rounded up, and never more', () => {
    const { state, deps } = start();
    const active = reduce({ ...state, turn: 10 }, banner, deps);
    const shooter = 'team-1-worm-1';
    const withHp = (hp: number): MatchState => ({ ...active, teams: active.teams.map((t) => (t.id === 'team-1' ? { ...t, worms: t.worms.map((w) => (w.id === shooter ? { ...w, hp } : w)) } : t)) });
    const pay = (hp: number): number => {
      const paid = run(withHp(hp), deps, [
        { type: 'FireStarted', weaponId: 'antares', shotsRemaining: 0 },
        { type: 'DamageApplied', wormId: shooter, amount: 1_000_000, sourceTeamId: null, sourceWormId: null, toll: true, tollShare: 0.5 },
      ]);
      return hp - (paid.teams[0]?.worms[0]?.hp ?? 0);
    };
    expect(pay(100)).toBe(50);
    expect(pay(75)).toBe(38);
    expect(pay(1)).toBe(1);
  });
});
