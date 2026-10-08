import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput, type GameEvent } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import type { MatchState } from '@/match/state.ts';
import { findWorm } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';
import { pastDelays } from '../match/past-delays.ts';

/**
 * The Saibaman seed through the whole match flow: the shot stays open while the seed grows, the
 * Saibaman that leaps out joins the planter's team in the ledger with half a worm's health, and it
 * takes its own turn when its team's rotation comes round to it.
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

/** A quick game moved past the seed's scheme delay, so the opening human turn may plant one. */
function makeController(): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const state: MatchState = pastDelays({ ...game.value.state, turn: 3 }, 3);
  return createController({ ...game.value, state }, { cpu: { client: null, registry: WEAPONS } });
}

function tickUntil(controller: Controller, done: () => boolean, sink: GameEvent[] = [], cap = 4000): void {
  for (let ticks = 0; !done() && ticks < cap; ticks += 1) {
    controller.tick(IDLE);
    sink.push(...controller.drainEvents());
  }
}

/** Flattens a patch of ground under and in front of the active worm, so the seed always has somewhere to go. */
function flatten(controller: Controller): void {
  const active = activeWormOf(controller.state());
  const world = controller.world();
  const body = active === undefined ? undefined : findWorm(world, active.id);
  if (body === undefined) throw new Error('no active worm');
  const mask = world.terrain.mask;
  const floor = Math.round(body.y) + 1;
  for (let x = Math.round(body.x) - 40; x <= Math.round(body.x) + 40; x += 1) {
    for (let y = floor - 40; y < floor; y += 1) mask.data[y * mask.width + x] = 0;
    for (let y = floor; y < floor + 30; y += 1) mask.data[y * mask.width + x] = 1;
  }
}

function plant(controller: Controller): void {
  controller.selectWeapon('saibaman');
  expect(controller.selectedWeapon()).toBe('saibaman');
  controller.tick({ ...IDLE, fireHeld: true });
  controller.tick({ ...IDLE, fireReleased: true });
}

describe('controller: the saibaman seed', () => {
  it('holds the shot open while it grows, then the Saibaman joins the team with half a worm\'s health', () => {
    const controller = makeController();
    tickUntil(controller, () => controller.state().phase === 'Active');
    flatten(controller);
    const team = activeTeamOf(controller.state());
    if (team === undefined) throw new Error('no team');
    const rosterBefore = team.worms.length;
    plant(controller);
    expect(controller.state().phase).toBe('Firing');
    expect(controller.world().sprouts).toHaveLength(1);
    // A second in, the ground is still shaking and the reducer still waits for the shot to close.
    for (let i = 0; i < 60; i += 1) controller.tick(IDLE);
    expect(controller.state().phase).toBe('Firing');
    const events: GameEvent[] = [];
    tickUntil(controller, () => controller.state().phase !== 'Firing', events);
    expect(controller.state().phase).toBe('Retreat');
    const worms = controller.state().teams.find((t) => t.id === team.id)?.worms ?? [];
    expect(worms).toHaveLength(rosterBefore + 1);
    const saiba = worms.at(-1);
    expect(saiba).toMatchObject({ id: `${team.id}-saiba-1`, name: 'Saiba 1', hp: 50, maxHp: 50, alive: true });
    expect(saiba?.ammo.saibaman).toBe(0);
    const body = findWorm(controller.world(), saiba?.id ?? '');
    expect(body?.size).toBe(0.5);
    expect(body?.teamId).toBe(team.id);
    // The planter spent its seed; the presentation heard every beat.
    expect(activeWormOf(controller.state())?.ammo.saibaman).toBe(0);
    expect(events.filter((e) => e.type === 'sproutBeat').map((e) => (e.type === 'sproutBeat' ? e.beat : ''))).toEqual(['plant', 'crack', 'crack', 'crack', 'pop']);
    expect(events.some((e) => e.type === 'sproutEnd' && e.wormId === saiba?.id)).toBe(true);
  });

  it('gives the Saibaman a turn of its own when its team comes round to it', () => {
    const controller = makeController();
    tickUntil(controller, () => controller.state().phase === 'Active');
    flatten(controller);
    const teamId = activeTeamOf(controller.state())?.id ?? '';
    plant(controller);
    tickUntil(controller, () => controller.state().phase !== 'Firing');
    const saibaId = `${teamId}-saiba-1`;
    const seen: string[] = [];
    for (let turn = 0; turn < 12 && !seen.includes(saibaId); turn += 1) {
      tickUntil(controller, () => controller.state().phase === 'Active' || controller.state().phase === 'MatchEnd');
      if (controller.state().phase === 'MatchEnd') break;
      seen.push(activeWormOf(controller.state())?.id ?? '');
      controller.advanceRoundClock(60_000);
    }
    expect(seen).toContain(saibaId);
  });
});
