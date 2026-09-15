import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import type { MatchState } from '@/match/state.ts';
import { WORM_HEIGHT } from '@/sim/constants.ts';
import { findWorm } from '@/sim/world.ts';
import { carve } from '@/terrain/terrain.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * The controller is the only place where what fire() emits becomes hp in the ledger. These tests
 * exist because the suite was green while every gun and punch did zero damage: the weapon tests
 * asserted the damage EVENT existed and nothing asserted the controller turned it into hp.
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

function tickUntil(controller: Controller, phase: string, input: ControllerInput = IDLE, cap = 3000): number {
  let ticks = 0;
  while (controller.state().phase !== phase && ticks < cap) {
    controller.tick(input);
    ticks += 1;
  }
  return ticks;
}

function hpOf(state: MatchState, wormId: string): number {
  for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
  throw new Error(`no worm ${wormId}`);
}

/** Re-pins the enemy body in front of the shooter; set by lineUpEnemy, called before every fire tick. */
let pinEnemy: (() => void) | null = null;

/**
 * Levels the aim, then parks the first enemy body point blank in front of the active worm. The
 * island is random: the spot in front of the shooter may be a slope, and a body left there slides
 * away while ticks pass (measured: 107 px in the time the aim takes to level). So the aim is
 * levelled FIRST and the enemy is pinned again right before each fire tick.
 */
function lineUpEnemy(controller: Controller): { shooterId: string; enemyId: string } {
  const state = controller.state();
  const active = activeWormOf(state);
  const team = activeTeamOf(state);
  if (active === undefined || team === undefined) throw new Error('no active worm');
  const world = controller.world();
  const shooter = findWorm(world, active.id);
  const enemy = world.worms.find((b) => b.alive && b.teamId !== team.id);
  if (shooter === undefined || enemy === undefined) throw new Error('bodies missing');
  // Aim level so a straight ray crosses the enemy's torso.
  while (controller.aim().angleDeg > 0.5) controller.tick({ ...IDLE, aimDelta: -1 });
  while (controller.aim().angleDeg < -0.5) controller.tick({ ...IDLE, aimDelta: 1 });
  // Clear the ray at chest height between the muzzle and the enemy: small holes well above the
  // feet, the ground under both worms is untouched.
  const chestY = shooter.y - WORM_HEIGHT * 0.6;
  for (const dx of [8, 14, 20]) carve(world.terrain, Math.round(shooter.x + shooter.facing * dx), Math.round(chestY), 5);
  pinEnemy = () => {
    enemy.x = shooter.x + shooter.facing * 22;
    enemy.y = shooter.y;
    enemy.vx = 0;
    enemy.vy = 0;
    enemy.motion = 'idle';
    enemy.onGround = true;
  };
  pinEnemy();
  return { shooterId: shooter.id, enemyId: enemy.id };
}

function select(controller: Controller, weapon: WeaponId): void {
  controller.tick({ ...IDLE, selectedSlot: WEAPON_IDS.indexOf(weapon) + 1 });
  expect(controller.selectedWeapon()).toBe(weapon);
}

function fireOnce(controller: Controller): void {
  pinEnemy?.();
  controller.tick({ ...IDLE, fireHeld: true });
  pinEnemy?.();
  controller.tick({ ...IDLE, fireReleased: true });
}

describe('controller: fire time damage reaches the ledger', () => {
  it.each([
    ['shotgun', 25],
    ['handgun', 5],
    ['uzi', 5],
  ] as const)('%s takes %i hp off a point blank enemy', (weapon, perHit) => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const { enemyId } = lineUpEnemy(controller);
    const before = hpOf(controller.state(), enemyId);
    select(controller, weapon);
    fireOnce(controller);
    tickUntil(controller, 'TurnEnd');
    const after = hpOf(controller.state(), enemyId);
    // A burst weapon lands several rounds; the shotgun lands one barrel here. Either way the enemy
    // is hurt by at least one hit, which was never true before the fire time drain was fixed.
    expect(before - after).toBeGreaterThanOrEqual(perHit);
  });

  it('a melee hit books its full damage in the log', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    lineUpEnemy(controller);
    select(controller, 'fire_punch');
    fireOnce(controller);
    tickUntil(controller, 'TurnEnd');
    const melee = WEAPONS.fire_punch.melee;
    if (melee === undefined) throw new Error('fire punch has no melee spec');
    const hits = controller.state().log.filter((entry) => entry.kind === 'damage' && entry.text.includes(`takes ${melee.damage}`));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('a bazooka blast still takes hp off, the explosion path is the regression guard', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const { enemyId } = lineUpEnemy(controller);
    const before = hpOf(controller.state(), enemyId);
    select(controller, 'bazooka');
    fireOnce(controller);
    tickUntil(controller, 'TurnEnd');
    expect(hpOf(controller.state(), enemyId)).toBeLessThan(before);
  });
});

