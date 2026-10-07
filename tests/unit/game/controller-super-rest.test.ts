import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeWormOf } from '@/match/ledger.ts';
import type { MatchState } from '@/match/state.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';
import { pastDelays } from '../match/past-delays.ts';

/**
 * The rest between a worm's supers at the controller: a super used, its team mates pick what they
 * like, on the worm's own next turn no super can be picked (and its spent super is let go of), and
 * the turn after that they are open to it again.
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

/** Two human teams of three, past every super's scheme delay, into the first Active. */
function makeController(): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value.state;
  const state: MatchState = pastDelays({ ...base, turn: 8, teams: base.teams.map((team) => ({ ...team, controller: 'human' as const })) }, 8);
  const controller = createController({ ...game.value, state }, { cpu: { client: null, registry: WEAPONS } });
  playUntil(controller, () => controller.state().phase === 'Active');
  return controller;
}

function playUntil(controller: Controller, done: () => boolean, cap = 6000): void {
  for (let i = 0; i < cap && !done(); i += 1) {
    controller.tick(IDLE);
    controller.drainEvents();
  }
}

/** Runs the active turn's clock out and plays on to the next Active. */
function endTurn(controller: Controller): void {
  const turn = controller.state().turn;
  controller.advanceRoundClock(60_000);
  playUntil(controller, () => controller.state().phase === 'Active' && controller.state().turn > turn);
}

/** Plays until the given worm is up and Active. */
function untilWorm(controller: Controller, wormId: string): void {
  for (let i = 0; i < 12 && activeWormOf(controller.state())?.id !== wormId; i += 1) endTurn(controller);
  expect(activeWormOf(controller.state())?.id).toBe(wormId);
}

function fire(controller: Controller, weapon: 'kamehameha' | 'saibaman'): void {
  controller.selectWeapon(weapon);
  expect(controller.selectedWeapon()).toBe(weapon);
  controller.tick({ ...IDLE, fireHeld: true });
  controller.tick({ ...IDLE, fireReleased: true });
  expect(controller.state().phase).toBe('Firing');
  playUntil(controller, () => controller.state().phase !== 'Firing');
}

describe('controller: the rest between a worm\'s supers', () => {
  it('lets no super be picked on the worm\'s next turn, while its team mates pick what they like, and opens them on the turn after', () => {
    const controller = makeController();
    const first = activeWormOf(controller.state())?.id ?? '';
    fire(controller, 'kamehameha');
    expect(activeWormOf(controller.state())?.superRest).toBe(2);

    // A team mate is up next for the team: every super is open to it.
    endTurn(controller);
    endTurn(controller);
    const mate = activeWormOf(controller.state())?.id ?? '';
    expect(mate).not.toBe(first);
    expect(mate.split('-worm-')[0]).toBe(first.split('-worm-')[0]);
    controller.selectWeapon('kamehameha');
    expect(controller.selectedWeapon()).toBe('kamehameha');

    // The worm's own next turn: its spent Kamehameha is let go of, no super can be picked, the rest can.
    untilWorm(controller, first);
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('antares');
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('gear_five');
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('grenade');
    expect(controller.selectedWeapon()).toBe('grenade');

    // Its turn after that: open.
    endTurn(controller);
    untilWorm(controller, first);
    controller.selectWeapon('antares');
    expect(controller.selectedWeapon()).toBe('antares');
  });

  it('counts the seed as a super and keeps the count on the worm that planted it', () => {
    const controller = makeController();
    const first = activeWormOf(controller.state())?.id ?? '';
    fire(controller, 'saibaman');
    const worms = controller.state().teams.flatMap((team) => team.worms);
    expect(worms.find((worm) => worm.id === first)?.superRest).toBe(2);
    expect(worms.filter((worm) => worm.id !== first).every((worm) => worm.superRest === 0)).toBe(true);
  });
});
