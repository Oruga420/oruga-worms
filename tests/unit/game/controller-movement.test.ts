import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { TICK_MS } from '@/config/units.ts';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { findWorm } from '@/sim/world.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

const MOVE = GAME_CONFIG.movement;
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

function makeController(seed = 7): Controller {
  const game = quickGame(seed, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  // No CPU client: the heuristic floor decides the blue turns, which is all these tests need.
  return createController(game.value, { cpu: { client: null, registry: WEAPONS } });
}

/** Ticks until the reducer is in the given phase or the cap is hit; returns the ticks spent. */
function tickUntil(controller: Controller, phase: string, input: ControllerInput = IDLE, cap = 2000): number {
  let ticks = 0;
  while (controller.state().phase !== phase && ticks < cap) {
    controller.tick(input);
    ticks += 1;
  }
  return ticks;
}

function activeX(controller: Controller): number {
  const active = activeWormOf(controller.state());
  const body = active === undefined ? undefined : findWorm(controller.world(), active.id);
  if (body === undefined) throw new Error('no active body');
  return body.x;
}

describe('controller: movement budget', () => {
  it('starts every turn with the full budget in whole steps', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    expect(controller.state().phase).toBe('Active');
    expect(controller.stepsRemaining()).toBe(MOVE.stepsPerTurn);
  });

  it('spends steps only when the worm really moves, and freezes walking once they are gone', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const walk: ControllerInput = { ...IDLE, moveX: 1 };

    const startX = activeX(controller);
    let before = controller.stepsRemaining();
    let moved = 0;
    // Walk for at most 15 s of sim time: plenty to drain 10 steps at 60 px/s if the ground allows.
    for (let i = 0; i < Math.round(15_000 / TICK_MS) && controller.state().phase === 'Active'; i += 1) {
      const x0 = activeX(controller);
      controller.tick(walk);
      moved += Math.abs(activeX(controller) - x0);
      const after = controller.stepsRemaining();
      // The count never goes up mid turn and never drops without displacement.
      expect(after).toBeLessThanOrEqual(before);
      before = after;
      if (after === 0) break;
    }

    if (controller.stepsRemaining() === 0) {
      // Budget spent: the bill matches the ground covered, and the worm is now rooted.
      expect(moved).toBeGreaterThanOrEqual(MOVE.stepsPerTurn * MOVE.stepPx - 1);
      const frozenX = activeX(controller);
      for (let i = 0; i < 60 && controller.state().phase === 'Active'; i += 1) controller.tick(walk);
      expect(Math.abs(activeX(controller) - frozenX)).toBeLessThan(1);
    } else {
      // The fake terrain blocked the walk: then nothing may have been charged for standing still.
      expect(Math.abs(activeX(controller) - startX)).toBeLessThan(MOVE.stepPx);
      expect(controller.stepsRemaining()).toBe(MOVE.stepsPerTurn);
    }
  });

  it('charges a jump up front and refuses one once the budget is spent', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const full = controller.stepsRemaining();
    controller.tick({ ...IDLE, jump: true });
    expect(controller.stepsRemaining()).toBe(full - MOVE.jumpStepCost);
    // Burn the rest with jumps; the last one must be refused (no further charge).
    let guard = 0;
    while (controller.stepsRemaining() > 0 && guard < 20) {
      controller.tick({ ...IDLE, jump: true });
      guard += 1;
    }
    expect(controller.stepsRemaining()).toBe(0);
    controller.tick({ ...IDLE, jump: true });
    expect(controller.stepsRemaining()).toBe(0);
  });

  it('never blocks aiming or firing: a rooted worm can still shoot', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    while (controller.stepsRemaining() > 0) controller.tick({ ...IDLE, jump: true });
    // Charge the bazooka for a few ticks, then release.
    for (let i = 0; i < 20; i += 1) controller.tick({ ...IDLE, fireHeld: true });
    expect(controller.aim().power).toBeGreaterThan(0);
    controller.tick({ ...IDLE, fireReleased: true });
    expect(['Firing', 'Retreat', 'Resolving']).toContain(controller.state().phase);
  });

  it('refills the budget at the next turn boundary', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    while (controller.stepsRemaining() > 0) controller.tick({ ...IDLE, jump: true });
    expect(controller.stepsRemaining()).toBe(0);
    // Expire the human turn, let the world settle, ride the banners into the CPU turn.
    controller.advanceRoundClock(GAME_CONFIG.turnMs + 1);
    tickUntil(controller, 'TurnEnd');
    tickUntil(controller, 'Active', IDLE, 400);
    expect(controller.stepsRemaining()).toBe(MOVE.stepsPerTurn);
  });
});

describe('controller: selectWeapon', () => {
  it('selects a weapon with ammo by id and ignores an empty or unknown one', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('grenade');
    expect(controller.selectedWeapon()).toBe('grenade');
    controller.selectWeapon('sonic_blast');
    expect(controller.selectedWeapon()).toBe('sonic_blast');
    // The minigun is crate only and starts at 0 ammo, so the pick is refused and the selection holds.
    controller.selectWeapon('minigun');
    expect(controller.selectedWeapon()).toBe('sonic_blast');
  });

  it('refuses a stocked weapon whose scheme delay has not elapsed, like the panel does', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const delayed = WEAPON_IDS.find((id) => (WEAPONS[id].delayTurns ?? 0) > controller.state().turn);
    if (delayed === undefined) throw new Error('expected a delayed weapon in the roster (the jetpack has delayTurns 2)');
    expect(activeWormOf(controller.state())?.ammo[delayed]).not.toBe(0);
    controller.selectWeapon(delayed);
    expect(controller.selectedWeapon()).toBe('bazooka');
  });
});
