import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { spawnProjectile } from '@/sim/projectile.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * When a Resolving cap fires (8 s without activity, or the 45 s ceiling) the reducer records
 * settle.forceSettled and moves on. Nothing consumed that flag: a body still live at the cap
 * survived into the next turn. The controller now detonates live shells and sheep on the way into
 * TurnEnd.
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

function makeController(seed = 7): Controller {
  const game = quickGame(seed, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  return createController(game.value, { cpu: { client: null, registry: WEAPONS } });
}

function tickUntil(controller: Controller, phase: string, cap = 3000): void {
  let ticks = 0;
  while (controller.state().phase !== phase && ticks < cap) {
    controller.tick(IDLE);
    ticks += 1;
  }
  expect(controller.state().phase).toBe(phase);
}

describe('controller: a force settled turn leaves no live body behind', () => {
  it('detonates a shell that was still drifting when the absolute cap ended Resolving', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const world = controller.world();
    const spec = WEAPONS.bazooka.projectile;
    const blast = WEAPONS.bazooka.blast;
    if (spec === undefined || blast === undefined) throw new Error('bazooka spec missing');
    // A drifter: no gravity, a slow glide across the sky, a lifetime longer than the ceiling.
    const drifter = spawnProjectile(world, {
      weaponId: 'bazooka',
      ownerTeamId: null,
      ownerWormId: null,
      x: 100,
      y: 40,
      vx: 20,
      vy: 0,
      spec: { ...spec, maxLifetimeMs: 120_000 },
      blast,
      windAffected: false,
      gravityScale: 0,
    });
    // End the human turn through a real shot so the phase machine reaches Resolving.
    controller.tick({ ...IDLE, fireHeld: true });
    controller.tick({ ...IDLE, fireReleased: true });
    tickUntil(controller, 'Resolving');
    expect(drifter.alive).toBe(true);
    // The ceiling fires: the reducer force settles into TurnEnd.
    controller.advanceRoundClock(60_000);
    expect(controller.state().phase).toBe('TurnEnd');
    expect(controller.state().settle?.forceSettled).toBe(true);
    // One tick later the drifter is gone and nothing live is left in the world.
    controller.tick(IDLE);
    expect(drifter.alive).toBe(false);
    expect(controller.world().projectiles.filter((p) => p.alive)).toHaveLength(0);
    expect(controller.world().sheep.filter((s) => s.alive)).toHaveLength(0);
  });
});
