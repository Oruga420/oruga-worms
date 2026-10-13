import { describe, expect, it } from 'vitest';
import { createController, type Controller, type ControllerInput, type GameEvent } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { activeTeamOf, activeWormOf } from '@/match/ledger.ts';
import { findWorm } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { battleView } from '@/voice/battle.ts';
import { runTool, type GameApi } from '@/voice/tools.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

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

/** Ticks to the next human Active turn, collecting the events. */
function toHumanTurn(controller: Controller, events: GameEvent[] = []): void {
  for (let i = 0; i < 20_000; i += 1) {
    const state = controller.state();
    if (state.phase === 'Active' && activeTeamOf(state)?.controller === 'human') return;
    controller.tick(IDLE);
    events.push(...controller.drainEvents());
  }
  throw new Error('no human turn');
}

function run(controller: Controller, ticks: number, events: GameEvent[]): void {
  for (let i = 0; i < ticks; i += 1) {
    controller.tick(IDLE);
    events.push(...controller.drainEvents());
  }
}

const api = (controller: Controller): GameApi => ({ view: () => battleView(controller), command: (cmd) => controller.command(cmd), say: () => undefined, menu: () => false, screen: () => ({ screen: 'playing', buttons: [] }), press: () => ({ ok: false, text: '' }), clickMap: () => ({ ok: false, text: '' }), camera: () => ({ ok: false, text: '' }) });

describe('controller commands (voice, WebMCP)', () => {
  it('walks the steps it is told, counting each one', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const events: GameEvent[] = [];
    const before = controller.stepsRemaining();
    const result = controller.command({ kind: 'walk', dir: 1, steps: 3 });
    expect(result.ok).toBe(true);
    expect(controller.commandBusy()).toBe(true);
    run(controller, 400, events);
    expect(controller.commandBusy()).toBe(false);
    const counts = events.filter((e) => e.type === 'step').map((e) => (e.type === 'step' ? e.n : 0));
    // A wall can stop it early; every step it did take was counted in order.
    expect(counts).toEqual(counts.map((_, i) => i + 1));
    expect(counts.length).toBeLessThanOrEqual(3);
    expect(before - controller.stepsRemaining()).toBeGreaterThanOrEqual(counts.length);
  });

  it('refuses orders when it is not a human turn', () => {
    const controller = makeController();
    expect(controller.command({ kind: 'jump' }).ok).toBe(false);
  });

  it('picks another worm of the team before it has moved, not after', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const state = controller.state();
    const team = activeTeamOf(state);
    const up = activeWormOf(state);
    const other = team?.worms.find((w) => w.id !== up?.id && w.alive);
    if (team === undefined || up === undefined || other === undefined) throw new Error('no team');
    const picked = controller.command({ kind: 'select', wormId: other.id });
    expect(picked.ok).toBe(true);
    expect(activeWormOf(controller.state())?.id).toBe(other.id);
    expect(controller.drainEvents().some((e) => e.type === 'wormPicked')).toBe(true);
    // The worm gave its turn back; the picked one counts it.
    const after = activeTeamOf(controller.state());
    expect(after?.worms.find((w) => w.id === other.id)?.turns).toBe(other.turns + 1);
    expect(after?.worms.find((w) => w.id === up.id)?.turns).toBe(Math.max(0, up.turns - 1));
    // Once it has walked, the pick is closed.
    const events: GameEvent[] = [];
    controller.command({ kind: 'walk', dir: -1, steps: 2 });
    run(controller, 200, events);
    if (controller.stepsRemaining() < controller.stepsPerTurn()) {
      expect(controller.command({ kind: 'select', wormId: up.id }).ok).toBe(false);
    }
  });

  it('lets the AI calculate a bazooka shot, then fires it', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const result = controller.command({ kind: 'auto', weapon: 'bazooka', message: '¡Toma!' });
    expect(result.ok).toBe(true);
    const events = controller.drainEvents();
    const scan = events.find((e) => e.type === 'aiScan');
    expect(scan?.type === 'aiScan' && scan.message).toBe('¡Toma!');
    expect(scan?.type === 'aiScan' && scan.targets.length).toBeGreaterThan(0);
    // It calculates first: still Active for the calculating beats, then the shot leaves.
    const after: GameEvent[] = [];
    run(controller, 60, after);
    expect(controller.state().phase).toBe('Active');
    run(controller, 600, after);
    expect(after.some((e) => e.type === 'fired' && e.weapon === 'bazooka')).toBe(true);
  });

  it('queues orders given while one is running, in order', () => {
    const controller = makeController();
    toHumanTurn(controller);
    expect(controller.command({ kind: 'walk', dir: 1, steps: 1 }).ok).toBe(true);
    expect(controller.command({ kind: 'weapon', id: 'shotgun' }).ok).toBe(true);
    // The weapon change waits for the walk.
    expect(controller.selectedWeapon()).not.toBe('shotgun');
    expect(controller.command({ kind: 'aim', angleDeg: 10 }).ok).toBe(true);
    const events: GameEvent[] = [];
    run(controller, 300, events);
    expect(controller.selectedWeapon()).toBe('shotgun');
    expect(controller.aim().angleDeg).toBeCloseTo(10, 5);
  });

  it('a key pressed during a command takes the worm back', () => {
    const controller = makeController();
    toHumanTurn(controller);
    controller.command({ kind: 'walk', dir: 1, steps: 5 });
    controller.tick({ ...IDLE, moveX: -1 });
    expect(controller.commandBusy()).toBe(false);
  });

  it('sets off the sheep it fired when told to, and refuses with no sheep running', () => {
    const controller = makeController();
    toHumanTurn(controller);
    expect(controller.command({ kind: 'detonate' }).ok).toBe(false);
    expect(controller.command({ kind: 'weapon', id: 'sheep' }).ok).toBe(true);
    expect(controller.command({ kind: 'fire' }).ok).toBe(true);
    const events: GameEvent[] = [];
    for (let i = 0; i < 300 && !controller.world().sheep.some((s) => s.alive); i += 1) run(controller, 1, events);
    expect(controller.world().sheep.some((s) => s.alive)).toBe(true);
    run(controller, 20, events);
    const result = controller.command({ kind: 'detonate' });
    expect(result.ok).toBe(true);
    expect(controller.drainEvents().some((e) => e.type === 'detonateOrder')).toBe(true);
    run(controller, 5, events);
    expect(controller.world().sheep.some((s) => s.alive)).toBe(false);
  });

  it('refuses a super the worm cannot use yet, saying why', () => {
    const controller = makeController();
    toHumanTurn(controller);
    // The opening turn: the supers open on the worm's second own turn.
    const result = controller.command({ kind: 'weapon', id: 'kamehameha' });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/turn/);
  });
});

