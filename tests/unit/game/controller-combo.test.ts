import { describe, expect, it } from 'vitest';
import { cinematicFor } from '@/game/cinematic.ts';
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
function makeController(options: { readonly enemyHp?: number; readonly turn?: number } = {}): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value.state;
  const teams = base.teams.map((team, index) =>
    index === 0 || options.enemyHp === undefined ? team : { ...team, worms: team.worms.map((worm) => ({ ...worm, hp: options.enemyHp ?? worm.hp })) },
  );
  const state: MatchState = { ...base, turn: options.turn ?? 3, teams };
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
    // The numbers count what the 40 hp could lose; the blows after 0 still land, for nothing.
    const blows = events.filter((e) => e.type === 'damage' && e.wormId === victimId);
    expect(blows.reduce((sum, e) => sum + (e.type === 'damage' ? e.lost : 0), 0)).toBe(40);
    expect(blows.some((e) => e.type === 'damage' && e.amount > 0 && e.lost === 0)).toBe(true);
    // Thrown by the finisher, it burst where it was hit: no whole worm sinks or lands afterwards.
    const afterwards = events.slice(gibIndex + 1).filter((e) => (e.type === 'damage' || e.type === 'landed' || e.type === 'drown') && e.wormId === victimId);
    expect(afterwards).toEqual([]);
  });

  it('a surrender mid beating ends the fight instead of holding the white screen over the end', () => {
    const controller = makeController({ enemyHp: 40 });
    tickUntil(controller, 'Active');
    const { attackerId } = lineUp(controller);
    fireSuper(controller);
    for (let i = 0; i < 70; i += 1) controller.tick(IDLE);
    expect(controller.world().combos.some((c) => c.alive && c.stage === 'flurry')).toBe(true);
    controller.drainEvents();
    const team = activeTeamOf(controller.state());
    if (team === undefined) throw new Error('no active team');
    // The attacker's own side gives up in the middle of the blows.
    controller.surrender(team.id);
    expect(controller.state().phase).toBe('MatchEnd');
    const events = controller.drainEvents();
    expect(controller.world().combos).toHaveLength(0);
    expect(cinematicFor(controller.world().combos)).toMatchObject({ whiteout: 0, dim: 0, zoom: 1 });
    expect(events.some((e) => e.type === 'comboEnd')).toBe(true);
    // Its whole team bursts, the attacker the fight was holding included.
    expect(events.some((e) => e.type === 'gib' && e.wormId === attackerId)).toBe(true);
    controller.tick(IDLE);
    expect(controller.world().combos).toHaveLength(0);
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

  it('an air strike comes from the sky: the worm shows no muzzle flash or recoil for it', () => {
    const controller = makeController({ turn: 9 });
    tickUntil(controller, 'Active');
    controller.selectWeapon('air_strike');
    expect(controller.selectedWeapon()).toBe('air_strike');
    const active = activeWormOf(controller.state());
    const body = active === undefined ? undefined : findWorm(controller.world(), active.id);
    if (body === undefined) throw new Error('no active body');
    controller.drainEvents();
    controller.tick({ ...IDLE, pointerClicked: true, pointer: { x: body.x + 150, y: 40 } });
    // The strike was called (the turn moved on), and the worm itself fired nothing.
    expect(controller.state().phase).not.toBe('Active');
    expect(controller.drainEvents().some((e) => e.type === 'fired')).toBe(false);
  });

  it('takes a burst worm out of the physics: it never lands, drowns or bleeds again', () => {
    // The bat throws a 10 hp worm far: it bursts on the blow, and its body must stop right there.
    const controller = makeController({ enemyHp: 10 });
    tickUntil(controller, 'Active');
    const { attackerId, victimId } = lineUp(controller);
    const attacker = findWorm(controller.world(), attackerId);
    const victim = findWorm(controller.world(), victimId);
    if (attacker === undefined || victim === undefined) throw new Error('bodies missing');
    // Within the bat's 20 px reach.
    victim.x = attacker.x + attacker.facing * 14;
    controller.selectWeapon('baseball_bat');
    expect(controller.selectedWeapon()).toBe('baseball_bat');
    while (controller.aim().angleDeg > 0.5) controller.tick({ ...IDLE, aimDelta: -1 });
    controller.drainEvents();
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    const events: GameEvent[] = [...controller.drainEvents()];
    expect(events.filter((e) => e.type === 'gib' && e.wormId === victimId)).toHaveLength(1);
    // A 30 hp blow on a worm with 10 left: the blood gets the force, the number the 10.
    expect(events.find((e) => e.type === 'damage' && e.wormId === victimId)).toMatchObject({ amount: WEAPONS.baseball_bat.melee?.damage, lost: 10 });
    const body = findWorm(controller.world(), victimId);
    expect(body).toMatchObject({ alive: false, motion: 'dead', vx: 0, vy: 0 });
    const burstAt = { x: body?.x, y: body?.y };
    tickUntil(controller, 'TurnEnd', events);
    const gib = events.findIndex((e) => e.type === 'gib' && e.wormId === victimId);
    const afterwards = events.slice(gib + 1).filter((e) => (e.type === 'damage' || e.type === 'landed' || e.type === 'drown') && e.wormId === victimId);
    expect(afterwards).toEqual([]);
    // Still where it burst: there is nothing for the camera to chase.
    expect(findWorm(controller.world(), victimId)).toMatchObject(burstAt);
    expect(hpOf(controller.state(), victimId)).toBe(0);
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

describe('controller: kamehameha', () => {
  /**
   * Picks the beam, lets the target settle where it landed and aims at its middle, as a player
   * would, then fires: a press and a release of the fire key.
   */
  function fireBeam(controller: Controller, targetId?: string): GameEvent[] {
    controller.selectWeapon('kamehameha');
    expect(controller.selectedWeapon()).toBe('kamehameha');
    const world = controller.world();
    const target = targetId === undefined ? undefined : findWorm(world, targetId);
    // lineUp drops it at the attacker's height; on a slope it falls to the ground below first.
    if (target !== undefined) for (let i = 0; i < 90; i += 1) controller.tick(IDLE);
    const attacker = findWorm(world, activeWormOf(controller.state())?.id ?? '');
    const wanted =
      target === undefined || attacker === undefined ? 0 : (Math.atan2(attacker.y - 9.6 - (target.y - 8), Math.abs(target.x - attacker.x - attacker.facing * 6)) * 180) / Math.PI;
    for (let i = 0; i < 200 && Math.abs(controller.aim().angleDeg - wanted) > 0.6; i += 1) controller.tick({ ...IDLE, aimDelta: controller.aim().angleDeg > wanted ? -1 : 1 });
    controller.drainEvents();
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    return controller.drainEvents();
  }

  it('is refused before its scheme delay has elapsed', () => {
    const controller = makeController({ turn: 1 });
    tickUntil(controller, 'Active');
    controller.selectWeapon('kamehameha');
    expect(controller.selectedWeapon()).not.toBe('kamehameha');
  });

  it('holds the shot open through the charge and the beam, books the hit, then moves on', () => {
    const controller = makeController({ turn: 5 });
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    const before = hpOf(controller.state(), victimId);
    const fired = fireBeam(controller, victimId);
    // No muzzle flash at the press: the beam brings its own when it leaves the hands.
    expect(fired.some((e) => e.type === 'fired')).toBe(false);
    expect(fired.some((e) => e.type === 'beamStart')).toBe(true);
    expect(controller.state().phase).toBe('Firing');
    // Still Firing a second into the charge: the reducer has not been told the shot is over.
    for (let i = 0; i < 60; i += 1) controller.tick(IDLE);
    expect(controller.state().phase).toBe('Firing');
    expect(controller.world().beams).toHaveLength(1);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(events.some((e) => e.type === 'beamFire')).toBe(true);
    expect(events.some((e) => e.type === 'beamEnd')).toBe(true);
    expect(before - hpOf(controller.state(), victimId)).toBeGreaterThanOrEqual(Math.min(before, WEAPONS.kamehameha.beam!.damage));
    expect(controller.state().log.some((entry) => entry.kind === 'damage' && entry.text.includes(`takes ${WEAPONS.kamehameha.beam!.damage}`))).toBe(true);
    expect(controller.state().log.some((entry) => entry.kind === 'retreat')).toBe(true);
  });

  it('a surrender mid beam ends it and lets the worm go', () => {
    const controller = makeController({ turn: 5 });
    tickUntil(controller, 'Active');
    lineUp(controller);
    fireBeam(controller);
    for (let i = 0; i < 30; i += 1) controller.tick(IDLE);
    expect(controller.world().beams.some((b) => b.alive && b.stage === 'charge')).toBe(true);
    controller.drainEvents();
    const team = activeTeamOf(controller.state());
    if (team === undefined) throw new Error('no active team');
    controller.surrender(team.id);
    expect(controller.state().phase).toBe('MatchEnd');
    expect(controller.world().beams).toHaveLength(0);
    expect(controller.drainEvents().some((e) => e.type === 'beamEnd')).toBe(true);
  });
});

describe('controller: gear 5', () => {
  const SPEC = WEAPONS.gear_five.devour!;

  /** Picks Gear 5, lets the lined up victim settle where it landed, then presses and releases fire. */
  function fireGear(controller: Controller): GameEvent[] {
    controller.selectWeapon('gear_five');
    expect(controller.selectedWeapon()).toBe('gear_five');
    for (let i = 0; i < 90; i += 1) controller.tick(IDLE);
    controller.drainEvents();
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    return controller.drainEvents();
  }

  it('is refused before its scheme delay has elapsed', () => {
    const controller = makeController({ turn: 1 });
    tickUntil(controller, 'Active');
    controller.selectWeapon('gear_five');
    expect(controller.selectedWeapon()).not.toBe('gear_five');
  });

  it('holds the shot open through the whole meal, eats the victim without a burst, then moves on', () => {
    const controller = makeController({ turn: 5 });
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    const fired = fireGear(controller);
    // Nothing leaves the hands at the press: no muzzle flash, the awakening starts instead.
    expect(fired.some((e) => e.type === 'fired')).toBe(false);
    expect(fired.some((e) => e.type === 'devourStart' && e.victimId === victimId)).toBe(true);
    // Still Firing two seconds in, mid awakening: the reducer has not been told the shot is over.
    for (let i = 0; i < 120; i += 1) controller.tick(IDLE);
    expect(controller.state().phase).toBe('Firing');
    expect(controller.world().devours).toHaveLength(1);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    const beats = events.flatMap((e) => (e.type === 'devourBeat' ? [e.beat] : []));
    expect(beats).toEqual(['drum', 'drum', 'drum', 'drum', 'awake', 'stretch', 'grab', 'chomp', 'chomp', 'chomp', 'chomp', 'gulp', 'burp']);
    // Swallowed whole: no burst on the ground, and the body is out of the world.
    expect(events.some((e) => e.type === 'gib' && e.wormId === victimId)).toBe(false);
    expect(findWorm(controller.world(), victimId)?.alive).toBe(false);
    expect(events.some((e) => e.type === 'devourEnd' && e.eaten)).toBe(true);
    const bites = controller.state().log.filter((entry) => entry.kind === 'damage' && entry.text.includes(`takes ${SPEC.chompDamage}`));
    expect(bites.length).toBe(SPEC.chomps);
    expect(controller.state().log.some((entry) => entry.kind === 'retreat')).toBe(true);
  });

  it('eats a worm a health crate topped up past full, all of it', () => {
    const controller = makeController({ turn: 5, enemyHp: 180 });
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    fireGear(controller);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    expect(events.some((e) => e.type === 'gib' && e.wormId === victimId)).toBe(false);
    // The swallow's number shows what the bites left, not the million the sim sends.
    const numbers = events.flatMap((e) => (e.type === 'damage' && e.wormId === victimId ? [e.lost] : []));
    expect(numbers.reduce((sum, lost) => sum + lost, 0)).toBe(180);
  });

  it('a surrender mid meal ends it and lets the uneaten victim go', () => {
    const controller = makeController({ turn: 5 });
    tickUntil(controller, 'Active');
    const { victimId } = lineUp(controller);
    fireGear(controller);
    for (let i = 0; i < 1000 && controller.world().devours[0]?.stage !== 'chew'; i += 1) controller.tick(IDLE);
    expect(controller.world().devours[0]?.stage).toBe('chew');
    controller.tick(IDLE);
    controller.drainEvents();
    const team = activeTeamOf(controller.state());
    if (team === undefined) throw new Error('no active team');
    controller.surrender(team.id);
    expect(controller.state().phase).toBe('MatchEnd');
    expect(controller.world().devours).toHaveLength(0);
    const events = controller.drainEvents();
    expect(events.some((e) => e.type === 'devourEnd' && !e.eaten)).toBe(true);
    expect(findWorm(controller.world(), victimId)?.alive).toBe(true);
    expect(hpOf(controller.state(), victimId)).toBeGreaterThan(0);
  });
});

describe('controller: freezer', () => {
  /** Picks the Freezer, lets the lined up victim settle where it landed, then presses and releases fire. */
  function fireFreezer(controller: Controller): GameEvent[] {
    controller.selectWeapon('freezer');
    expect(controller.selectedWeapon()).toBe('freezer');
    for (let i = 0; i < 90; i += 1) controller.tick(IDLE);
    controller.drainEvents();
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    return controller.drainEvents();
  }

  /** Moves the lined up victim farther off, still in plain sight, so the burst reaches nobody else. */
  function stepBack(controller: Controller, attackerId: string, victimId: string, dx: number): void {
    const world = controller.world();
    const attacker = findWorm(world, attackerId);
    const victim = findWorm(world, victimId);
    if (attacker === undefined || victim === undefined) throw new Error('bodies missing');
    victim.x = attacker.x + attacker.facing * dx;
    const mask = world.terrain.mask;
    const lo = Math.round(Math.min(attacker.x, victim.x)) - 4;
    const hi = Math.round(Math.max(attacker.x, victim.x)) + 4;
    for (let x = lo; x <= hi; x += 1) for (let y = Math.round(attacker.y) - 30; y < Math.round(attacker.y) - 1; y += 1) mask.data[y * mask.width + x] = 0;
  }

  it('is refused before its scheme delay has elapsed', () => {
    const controller = makeController({ turn: 1 });
    tickUntil(controller, 'Active');
    controller.selectWeapon('freezer');
    expect(controller.selectedWeapon()).not.toBe('freezer');
  });

  it('holds the shot open until the victim bursts, blows it into gore, then moves on', () => {
    const controller = makeController({ turn: 5 });
    tickUntil(controller, 'Active');
    const { attackerId, victimId } = lineUp(controller);
    stepBack(controller, attackerId, victimId, 70);
    const fired = fireFreezer(controller);
    // Nothing leaves a barrel at the press: no muzzle flash, the finger goes up instead.
    expect(fired.some((e) => e.type === 'fired')).toBe(false);
    expect(fired.some((e) => e.type === 'hexStart' && e.victimId === victimId)).toBe(true);
    // Still Firing two seconds in: the reducer has not been told the shot is over.
    for (let i = 0; i < 120; i += 1) controller.tick(IDLE);
    expect(controller.state().phase).toBe('Firing');
    expect(controller.world().hexes).toHaveLength(1);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    const beats = events.flatMap((e) => (e.type === 'hexBeat' ? [e.beat] : []));
    expect(beats).toEqual(['shot', 'enter', 'pulse', 'pulse', 'pulse', 'pulse', 'pulse', 'burst']);
    // Blown apart: one burst of gore, up where it floated, and the body out of the world.
    const gibs = events.filter((e) => e.type === 'gib' && e.wormId === victimId);
    expect(gibs).toHaveLength(1);
    const burst = events.find((e): e is Extract<GameEvent, { type: 'hexBeat' }> => e.type === 'hexBeat' && e.beat === 'burst');
    expect(gibs[0]).toMatchObject({ x: burst?.x, y: burst?.y });
    expect(findWorm(controller.world(), victimId)?.alive).toBe(false);
    expect(events.some((e) => e.type === 'hexEnd' && e.burst)).toBe(true);
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(hpOf(controller.state(), attackerId)).toBeGreaterThan(0);
    expect(controller.state().log.some((entry) => entry.kind === 'retreat')).toBe(true);
  });

  it('bursts a worm a health crate topped up past full, all of it, with one number for what it had', () => {
    const controller = makeController({ turn: 5, enemyHp: 180 });
    tickUntil(controller, 'Active');
    const { attackerId, victimId } = lineUp(controller);
    stepBack(controller, attackerId, victimId, 70);
    fireFreezer(controller);
    const events: GameEvent[] = [];
    tickUntil(controller, 'TurnEnd', events);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    const numbers = events.flatMap((e) => (e.type === 'damage' && e.wormId === victimId ? [e.lost] : []));
    expect(numbers).toEqual([180]);
  });

  it('a surrender mid swell ends it and lets the victim down whole', () => {
    const controller = makeController({ turn: 5 });
    tickUntil(controller, 'Active');
    const { attackerId, victimId } = lineUp(controller);
    stepBack(controller, attackerId, victimId, 70);
    fireFreezer(controller);
    for (let i = 0; i < 1000 && controller.world().hexes[0]?.stage !== 'swell'; i += 1) controller.tick(IDLE);
    expect(controller.world().hexes[0]?.stage).toBe('swell');
    controller.tick(IDLE);
    controller.drainEvents();
    const team = activeTeamOf(controller.state());
    if (team === undefined) throw new Error('no active team');
    controller.surrender(team.id);
    expect(controller.state().phase).toBe('MatchEnd');
    expect(controller.world().hexes).toHaveLength(0);
    const events = controller.drainEvents();
    expect(events.some((e) => e.type === 'hexEnd' && !e.burst)).toBe(true);
    expect(findWorm(controller.world(), victimId)?.alive).toBe(true);
    expect(hpOf(controller.state(), victimId)).toBeGreaterThan(0);
  });
});
