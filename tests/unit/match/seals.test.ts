import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { activeTeamOf } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { teamSealed } from '@/match/seals.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';

/**
 * The Tesoro del Cielo in the ledger: the sealed worm's team loses its next turns, one strike each,
 * and the strikes are left for the controller to play; the seal breaks when the caster or the target
 * dies first. And Antares' price, half of what its user has.
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

/** From a resolving turn to the next team's TurnStart. */
function toNextTurnStart(state: MatchState, deps: MatchDeps): MatchState {
  return run(state, deps, [rest, banner, banner]);
}

/** Reds' R1 casts the treasure on Blues' B1, and the turn plays out to Blues' TurnStart. */
function sealB1(): { state: MatchState; deps: MatchDeps } {
  const { state, deps } = start();
  const active = reduce({ ...state, turn: 10 }, banner, deps);
  expect(active.phase).toBe('Active');
  const cast = run(active, deps, [
    { type: 'FireStarted', weaponId: 'tenbu_horin', shotsRemaining: 0 },
    { type: 'WormSealed', weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', targetId: 'team-2-worm-1', hits: 3, hitToll: 15 },
    { type: 'FireCompleted' },
    { type: 'RetreatDone' },
  ]);
  return { state: toNextTurnStart(cast, deps), deps };
}

describe('seals: the cast', () => {
  it('keeps the seal: caster, target, both teams, three strikes of 15', () => {
    const { state } = sealB1();
    expect(state.seals).toEqual([{ weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', casterTeamId: 'team-1', targetId: 'team-2-worm-1', targetTeamId: 'team-2', hits: 3, hitsLeft: 3, hitToll: 15 }]);
    expect(state.log.some((entry) => entry.kind === 'seal' && entry.text.includes('B1 is sealed by R1'))).toBe(true);
    expect(activeTeamOf(state)?.name).toBe('Blues');
    expect(teamSealed(state, 'team-2')).toBe(true);
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

describe('seals: the lost turns', () => {
  it('takes the sealed team\'s turn: straight to Resolving with a strike to play, and one strike fewer to come', () => {
    const { state, deps } = sealB1();
    const taken = reduce(state, banner, deps);
    expect(taken.phase).toBe('Resolving');
    expect(taken.strikes).toEqual([{ weaponId: 'tenbu_horin', casterId: 'team-1-worm-1', casterTeamId: 'team-1', targetId: 'team-2-worm-1', hit: 1, fatal: false, hitToll: 15 }]);
    expect(taken.seals[0]?.hitsLeft).toBe(2);
    expect(taken.log.some((entry) => entry.kind === 'turn.sealed')).toBe(true);
    // The other team plays its turn as ever, and the strikes are gone with the new turn.
    const reds = toNextTurnStart(taken, deps);
    expect(reds.strikes).toEqual([]);
    expect(reduce(reds, banner, deps).phase).toBe('Active');
  });

  it('strikes on three of the team\'s turns, the third the last, and then the team plays again', () => {
    let { state } = sealB1();
    const { deps } = sealB1();
    const hits: { hit: number; fatal: boolean }[] = [];
    for (let round = 0; round < 3; round += 1) {
      state = reduce(state, banner, deps);
      expect(state.phase).toBe('Resolving');
      hits.push(...state.strikes.map((s) => ({ hit: s.hit, fatal: s.fatal })));
      // Reds play a turn in between: skip it.
      state = toNextTurnStart(state, deps);
      state = run(state, deps, [banner, { type: 'SkipTurn', reason: 'skip' }]);
      state = toNextTurnStart(state, deps);
    }
    expect(hits).toEqual([{ hit: 1, fatal: false }, { hit: 2, fatal: false }, { hit: 3, fatal: true }]);
    expect(state.seals).toEqual([]);
    expect(activeTeamOf(state)?.name).toBe('Blues');
    expect(reduce(state, banner, deps).phase).toBe('Active');
  });

  it('breaks when the caster dies first: the team plays, and the log says so', () => {
    const { state, deps } = sealB1();
    const casterDead: MatchState = { ...state, teams: state.teams.map((t) => (t.id === 'team-1' ? { ...t, worms: t.worms.map((w) => (w.id === 'team-1-worm-1' ? { ...w, alive: false, hp: 0 } : w)) } : t)) };
    const played = reduce(casterDead, banner, deps);
    expect(played.phase).toBe('Active');
    expect(played.seals).toEqual([]);
    expect(played.log.some((entry) => entry.kind === 'seal.broken')).toBe(true);
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