describe('voice tools over the controller', () => {
  it('reports the battle and walks by name of direction', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const tools = api(controller);
    const state = runTool(tools, 'get_battle_state');
    expect(state.ok).toBe(true);
    expect(state.text).toContain(activeWormOf(controller.state())?.name ?? '');
    expect(runTool(tools, 'walk', { direction: 'izquierda', steps: 2 }).ok).toBe(true);
  });

  it('picks the worm named in a call before acting', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const team = activeTeamOf(controller.state());
    const other = team?.worms.find((w) => w.id !== activeWormOf(controller.state())?.id);
    if (other === undefined) throw new Error('no other worm');
    const result = runTool(api(controller), 'aim', { angle: 20, worm: other.name.toLowerCase() });
    expect(result.ok).toBe(true);
    expect(activeWormOf(controller.state())?.id).toBe(other.id);
  });

  it('refuses a worm of the other team', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const enemy = controller.state().teams.find((t) => t.id !== activeTeamOf(controller.state())?.id)?.worms[0];
    if (enemy === undefined) throw new Error('no enemy');
    const result = runTool(api(controller), 'choose_worm', { worm: enemy.name });
    expect(result.ok).toBe(false);
  });

  it('turns a weapon said in Spanish into the weapon', () => {
    const controller = makeController();
    toHumanTurn(controller);
    expect(runTool(api(controller), 'select_weapon', { weapon: 'la escopeta' }).ok).toBe(true);
    expect(controller.selectedWeapon()).toBe('shotgun');
    expect(runTool(api(controller), 'select_weapon', { weapon: 'un tostador' }).ok).toBe(false);
  });

  it('keeps the active worm body in place for a refused order', () => {
    const controller = makeController();
    toHumanTurn(controller);
    const id = activeWormOf(controller.state())?.id ?? '';
    const x = findWorm(controller.world(), id)?.x;
    expect(runTool(api(controller), 'walk', { direction: 'arriba', steps: 2 }).ok).toBe(false);
    expect(findWorm(controller.world(), id)?.x).toBe(x);
  });
});
