import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * skipTurn passes the active turn as the Skip Go does, spending none of the round clock, so the
 * browser harness can skip through a team's whole rotation without bringing sudden death on.
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

function makeController(): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const state = { ...game.value.state, teams: game.value.state.teams.map((team) => ({ ...team, controller: 'human' as const })) };
  return createController({ ...game.value, state }, { cpu: { client: null, registry: WEAPONS } });
}

function untilActive(controller: Controller, after: number): void {
  for (let i = 0; i < 6000 && !(controller.state().phase === 'Active' && controller.state().turn > after); i += 1) {
    controller.tick(IDLE);
    controller.drainEvents();
  }
}

describe('controller: skipTurn', () => {
  it('passes the active turn to the next worm without spending the round clock, and does nothing outside Active', () => {
    const controller = makeController();
    untilActive(controller, 0);
    const first = activeWormOf(controller.state())?.id;
    const roundBefore = controller.state().roundElapsedMs;
    controller.skipTurn();
    expect(controller.state().phase).not.toBe('Active');
    // Outside Active a second call is ignored.
    controller.skipTurn();
    untilActive(controller, 1);
    expect(controller.state().turn).toBe(2);
    expect(activeWormOf(controller.state())?.id).not.toBe(first);
    // The retreat, the hot seat and the banner ticked by, a few seconds, nothing like a 45 s turn.
    expect(controller.state().roundElapsedMs - roundBefore).toBeLessThan(15_000);
    expect(controller.state().suddenDeath).toBe(false);
    // Six skips bring the first worm back on its second own turn.
    for (let n = 0; n < 5; n += 1) {
      const turn = controller.state().turn;
      controller.skipTurn();
      untilActive(controller, turn);
    }
    expect(activeWormOf(controller.state())?.id).toBe(first);
    expect(activeWormOf(controller.state())?.turns).toBe(2);
    expect(controller.state().suddenDeath).toBe(false);
  });
});
