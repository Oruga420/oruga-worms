import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput, type GameEvent } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { spawnCrate } from '@/sim/crate.ts';
import type { CrateKind } from '@/sim/types.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * Power orbs: a crate that falls glowing out of the sky and recharges a super. The ledger rolls
 * what it gives; the controller reads the prize back and tells the presentation, so the callout
 * over the worm (+1 KAMEHAMEHA!) says exactly what the rules handed out.
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

/** A match whose first worm has already spent its Kamehameha, ticked into its turn. */
function spentKamehameha(): Controller {
  const game = quickGame(11, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value;
  const firstId = activeWormOf(base.state)?.id;
  const teams = base.state.teams.map((team) => ({ ...team, worms: team.worms.map((w) => (w.id === firstId ? { ...w, ammo: { ...w.ammo, kamehameha: 0 } } : w)) }));
  const controller = createController({ ...base, state: { ...base.state, teams } }, { cpu: { client: null, registry: WEAPONS } });
  for (let i = 0; i < 400 && controller.state().phase !== 'Active'; i += 1) controller.tick(IDLE);
  expect(controller.state().phase).toBe('Active');
  controller.drainEvents();
  return controller;
}

/** Drops a crate of the kind right on the active worm, landed, and ticks until it is taken. */
function takeCrate(controller: Controller, kind: CrateKind): GameEvent[] {
  const active = activeWormOf(controller.state());
  const body = controller.world().worms.find((w) => w.id === active?.id);
  if (active === undefined || body === undefined) throw new Error('no active worm');
  const crate = spawnCrate(controller.world(), kind, body.x);
  crate.y = body.y;
  crate.landed = true;
  crate.counted = true;
  const events: GameEvent[] = [];
  for (let i = 0; i < 10 && crate.alive; i += 1) {
    controller.tick(IDLE);
    events.push(...controller.drainEvents());
  }
  expect(crate.alive).toBe(false);
  return events;
}

describe('controller: power orbs recharge a super', () => {
  it('gives back the spent Kamehameha and says so over the worm, with the choir', () => {
    const controller = spentKamehameha();
    const wormId = activeWormOf(controller.state())?.id ?? '';
    const events = takeCrate(controller, 'power');
    expect(activeWormOf(controller.state())?.ammo.kamehameha).toBe(1);
    const opened = events.filter((e) => e.type === 'crateOpened');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ type: 'crateOpened', wormId, crate: 'power', weapon: 'kamehameha', healed: 0 });
    const body = controller.world().worms.find((w) => w.id === wormId);
    // Over the worm's head, where the callout rises from.
    expect(opened[0]?.y).toBeLessThan(body?.y ?? 0);
    expect(events.some((e) => e.type === 'sound' && e.id === 'wpn_holy_choir')).toBe(true);
  });

  it('a health crate reports what it healed, with no weapon', () => {
    const controller = spentKamehameha();
    const before = activeWormOf(controller.state())?.hp ?? 0;
    const events = takeCrate(controller, 'health');
    const opened = events.find((e) => e.type === 'crateOpened');
    expect(opened).toMatchObject({ crate: 'health', weapon: null, healed: 25 });
    expect(activeWormOf(controller.state())?.hp).toBe(before + 25);
  });

  it('a weapon crate names the weapon it gave', () => {
    const controller = spentKamehameha();
    const events = takeCrate(controller, 'weapon');
    const opened = events.find((e) => e.type === 'crateOpened');
    expect(opened?.type).toBe('crateOpened');
    if (opened?.type !== 'crateOpened') return;
    expect(opened.weapon).not.toBeNull();
    // A weapon crate never hands out a super: that is what the orb is for.
    expect(opened.weapon === null ? 0 : WEAPONS[opened.weapon].crateWeight).toBeGreaterThan(0);
  });
});
