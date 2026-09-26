import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput, type GameEvent } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import type { MatchState } from '@/match/state.ts';
import { findWorm } from '@/sim/world.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * The super move through the whole match flow: the shot stays open in Firing while the sim plays
 * the combo (the reducer must not hand the turn over mid beating), every blow reaches the ledger,
 * and the presentation hears the beats and the burst of a worm beaten to 0 hp.
 */

const IDLE: ControllerInput = Object.freeze({
  moveX: 0,
  jump: false,
  backflip: false,
  aimDelta: 0,
  fireHeld: false,
  fireReleased: false,
  thrust: false,
  selectedSlot: null,
  pointer: { x: 0, y: 0 },
  pointerClicked: false,
});

/**
 * A quick game moved past the super's scheme delay, so the opening human turn may use it; the
 * CPU team's worms can start hurt, so a beating is lethal on purpose.
 */
function makeController(options: { readonly enemyHp?: number } = {}): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value.state;
  const teams = base.teams.map((team, index) =>
    index === 0 || options.enemyHp === undefined ? team : { ...team, worms: team.worms.map((worm) => ({ ...worm, hp: options.enemyHp ?? worm.hp })) },
  );
  const state: MatchState = { ...base, turn: 3, teams };
  return createController({ ...game.value, state }, { cpu: { client: null, registry: WEAPONS } });
}

function tickUntil(controller: Controller, phase: string, sink: GameEvent[] = [], cap = 3000): number {
  let ticks = 0;
  while (controller.state().phase !== phase && ticks < cap) {
    controller.tick(IDLE);
    sink.push(...controller.drainEvents());
    ticks += 1;
  }
  return ticks;
}

function hpOf(state: MatchState, wormId: string): number {
  for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
  throw new Error(`no worm ${wormId}`);
}

/** Parks the first enemy on flat ground right in front of the active worm, in plain sight. */
function lineUp(controller: Controller): { attackerId: string; victimId: string } {
  const state = controller.state();
  const active = activeWormOf(state);
  const team = activeTeamOf(state);
  if (active === undefined || team === undefined) throw new Error('no active worm');
  const world = controller.world();
  const attacker = findWorm(world, active.id);
  const victim = world.worms.find((b) => b.alive && b.teamId !== team.id);
  if (attacker === undefined || victim === undefined) throw new Error('bodies missing');
  victim.x = attacker.x + attacker.facing * 40;
  victim.y = attacker.y;
  victim.vx = 0;
  victim.vy = 0;
  // Clear a corridor between them so the lock never depends on the island's shape.
  const mask = world.terrain.mask;
  const lo = Math.round(Math.min(attacker.x, victim.x)) - 4;
  const hi = Math.round(Math.max(attacker.x, victim.x)) + 4;
  for (let x = lo; x <= hi; x += 1) for (let y = Math.round(attacker.y) - 30; y < Math.round(attacker.y) - 1; y += 1) mask.data[y * mask.width + x] = 0;
  return { attackerId: attacker.id, victimId: victim.id };
}

function fireSuper(controller: Controller): void {
  controller.selectWeapon('ryuko_ranbu');
  expect(controller.selectedWeapon()).toBe('ryuko_ranbu');
  controller.tick({ ...IDLE, fireHeld: true });
  controller.tick({ ...IDLE, fireReleased: true });
}

