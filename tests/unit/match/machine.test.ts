import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchConfig, type MatchDeps } from '@/match/deps.ts';
import type { MatchEvent } from '@/match/events.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState, type MatchSetup, type TeamSetup } from '@/match/setup.ts';
import type { MatchState, TeamController } from '@/match/state.ts';

const CONFIG: MatchConfig = { ...GAME_CONFIG, hotSeatMs: 1000 };

function team(name: string, colorIndex: 0 | 1, controller: TeamController, worms: readonly string[]): TeamSetup {
  return { name, colorIndex, controller, wormNames: worms };
}

function setup(controller: TeamController = 'cpu'): MatchSetup {
  return {
    seed: 42,
    teams: [team('Reds', 0, controller, ['R1', 'R2']), team('Blues', 1, controller, ['B1', 'B2'])],
    worldSize: { w: 1920, h: 696 },
    waterY: 640,
    startingTeamIndex: 0,
  };
}

function start(controller: TeamController = 'cpu', config: MatchConfig = CONFIG): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(42, config);
  const result = buildInitialState(setup(controller), config);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.value, deps };
}

function run(state: MatchState, deps: MatchDeps, events: readonly MatchEvent[]): MatchState {
  return events.reduce((current, event) => reduce(current, event, deps), state);
}

const tick = (dtMs: number): MatchEvent => ({ type: 'TimerTick', dtMs });
const banner: MatchEvent = { type: 'BannerDone' };
const rest: MatchEvent = { type: 'AllBodiesAtRest' };

/** From TurnStart to Active for CPU teams (no hot seat). */
function toActive(state: MatchState, deps: MatchDeps): MatchState {
  return reduce(state, banner, deps);
}

describe('match reducer: crates give what they promise', () => {
  it('a weapon crate without a named weapon rolls one with crate weight and finite ammo for the picking worm', () => {
    const { state, deps } = start();
    const active = toActive(state, deps);
    const picker = active.teams[0]?.worms[0];
    if (picker === undefined) throw new Error('no picker');
    const before = active.teams[0]?.worms[0]?.ammo ?? {};
    const after = run(active, deps, [{ type: 'CratePicked', wormId: picker.id, crate: 'weapon' }]);
    const ammo = after.teams[0]?.worms[0]?.ammo ?? {};
    const gained = (Object.keys(ammo) as (keyof typeof ammo)[]).filter((id) => (ammo[id] ?? 0) === (before[id] ?? 0) + 1);
    expect(gained).toHaveLength(1);
    // Other worms keep their inventories unchanged.
    expect(after.teams[1]?.worms[0]?.ammo).toEqual(active.teams[1]?.worms[0]?.ammo);
    expect(after.log.at(-2)?.kind).toBe('crate.weapon');
  });

  it('a utility crate grants a utility, and the crate count drops', () => {
    const { state, deps } = start();
    const active = toActive(state, deps);
    const picker = active.teams[1]?.worms[0];
    if (picker === undefined) throw new Error('no picker');
    const primed = { ...active, cratesOnMap: 1 };
    const after = run(primed, deps, [{ type: 'CratePicked', wormId: picker.id, crate: 'utility' }]);
    const before = active.teams[1]?.worms[0]?.ammo ?? {};
    const ammo = after.teams[1]?.worms[0]?.ammo ?? {};
    const gained = (Object.keys(ammo) as (keyof typeof ammo)[]).filter((id) => (ammo[id] ?? 0) === (before[id] ?? 0) + 1);
    expect(gained).toHaveLength(1);
    expect(['parachute', 'jetpack', 'teleport', 'girder']).toContain(gained[0]);
    expect(after.cratesOnMap).toBe(0);
  });
});

describe('match reducer: a shot that keeps the turn', () => {
  it('returns to Active when FireCompleted says the turn goes on, and retreats otherwise', () => {
    const { state, deps } = start();
    const active = toActive(state, deps);
    const kept = run(active, deps, [{ type: 'FireStarted', weaponId: 'parachute', shotsRemaining: 0 }, { type: 'FireCompleted', keepsTurn: true }]);
    expect(kept.phase).toBe('Active');
    const ended = run(active, deps, [{ type: 'FireStarted', weaponId: 'bazooka', shotsRemaining: 0 }, { type: 'FireCompleted' }]);
    expect(ended.phase).not.toBe('Active');
  });

  it('a two barrel weapon comes back to Active once and retreats after the second barrel', () => {
    const { state, deps } = start();
    const active = toActive(state, deps);
    const afterFirst = run(active, deps, [{ type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 1 }, { type: 'FireCompleted' }]);
    expect(afterFirst.phase).toBe('Active');
    expect(afterFirst.shot?.shotsRemaining).toBe(1);
    const afterSecond = run(afterFirst, deps, [{ type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 0 }, { type: 'FireCompleted' }]);
    expect(afterSecond.phase).toBe('Retreat');
  });
});

