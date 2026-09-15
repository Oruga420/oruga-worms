import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * The reducer announces a crate at TurnEnd (state.crateDrop) and the game loop has to put a body in
 * the sim for it. Nothing did: every match logged "a crate is on its way" and no crate ever fell,
 * which also made the forced weapon crate every three shots inert.
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

function makeController(seed = 11): Controller {
  const game = quickGame(seed, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  return createController(game.value, { cpu: { client: null, registry: WEAPONS } });
}

describe('controller: announced crates fall into the world', () => {
  it('spawns exactly one crate body for an announcement and lets it land', () => {
    const controller = makeController();
    // Run turns until the reducer announces a drop (random roll or the forced weapon crate).
    let guard = 0;
    while (controller.state().crateDrop === null && guard < 20000) {
      controller.tick(IDLE);
      guard += 1;
      // End the human's turns at once so the match cycles quickly.
      if (controller.state().phase === 'Active') controller.advanceRoundClock(60_000);
    }
    expect(controller.state().crateDrop).not.toBeNull();
    const kind = controller.state().crateDrop;
    // One tick later the sim has the body, above the map and falling.
    controller.tick(IDLE);
    const crates = controller.world().crates.filter((c) => c.alive);
    expect(crates).toHaveLength(1);
    expect(crates[0]?.kind).toBe(kind);
    // Never a second one for the same announcement, however many ticks pass before it lands.
    for (let i = 0; i < 30; i += 1) controller.tick(IDLE);
    expect(controller.world().crates.filter((c) => c.alive)).toHaveLength(1);
    // It lands eventually and the reducer clears the announcement through CrateLanded.
    let landed = 0;
    while (controller.state().crateDrop !== null && landed < 3000) {
      controller.tick(IDLE);
      landed += 1;
      if (controller.state().phase === 'Active') controller.advanceRoundClock(60_000);
    }
    expect(controller.state().crateDrop).toBeNull();
    expect(controller.state().cratesOnMap).toBeGreaterThanOrEqual(1);
  });
});
