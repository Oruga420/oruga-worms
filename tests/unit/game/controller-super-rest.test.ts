import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeTeamOf } from '@/match/ledger.ts';
import type { MatchState } from '@/match/state.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * The rest between a team's supers at the controller: a super used, and on the team's next turn no
 * super can be picked, a remembered one is let go of, and the turn after that they are open again.
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

/** Two human teams, past every super's scheme delay, into the first Active. */
function makeController(): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value.state;
  const state: MatchState = { ...base, turn: 8, teams: base.teams.map((team) => ({ ...team, controller: 'human' as const })) };
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

/** Plays until the given team is up and Active. */
function untilTeam(controller: Controller, teamId: string): void {
  for (let i = 0; i < 6 && activeTeamOf(controller.state())?.id !== teamId; i += 1) endTurn(controller);
  expect(activeTeamOf(controller.state())?.id).toBe(teamId);
}

describe('controller: the rest between supers', () => {
  it('lets no super be picked on the turn after one, and opens them again on the turn after that', () => {
    const controller = makeController();
    const team = activeTeamOf(controller.state())?.id ?? '';
    // The seed is the quickest super to play out; picked and fired like any weapon.
    controller.selectWeapon('saibaman');
    expect(controller.selectedWeapon()).toBe('saibaman');
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    expect(controller.state().phase).toBe('Firing');
    playUntil(controller, () => controller.state().phase !== 'Firing');
    expect(controller.state().teams.find((t) => t.id === team)?.superRest).toBe(2);

    // The other team's turn, then back: the supers rest, the rest of the panel does not.
    endTurn(controller);
    untilTeam(controller, team);
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('kamehameha');
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('antares');
    expect(controller.selectedWeapon()).toBe('bazooka');
    controller.selectWeapon('grenade');
    expect(controller.selectedWeapon()).toBe('grenade');
    // A super fired anyway (a script) is refused by the ledger and the turn goes on.
    controller.selectWeapon('bazooka');
    const slotOf = (id: string): number => Object.keys(WEAPONS).indexOf(id);
    expect(slotOf('kamehameha')).toBeGreaterThan(0);

    // Round again: open.
    endTurn(controller);
    untilTeam(controller, team);
    controller.selectWeapon('kamehameha');
    expect(controller.selectedWeapon()).toBe('kamehameha');
  });

  it('lets go of a remembered super the team is resting when the worm comes up again', () => {
    const controller = makeController();
    const team = activeTeamOf(controller.state())?.id ?? '';
    // The first worm picks Antares and keeps it; a team mate fires the Kamehameha meanwhile.
    controller.selectWeapon('antares');
    expect(controller.selectedWeapon()).toBe('antares');
    endTurn(controller);
    untilTeam(controller, team);
    controller.selectWeapon('kamehameha');
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    playUntil(controller, () => controller.state().phase !== 'Firing');
    endTurn(controller);
    // The third worm's turn: resting. Then the first worm is up again, its Antares open.
    untilTeam(controller, team);
    expect(controller.selectedWeapon()).toBe('bazooka');
    endTurn(controller);
    untilTeam(controller, team);
    expect(controller.selectedWeapon()).toBe('antares');
  });
});
