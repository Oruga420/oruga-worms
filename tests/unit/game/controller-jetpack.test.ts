import { describe, expect, it } from 'vitest';
import { createController, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { addWorm, findWorm } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from '../sim/fixture.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

const IDLE: ControllerInput = {
  moveX: 0, jump: false, backflip: false, aimDelta: 0,
  fireHeld: false, fireReleased: false, thrust: false,
  selectedSlot: null, pointer: { x: 0, y: 0 }, pointerClicked: false,
};

describe('controller: grounded jetpack activation', () => {
  it('waits for thrust, lifts and steers, then lands and relaunches using the same pack', () => {
    const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
    if (!game.ok) throw new Error(game.error.message);
    const world = flatWorld({ width: 1200, height: 500, floorY: 400, waterY: 480, wind: 0 });
    let x = 250;
    for (const team of game.value.state.teams) {
      for (const worm of team.worms) {
        addWorm(world, { id: worm.id, teamId: team.id, x, y: 399, facing: 1 });
        x += 100;
      }
    }
    const controller = createController({ ...game.value, world, terrain: world.terrain,
      state: { ...game.value.state, turn: 2 } }, { cpu: { client: null, registry: WEAPONS } });
    for (let i = 0; i < 1000 && controller.state().phase !== 'Active'; i += 1) controller.tick(IDLE);
    expect(controller.state().phase).toBe('Active');
    const active = activeWormOf(controller.state());
    const body = active === undefined ? undefined : findWorm(world, active.id);
    if (body === undefined || active === undefined) throw new Error('missing active worm');
    for (let i = 0; i < 30; i += 1) controller.tick(IDLE);
    expect(body.onGround).toBe(true);
    controller.selectWeapon('jetpack');
    expect(controller.selectedWeapon()).toBe('jetpack');
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    const fuel = body.fuelMs;
    const ammo = active.ammo.jetpack;
    expect(fuel).toBeGreaterThan(0);
    // Real players release Space before finding/holding Enter. Ground contact in this gap must
    // not silently remove the pack, as airborne-only simulation tests previously allowed.
    for (let i = 0; i < 45; i += 1) controller.tick(IDLE);
    expect(body.motion).toBe('jetpacking');
    expect(body.fuelMs).toBe(fuel);
    const groundY = body.y;
    const startX = body.x;
    const steps = controller.stepsRemaining();
    for (let i = 0; i < 45; i += 1) controller.tick({ ...IDLE, thrust: true, moveX: 1, jump: i === 0 });
    expect(body.y).toBeLessThan(groundY - 20);
    expect(body.x).toBeGreaterThan(startX + 10);
    expect(body.onGround).toBe(false);
    expect(body.fuelMs).toBeLessThan(fuel);
    expect(controller.stepsRemaining()).toBe(steps);
    for (let i = 0; i < 240 && !body.onGround; i += 1) controller.tick(IDLE);
    expect(body.onGround).toBe(true);
    expect(body.motion).toBe('jetpacking');
    for (let i = 0; i < 30; i += 1) controller.tick({ ...IDLE, thrust: true });
    expect(body.y).toBeLessThan(groundY - 10);
    expect(activeWormOf(controller.state())?.ammo.jetpack).toBe(ammo! - 1);
    expect(controller.state().phase).toBe('Active');
    for (let i = 0; i < 240 && !body.onGround; i += 1) controller.tick(IDLE);
    expect(body.onGround).toBe(true);
    const turn = controller.state().turn;
    controller.advanceRoundClock(60_000);
    for (let i = 0; i < 1000 && controller.state().turn === turn; i += 1) controller.tick(IDLE);
    expect(controller.state().turn).toBeGreaterThan(turn);
  });
});