describe('match reducer: turn cycle', () => {
  it('starts at TurnStart on the pinned team with a rolled wind and a frozen state', () => {
    const { state } = start();
    expect(state.phase).toBe('TurnStart');
    expect(state.turn).toBe(1);
    expect(state.activeTeamIndex).toBe(0);
    expect(state.teams[0]?.activeWormIndex).toBe(0);
    expect(state.wind.step).toBeGreaterThanOrEqual(-10);
    expect(state.wind.step).toBeLessThanOrEqual(10);
    expect(Object.isFrozen(state)).toBe(true);
    expect(state.log.at(-1)?.kind).toBe('turn.start');
  });

  it('goes straight to Active for cpu teams with the full turn timer', () => {
    const { state, deps } = start();
    const active = toActive(state, deps);
    expect(active.phase).toBe('Active');
    expect(active.timers.turnRemainingMs).toBe(CONFIG.turnMs);
  });

  it('inserts a hot seat between two human teams and counts it down', () => {
    const { state, deps } = start('human');
    const seat = reduce(state, banner, deps);
    expect(seat.phase).toBe('HotSeat');
    expect(seat.timers.hotSeatRemainingMs).toBe(1000);
    const active = reduce(seat, tick(1000), deps);
    expect(active.phase).toBe('Active');
  });

  it('expires the turn timer into Resolving and settles at rest into TurnEnd, then rotates to the next team', () => {
    const { state, deps } = start();
    const resolving = run(state, deps, [banner, tick(CONFIG.turnMs)]);
    expect(resolving.phase).toBe('Resolving');
    expect(resolving.log.at(-1)?.kind).toBe('turn.timeout');
    const ended = reduce(resolving, rest, deps);
    expect(ended.phase).toBe('TurnEnd');
    expect(ended.settle).toMatchObject({ forceSettled: false, reason: 'rest' });
    const check = reduce(ended, banner, deps);
    expect(check.phase).toBe('SuddenDeathCheck');
    const nextTurn = reduce(check, banner, deps);
    expect(nextTurn.phase).toBe('TurnStart');
    expect(nextTurn.turn).toBe(2);
    expect(nextTurn.activeTeamIndex).toBe(1);
    expect(nextTurn.lastHitBy).toEqual({});
  });

  it('never mutates its input', () => {
    const { state, deps } = start();
    const snapshot = JSON.stringify(state);
    run(state, deps, [banner, tick(1000), { type: 'SkipTurn' }]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('match reducer: firing and retreat', () => {
  it('fires the bazooka into Firing, opens a ground retreat and reaches Resolving on RetreatDone', () => {
    const { state, deps } = start();
    const firing = run(state, deps, [banner, { type: 'FireStarted', weaponId: 'bazooka', shotsRemaining: 0 }]);
    expect(firing.phase).toBe('Firing');
    expect(firing.teams[0]?.worms[0]?.ammo.bazooka).toBe(-1);
    expect(firing.teams[0]?.score.shotsFired).toBe(1);
    const retreat = reduce(firing, { type: 'FireCompleted' }, deps);
    expect(retreat.phase).toBe('Retreat');
    expect(retreat.timers.retreatRemainingMs).toBe(CONFIG.retreatGroundMs);
    expect(reduce(retreat, { type: 'RetreatDone' }, deps).phase).toBe('Resolving');
  });

  it('gives the dynamite the 5 s retreat and ends the turn at once after a teleport', () => {
    const { state, deps } = start();
    const dyn = run(state, deps, [banner, { type: 'FireStarted', weaponId: 'dynamite', shotsRemaining: 0 }, { type: 'FireCompleted' }]);
    expect(dyn.timers.retreatRemainingMs).toBe(5000);
    const tele = run(state, deps, [banner, { type: 'FireStarted', weaponId: 'teleport', shotsRemaining: 0 }, { type: 'FireCompleted' }]);
    expect(tele.phase).toBe('Resolving');
  });

  it('returns to Active between shotgun barrels and consumes finite ammo once per turn', () => {
    const { state, deps } = start();
    const first = run(state, deps, [banner, { type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 1 }, { type: 'FireCompleted' }]);
    expect(first.phase).toBe('Active');
    expect(first.shot?.shotsRemaining).toBe(1);
    const second = run(first, deps, [{ type: 'FireStarted', weaponId: 'shotgun', shotsRemaining: 0 }, { type: 'FireCompleted' }]);
    expect(second.phase).toBe('Retreat');
    const mortar = run(state, deps, [banner, { type: 'FireStarted', weaponId: 'mortar', shotsRemaining: 0 }]);
    expect(mortar.teams[0]?.worms[0]?.ammo.mortar).toBe(4);
  });

  it('rejects firing a weapon with no ammo and stays Active', () => {
    const { state, deps } = start();
    const rejected = run(state, deps, [banner, { type: 'FireStarted', weaponId: 'banana_bomb', shotsRemaining: 0 }]);
    expect(rejected.phase).toBe('Active');
    expect(rejected.log.at(-1)?.kind).toBe('fire.rejected');
  });
});

describe('match reducer: damage, deaths and the match end', () => {
  it('books enemy damage, queues a death at 0 hp and applies it with kill credit at TurnEnd', () => {
    const { state, deps } = start();
    const hit = run(state, deps, [
      banner,
      { type: 'FireStarted', weaponId: 'bazooka', shotsRemaining: 0 },
      { type: 'DamageApplied', wormId: 'team-2-worm-1', amount: 30, sourceTeamId: 'team-1', sourceWormId: 'team-1-worm-1' },
    ]);
    expect(hit.teams[1]?.worms[0]?.hp).toBe(70);
    expect(hit.teams[0]?.score.damageDealt).toBe(30);
    expect(hit.shot?.damage).toBe(30);
    const lethal = reduce(hit, { type: 'DamageApplied', wormId: 'team-2-worm-1', amount: 500, sourceTeamId: 'team-1', sourceWormId: null }, deps);
    expect(lethal.teams[1]?.worms[0]?.hp).toBe(0);
    expect(lethal.pendingDeaths.map((d) => d.wormId)).toEqual(['team-2-worm-1']);
    expect(lethal.teams[0]?.score.damageDealt).toBe(100);
    const ended = run(lethal, deps, [{ type: 'FireCompleted' }, { type: 'RetreatDone' }, rest]);
    expect(ended.phase).toBe('TurnEnd');
    expect(ended.teams[1]?.worms[0]?.alive).toBe(false);
    expect(ended.pendingDeaths).toEqual([]);
    expect(ended.teams[0]?.score.kills).toBe(1);
    expect(ended.teams[0]?.score.shotsHit).toBe(1);
    expect(ended.teams[0]?.score.bestShot).toBe(100);
  });

  it('forfeits the turn when the active worm drowns', () => {
    const { state, deps } = start();
    const drowned = run(state, deps, [banner, { type: 'WormDrowned', wormId: 'team-1-worm-1' }]);
    expect(drowned.phase).toBe('Resolving');
    expect(drowned.teams[0]?.worms[0]?.alive).toBe(false);
    expect(drowned.log.some((entry) => entry.kind === 'death.drowned')).toBe(true);
  });

  it('ends the match with the winner bonus when the other team surrenders', () => {
    const { state, deps } = start();
    const ended = run(state, deps, [banner, { type: 'Surrender', teamId: 'team-2' }]);
    expect(ended.phase).toBe('MatchEnd');
    expect(ended.teams[1]?.worms.every((w) => !w.alive)).toBe(true);
    expect(ended.teams[0]?.score.points).toBe(200 + 2 * 2 * CONFIG.wormHp);
    expect(reduce(ended, tick(1000), deps)).toBe(ended);
  });
});

describe('match reducer: resolving caps and sudden death', () => {
  it('force settles on the inactivity cap unless activity pings reset it, and on the absolute ceiling', () => {
    const { state, deps } = start();
    const resolving = run(state, deps, [banner, { type: 'SkipTurn' }]);
    expect(resolving.phase).toBe('Resolving');
    const kept = run(resolving, deps, [tick(5000), { type: 'ActivityPing', kind: 'bounce' }, tick(5000)]);
    expect(kept.phase).toBe('Resolving');
    const forced = reduce(kept, tick(CONFIG.resolve.inactivityMs), deps);
    expect(forced.phase).toBe('TurnEnd');
    expect(forced.settle).toMatchObject({ forceSettled: true, reason: 'inactivity' });
    const pinged = run(resolving, deps, Array.from({ length: 12 }, () => [tick(4000), { type: 'ActivityPing', kind: 'carve' } as MatchEvent]).flat());
    expect(pinged.phase).toBe('TurnEnd');
    expect(pinged.settle?.reason).toBe('absolute');
  });

  it('triggers sudden death after the round clock, capping hp once and then raising the water', () => {
    const { state, deps } = start();
    const late = run(state, deps, [banner, tick(CONFIG.roundMs), rest, banner]);
    expect(late.phase).toBe('SuddenDeathCheck');
    expect(late.suddenDeath).toBe(true);
    expect(late.teams.every((t) => t.worms.every((w) => w.hp === 1))).toBe(true);
    expect(late.waterY).toBe(640);
    const nextRound = run(late, deps, [banner, banner, { type: 'SkipTurn' }, rest, banner]);
    expect(nextRound.phase).toBe('SuddenDeathCheck');
    expect(nextRound.waterY).toBe(640 - CONFIG.suddenDeath.waterRisePxPerTurn);
  });

  it('pins the wind from a replay event', () => {
    const { state, deps } = start();
    expect(reduce(state, { type: 'WindRolled', step: 7 }, deps).wind.step).toBe(7);
    expect(reduce(state, { type: 'WindRolled', step: 40 }, deps).wind.step).toBe(10);
  });
});


describe('personal inventories', () => {
  it('spends only the firing worm inventory and gives pickups only to their finder', () => {
    const { state, deps } = start();
    const active = toActive(state, deps);
    const fired = reduce(active, { type: 'FireStarted', weaponId: 'mortar', shotsRemaining: 0 }, deps);
    expect(fired.teams[0]?.worms[0]?.ammo.mortar).toBe(4);
    expect(fired.teams[0]?.worms[1]?.ammo.mortar).toBe(5);
    const picker = fired.teams[0]?.worms[1];
    if (picker === undefined) throw new Error('missing teammate');
    const picked = reduce(fired, { type: 'CratePicked', wormId: picker.id, crate: 'weapon', weaponId: 'mortar' }, deps);
    expect(picked.teams[0]?.worms[1]?.ammo.mortar).toBe(6);
    expect(picked.teams[0]?.worms[0]?.ammo.mortar).toBe(4);
    expect(active.teams[0]?.worms[0]?.ammo.mortar).toBe(5);
  });

  it('charges each utility and subsequent weapon, rejecting an exhausted personal supply', () => {
    const { state, deps } = start();
    let current = toActive(state, deps);
    for (let i = 0; i < 2; i += 1) {
      current = run(current, deps, [{ type: 'FireStarted', weaponId: 'parachute', shotsRemaining: 0 }, { type: 'FireCompleted', keepsTurn: true }]);
    }
    expect(current.teams[0]?.worms[0]?.ammo.parachute).toBe(0);
    current = reduce(current, { type: 'FireStarted', weaponId: 'parachute', shotsRemaining: 0 }, deps);
    expect(current.phase).toBe('Active');
    expect(current.log.at(-1)?.kind).toBe('fire.rejected');
    current = reduce(current, { type: 'FireStarted', weaponId: 'mortar', shotsRemaining: 0 }, deps);
    expect(current.teams[0]?.worms[0]?.ammo.mortar).toBe(4);
    expect(current.teams[0]?.worms[1]?.ammo.parachute).toBe(2);
  });
});


it('releases an airborne destroyed crate without removing another landed crate', () => {
  const { state, deps } = start();
  const destroyed = reduce({ ...state, crateDrop: 'weapon', cratesOnMap: 2 }, { type: 'CrateDestroyed', wasCounted: false }, deps);
  expect(destroyed.crateDrop).toBeNull();
  expect(destroyed.cratesOnMap).toBe(2);
  const landedDestroyed = reduce({ ...state, crateDrop: 'weapon', cratesOnMap: 2 }, { type: 'CrateDestroyed', wasCounted: true }, deps);
  expect(landedDestroyed.crateDrop).toBe('weapon');
  expect(landedDestroyed.cratesOnMap).toBe(1);
});


it('rejects scheme-locked weapons without spending personal ammo', () => {
  const { state, deps } = start();
  const active = toActive(state, deps);
  const denied = reduce(active, { type: 'FireStarted', weaponId: 'air_strike', shotsRemaining: 0 }, deps);
  expect(denied.phase).toBe('Active');
  expect(denied.teams[0]?.worms[0]?.ammo.air_strike).toBe(1);
  expect(denied.log.at(-1)?.kind).toBe('fire.rejected');
  const unlocked = reduce({ ...active, turn: 5 }, { type: 'FireStarted', weaponId: 'air_strike', shotsRemaining: 0 }, deps);
  expect(unlocked.phase).toBe('Firing');
  expect(unlocked.teams[0]?.worms[0]?.ammo.air_strike).toBe(0);
});
