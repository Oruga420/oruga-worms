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
 * The techniques of the anime row through the whole match flow: the shot stays open while they
 * play, Antares costs half of what its user has, and the Tesoro del Cielo takes the sealed team's
 * turns, a strike each that the caster pays 15 for, until the last one takes the sealed worm.
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

/** Past every technique's scheme delay, the opening (human) worm at the given health. */
function makeController(ownHp = 100): Controller {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const base = game.value.state;
  const first = activeWormOf(base)?.id;
  const teams = base.teams.map((team) => ({ ...team, worms: team.worms.map((worm) => (worm.id === first ? { ...worm, hp: ownHp } : worm)) }));
  const state: MatchState = { ...base, turn: 8, teams };
  const controller = createController({ ...game.value, state }, { cpu: { client: null, registry: WEAPONS } });
  for (let i = 0; i < 3000 && controller.state().phase !== 'Active'; i += 1) controller.tick(IDLE);
  return controller;
}

function hpOf(state: MatchState, wormId: string): number {
  for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
  throw new Error(`no worm ${wormId}`);
}

function aliveOf(state: MatchState, wormId: string): boolean {
  for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.alive;
  return false;
}

/** Parks the nearest enemy dx in front of the active worm, on flat cleared ground, in plain sight. */
function lineUp(controller: Controller, dx: number): { attackerId: string; victimId: string } {
  const state = controller.state();
  const active = activeWormOf(state);
  const team = activeTeamOf(state);
  if (active === undefined || team === undefined) throw new Error('no active worm');
  const world = controller.world();
  const attacker = findWorm(world, active.id);
  const victim = world.worms.filter((b) => b.alive && b.teamId !== team.id).sort((a, b) => Math.abs(a.x - (attacker?.x ?? 0)) - Math.abs(b.x - (attacker?.x ?? 0)))[0];
  if (attacker === undefined || victim === undefined) throw new Error('bodies missing');
  victim.x = attacker.x + attacker.facing * dx;
  victim.y = attacker.y;
  victim.vx = 0;
  victim.vy = 0;
  const mask = world.terrain.mask;
  const lo = Math.round(Math.min(attacker.x, victim.x)) - 6;
  const hi = Math.round(Math.max(attacker.x, victim.x)) + 6;
  for (let x = lo; x <= hi; x += 1) {
    for (let y = Math.round(attacker.y) - 60; y < Math.round(attacker.y) + 1; y += 1) mask.data[y * mask.width + x] = 0;
    for (let y = Math.round(attacker.y) + 1; y < Math.round(attacker.y) + 12; y += 1) mask.data[y * mask.width + x] = 1;
  }
  return { attackerId: attacker.id, victimId: victim.id };
}

function fireTechnique(controller: Controller, weapon: WeaponId): GameEvent[] {
  controller.selectWeapon(weapon);
  expect(controller.selectedWeapon()).toBe(weapon);
  // Level the aim: the opening aim is 45 degrees up, and it turns a degree a tick.
  for (let i = 0; i < 90 && controller.aim().angleDeg > 0; i += 1) controller.tick({ ...IDLE, aimDelta: -1 });
  controller.drainEvents();
  controller.tick({ ...IDLE, fireHeld: true });
  controller.tick({ ...IDLE, fireReleased: true });
  return controller.drainEvents();
}

function playUntil(controller: Controller, done: () => boolean, sink: GameEvent[] = [], cap = 6000): void {
  for (let i = 0; i < cap && !done(); i += 1) {
    controller.tick(IDLE);
    sink.push(...controller.drainEvents());
  }
}

describe('controller: Antares', () => {
  it('costs half of what its user has, keeps the shot open through the stings, and Antares takes the victim', () => {
    const controller = makeController(80);
    const { attackerId, victimId } = lineUp(controller, 90);
    const fired = fireTechnique(controller, 'antares');
    expect(fired.find((e) => e.type === 'toll')).toMatchObject({ wormId: attackerId, lost: 40, fatal: false });
    expect(hpOf(controller.state(), attackerId)).toBe(40);
    expect(controller.state().phase).toBe('Firing');
    const events: GameEvent[] = [];
    playUntil(controller, () => controller.state().phase === 'TurnEnd', events);
    expect(events.filter((e) => e.type === 'techniqueBeat' && e.beat === 'sting')).toHaveLength(14);
    expect(events.some((e) => e.type === 'techniqueBeat' && e.beat === 'antares')).toBe(true);
    expect(hpOf(controller.state(), victimId)).toBe(0);
    // Burst once, after Antares went in.
    expect(events.filter((e) => e.type === 'gib' && e.wormId === victimId)).toHaveLength(1);
    expect(hpOf(controller.state(), attackerId)).toBe(40);
  });
});

describe('controller: the Tesoro del Cielo', () => {
  it('seals the target, takes its team\'s next three turns with a strike each, 15 from the caster for each, and the third kills', () => {
    const controller = makeController(100);
    const { attackerId, victimId } = lineUp(controller, 120);
    const casterTeam = activeTeamOf(controller.state())?.id ?? '';
    fireTechnique(controller, 'tenbu_horin');
    const events: GameEvent[] = [];
    playUntil(controller, () => controller.state().phase !== 'Firing', events);
    expect(controller.state().seals).toHaveLength(1);
    expect(events.some((e) => e.type === 'techniqueBeat' && e.beat === 'seal')).toBe(true);
    const banners: string[] = [];
    const strikes: string[] = [];
    for (let turn = 0; turn < 12 && aliveOf(controller.state(), victimId); turn += 1) {
      playUntil(controller, () => controller.state().phase === 'TurnStart' || controller.state().phase === 'MatchEnd', events);
      if (controller.state().phase === 'MatchEnd') break;
      banners.push(controller.banner() ?? '');
      const sealedTurn = activeTeamOf(controller.state())?.id !== casterTeam;
      if (sealedTurn) {
        // The treasure's turn: no Active for the sealed team, the strike plays out while it resolves.
        const seen: GameEvent[] = [];
        playUntil(controller, () => controller.state().phase === 'TurnEnd', seen);
        expect(seen.some((e) => e.type === 'techniqueBeat' && (e.beat === 'sense' || e.beat === 'nirvana'))).toBe(true);
        strikes.push(...seen.flatMap((e) => (e.type === 'techniqueBeat' && (e.beat === 'sense' || e.beat === 'nirvana') ? [`${e.beat}${e.n}`] : [])));
        events.push(...seen);
      } else {
        // The caster's team: let the clock run its turn out.
        playUntil(controller, () => controller.state().phase === 'Active');
        controller.advanceRoundClock(60_000);
      }
    }
    expect(strikes).toEqual(['sense1', 'sense2', 'nirvana3']);
    expect(aliveOf(controller.state(), victimId)).toBe(false);
    expect(hpOf(controller.state(), attackerId)).toBe(100 - 45);
    expect(banners.some((b) => b.includes('SIN SENTIDOS'))).toBe(true);
    expect(controller.state().seals).toEqual([]);
  });
});