describe('controller: multi shot weapons count their barrels', () => {
  it('a human shotgun turn ends through the retreat after the second barrel, not the clock', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    lineUpEnemy(controller);
    select(controller, 'shotgun');
    fireOnce(controller);
    // First barrel: the reducer comes back to Active with one shot owed.
    expect(controller.state().phase).toBe('Active');
    expect(controller.state().shot?.shotsRemaining).toBe(1);
    fireOnce(controller);
    // Second barrel: no shot owed, so the phase leaves Active for the retreat window.
    expect(controller.state().phase).not.toBe('Active');
    const ticks = tickUntil(controller, 'TurnEnd');
    expect(ticks).toBeLessThan(600);
    const kinds = controller.state().log.map((entry) => entry.kind);
    expect(kinds.filter((k) => k === 'fire')).toHaveLength(2);
    expect(kinds).toContain('retreat');
    expect(kinds).not.toContain('turn.timeout');
  });

  it('a gun burst fires its rounds over several ticks and then closes the shot', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    lineUpEnemy(controller);
    select(controller, 'uzi');
    const burst = WEAPONS.uzi.hitscan;
    if (burst === undefined) throw new Error('uzi has no hitscan spec');
    fireOnce(controller);
    // Still firing right after the trigger: the remaining rounds are queued.
    expect(controller.state().phase).toBe('Firing');
    let ticks = 0;
    while (controller.state().phase === 'Firing' && ticks < 600) {
      controller.tick(IDLE);
      ticks += 1;
    }
    // Rounds are spaced by the burst interval, so the shot stays open for about that long.
    expect(ticks).toBeGreaterThanOrEqual(burst.burstCount - 1);
    expect(controller.state().phase).not.toBe('Firing');
    tickUntil(controller, 'TurnEnd');
    expect(controller.state().log.map((e) => e.kind)).not.toContain('turn.timeout');
  });
});

describe('controller: the selected weapon belongs to each worm', () => {
  it('a pick stays out of the other team and the next teammate inventory', () => {
    const controller = makeController();
    tickUntil(controller, 'Active');
    const reds = activeTeamOf(controller.state())?.id;
    select(controller, 'shotgun');
    // Reds' turn runs out; Blues (CPU) play with their own default selection.
    controller.advanceRoundClock(60_000);
    let guard = 0;
    while (!(controller.state().phase === 'Active' && activeTeamOf(controller.state())?.id !== reds) && guard < 3000) {
      controller.tick(IDLE);
      guard += 1;
    }
    expect(activeTeamOf(controller.state())?.id).not.toBe(reds);
    expect(controller.selectedWeapon()).toBe('bazooka');
    // Back to Reds: the shotgun is still what they had picked.
    controller.advanceRoundClock(60_000);
    guard = 0;
    while (!(controller.state().phase === 'Active' && activeTeamOf(controller.state())?.id === reds) && guard < 6000) {
      controller.tick(IDLE);
      guard += 1;
    }
    expect(activeTeamOf(controller.state())?.id).toBe(reds);
    expect(controller.selectedWeapon()).toBe('bazooka');
  });
});


it('remembers a legal personal fuse and ignores unsupported settings', () => {
  const controller = makeController();
  tickUntil(controller, 'Active');
  controller.selectWeapon('grenade');
  controller.tick({ ...IDLE, fuse: 5 });
  expect(controller.selectedFuseMs()).toBe(5000);
  controller.tick({ ...IDLE, fuse: 9 });
  expect(controller.selectedFuseMs()).toBe(5000);
  controller.selectWeapon('bazooka');
  expect(controller.selectedFuseMs()).toBeNull();
  controller.selectWeapon('grenade');
  expect(controller.selectedFuseMs()).toBe(5000);
});


it('restores a worm selection when rotation returns to that same worm', () => {
  const game = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const controller = createController({ ...game.value, state: { ...game.value.state, teams: game.value.state.teams.map((team) => ({ ...team, controller: 'human' as const })) } }, { cpu: { client: null, registry: WEAPONS } });
  tickUntil(controller, 'Active');
  const first = activeWormOf(controller.state())?.id;
  controller.selectWeapon('shotgun');
  let returned = false;
  for (let turns = 0; turns < 16; turns += 1) {
    controller.advanceRoundClock(60_000);
    tickUntil(controller, 'Active');
    if (activeWormOf(controller.state())?.id === first) {
      expect(controller.selectedWeapon()).toBe('shotgun');
      returned = true;
      break;
    }
    expect(controller.selectedWeapon()).toBe('bazooka');
  }
  expect(returned).toBe(true);
});
