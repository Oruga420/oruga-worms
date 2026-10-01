import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput, type GameEvent } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import type { MatchState } from '@/match/state.ts';
import { findWorm } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * The price of the two supers that kill whatever they touch: Gear 5 and the Freezer cost the worm
 * that uses them 50 of its health as they start, or all it has left. A worm that pays with its
 * last health still finishes the move, and only then bursts; its turn ends with the move.
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

/** Past both supers' scheme delays, the opening worm at the given health. */
function makeController(ownHp = 100): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value.state;
  const first = activeWormOf(base)?.id;
  const teams = base.teams.map((team) => ({ ...team, worms: team.worms.map((worm) => (worm.id === first ? { ...worm, hp: ownHp } : worm)) }));
  const state: MatchState = { ...base, turn: 5, teams };
  const controller = createController({ ...game.value, state }, { cpu: { client: null, registry: WEAPONS } });
  for (let i = 0; i < 3000 && controller.state().phase !== 'Active'; i += 1) controller.tick(IDLE);
  return controller;
}

function hpOf(state: MatchState, wormId: string): number {
  for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
  throw new Error(`no worm ${wormId}`);
}

/** Parks the nearest enemy dx in front of the active worm, on flat cleared ground, in plain sight. */
function lineUp(controller: Controller, dx: number): { attackerId: string; victimId: string } {
  const state = controller.state();
  const active = activeWormOf(state);
  const team = activeTeamOf(state);
  if (active === undefined || team === undefined) throw new Error('no active worm');
  const world = controller.world();
  const attacker = findWorm(world, active.id);
  const victim = world.worms.find((b) => b.alive && b.teamId !== team.id);
  if (attacker === undefined || victim === undefined) throw new Error('bodies missing');
  victim.x = attacker.x + attacker.facing * dx;
  victim.y = attacker.y;
  victim.vx = 0;
  victim.vy = 0;
  const mask = world.terrain.mask;
  const lo = Math.round(Math.min(attacker.x, victim.x)) - 4;
  const hi = Math.round(Math.max(attacker.x, victim.x)) + 4;
  for (let x = lo; x <= hi; x += 1) for (let y = Math.round(attacker.y) - 30; y < Math.round(attacker.y) - 1; y += 1) mask.data[y * mask.width + x] = 0;
  return { attackerId: attacker.id, victimId: victim.id };
}

function fireSuper(controller: Controller, weapon: WeaponId): GameEvent[] {
  controller.selectWeapon(weapon);
  expect(controller.selectedWeapon()).toBe(weapon);
  for (let i = 0; i < 90; i += 1) controller.tick(IDLE);
  controller.drainEvents();
  controller.tick({ ...IDLE, fireHeld: true });
  controller.tick({ ...IDLE, fireReleased: true });
  return controller.drainEvents();
}

function playTo(controller: Controller, phase: string, sink: GameEvent[]): void {
  for (let i = 0; i < 4000 && controller.state().phase !== phase; i += 1) {
    controller.tick(IDLE);
    sink.push(...controller.drainEvents());
  }
}

describe('controller: the price of the one hit kills', () => {
  it('Gear 5 costs its eater 50 as it starts, with no points for anyone, and it still eats and retreats', () => {
    const controller = makeController();
    const { attackerId, victimId } = lineUp(controller, 40);
    const scoreBefore = activeTeamOf(controller.state())?.score;
    const fired = fireSuper(controller, 'gear_five');
    expect(hpOf(controller.state(), attackerId)).toBe(50);
    expect(fired.find((e) => e.type === 'toll')).toMatchObject({ wormId: attackerId, lost: 50, fatal: false });
    expect(controller.state().log.some((entry) => entry.kind === 'damage' && entry.text.includes('pays 50 for its super'))).toBe(true);
    const events: GameEvent[] = [];
    playTo(controller, 'TurnEnd', events);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    expect(hpOf(controller.state(), attackerId)).toBe(50);
    expect(controller.state().log.some((entry) => entry.kind === 'retreat')).toBe(true);
    // The price scores nothing: what the team earned came from the meal alone.
    const scoreAfter = controller.state().teams.find((t) => t.id === activeTeamOf(controller.state())?.id)?.score;
    expect(scoreAfter?.damageDealt).toBe((scoreBefore?.damageDealt ?? 0) + 100);
  });

  it('the Freezer takes all a worm with 30 left has: it finishes the move, then bursts, and the turn ends with it', () => {
    const controller = makeController(30);
    const { attackerId, victimId } = lineUp(controller, 70);
    const fired = fireSuper(controller, 'freezer');
    expect(hpOf(controller.state(), attackerId)).toBe(0);
    expect(fired.find((e) => e.type === 'toll')).toMatchObject({ wormId: attackerId, lost: 30, fatal: true });
    // Its last breath goes on the move: still Firing, still up, the light on its way.
    expect(controller.state().phase).toBe('Firing');
    expect(findWorm(controller.world(), attackerId)?.alive).toBe(true);
    const events: GameEvent[] = [];
    playTo(controller, 'TurnEnd', events);
    // The victim burst all the same...
    expect(hpOf(controller.state(), victimId)).toBe(0);
    expect(events.some((e) => e.type === 'hexBeat' && e.beat === 'burst')).toBe(true);
    // ...and only once the move was over did the worm that paid for it go too, once.
    const hexEnd = events.findIndex((e) => e.type === 'hexEnd');
    const ownGib = events.findIndex((e) => e.type === 'gib' && e.wormId === attackerId);
    expect(ownGib).toBeGreaterThan(hexEnd);
    expect(events.filter((e) => e.type === 'gib' && e.wormId === attackerId)).toHaveLength(1);
    // No retreat for a worm that gave its last health: the turn ended with the move.
    expect(controller.state().log.some((entry) => entry.kind === 'retreat')).toBe(false);
    expect(controller.state().log.some((entry) => entry.kind === 'turn.forfeit' && entry.text.includes('gave its last health'))).toBe(true);
    playTo(controller, 'TurnStart', events);
    const dead = controller.state().teams.flatMap((t) => t.worms).find((w) => w.id === attackerId);
    expect(dead?.alive).toBe(false);
  });

  it('the other supers cost nothing to use', () => {
    const controller = makeController();
    const { attackerId } = lineUp(controller, 40);
    const fired = fireSuper(controller, 'ryuko_ranbu');
    expect(fired.some((e) => e.type === 'toll')).toBe(false);
    expect(hpOf(controller.state(), attackerId)).toBe(100);
  });
});