describe('controller: ryuko ranbu', () => {
  it('is refused before its scheme delay has elapsed', () => {
    const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
    if (!game.ok) throw new Error(game.error.message);
    const controller = createController(game.value, { cpu: { client: null, registry: WEAPONS } });
    tickUntil(controller, 'Active');
    controller.selectWeapon('ryuko_ranbu');
    expect(controller.selectedWeapon()).not.toBe('ryuko_ranbu');
  });

  it('holds the shot open while the combo plays, then books all 75 hp and moves on', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    const before = hpOf(controller.state(), victimId);
    fireSuper(controller);
    expect(controller.state().phase).toBe('Firing');
    expect(controller.world().combos).toHaveLength(1);
    // Still Firing a second into the beating: the reducer has not been told the shot is over.
    for (let i = 0; i < 60; i += 1) controller.tick(IDLE);
    expect(controller.state().phase).toBe('Firing');
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    const after = hpOf(controller.state(), victimId);
    // 75 from the beating; the throw may add a hard landing or the water on top of it.
    expect(before - after).toBeGreaterThanOrEqual(Math.min(before, 75));
    const booked = controller.state().log.filter((entry) => entry.kind === 'damage' && entry.text.includes('takes 3'));
    expect(booked.length).toBeGreaterThanOrEqual(WEAPONS.ryuko_ranbu.combo!.hits);
    const beats = events.filter((e) => e.type === 'comboHit');
    expect(beats.length).toBeGreaterThanOrEqual(WEAPONS.ryuko_ranbu.combo!.hits);
    expect(events.some((e) => e.type === 'damage' && e.wormId === victimId)).toBe(true);
    expect(controller.state().log.some((entry) => entry.kind === 'retreat')).toBe(true);
  });

  it('keeps beating a victim at 0 hp and bursts it on the finisher, once, calling the knockout', () => {
    // 40 hp: the fourteenth blow empties it, the flurry goes on anyway, the finisher bursts it.
    const controller = makeController({ enemyHp: 40 });
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    fireSuper(controller);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    const gibs = events.filter((e) => e.type === 'gib' && e.wormId === victimId);
    expect(gibs).toHaveLength(1);
    const beats = events.filter((e) => e.type === 'comboHit');
    expect(beats).toHaveLength(WEAPONS.ryuko_ranbu.combo!.hits + 1);
    const finisherIndex = events.findIndex((e) => e.type === 'comboHit' && e.finisher);
    const gibIndex = events.findIndex((e) => e.type === 'gib' && e.wormId === victimId);
    // No burst while the victim is still held: it comes with the finisher, not with the 14th blow.
    expect(gibIndex).toBeGreaterThan(finisherIndex);
    const finisher = events[finisherIndex];
    expect(finisher?.type === 'comboHit' && finisher.ko).toBe(true);
  });

  it('whiffs with nobody in reach and still ends the turn through the retreat', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const state = controller.state();
    const team = activeTeamOf(state);
    // Everybody else leaves for the far side of the map.
    for (const body of controller.world().worms) {
      if (body.teamId !== team?.id) body.x = body.x < 600 ? 1150 : body.x;
    }
    const active = activeWormOf(state);
    const attacker = active === undefined ? undefined : findWorm(controller.world(), active.id);
    if (attacker === undefined) throw new Error('no attacker');
    for (const body of controller.world().worms) {
      if (body.teamId !== team?.id && Math.abs(body.x - attacker.x) < 300) body.x = attacker.x < 600 ? 1150 : 40;
    }
    fireSuper(controller);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(events.find((e) => e.type === 'comboEnd')).toMatchObject({ hits: 0 });
    expect(events.some((e) => e.type === 'comboHit')).toBe(false);
  });
});

describe('controller: presentation events', () => {
  it('reports where a gun hit landed and the bullet path', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    while (controller.aim().angleDeg > 0.5) controller.tick({ ...IDLE, aimDelta: -1 });
    controller.drainEvents();
    controller.tick({ ...IDLE, selectedSlot: WEAPON_IDS.indexOf('shotgun') + 1 });
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    const events = controller.drainEvents();
    expect(events.some((e) => e.type === 'fired' && e.weapon === 'shotgun')).toBe(true);
    expect(events.some((e) => e.type === 'tracer')).toBe(true);
    const hit = events.find((e) => e.type === 'damage' && e.wormId === victimId);
    if (hit !== undefined && hit.type === 'damage') {
      expect(hit.cause).toBe('hit');
      expect(Math.hypot(hit.dx, hit.dy)).toBeCloseTo(1, 6);
    }
  });

  it('bursts every worm of a team that surrenders, and never twice', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    controller.drainEvents();
    const team = controller.state().teams[1];
    if (team === undefined) throw new Error('no second team');
    controller.surrender(team.id);
    const first = controller.drainEvents().filter((e) => e.type === 'gib');
    expect(first.map((e) => (e.type === 'gib' ? e.wormId : '')).sort()).toEqual(team.worms.map((w) => w.id).sort());
    controller.tick(IDLE);
    expect(controller.drainEvents().filter((e) => e.type === 'gib')).toHaveLength(0);
  });
});
