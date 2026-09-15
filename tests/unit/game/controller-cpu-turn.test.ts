import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { TICK_MS } from '@/config/units.ts';
import { createController, type Controller, type ControllerInput } from '@/game/controller.ts';
import { buildGame } from '@/game/setup.ts';
import { activeTeamOf } from '@/match/ledger.ts';
import type { MatchSetup } from '@/match/setup.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { PANEL_WEAPON_IDS, type WeaponId } from '@/weapons/types.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/**
 * A CPU turn must end shortly after its shot, whatever the weapon. Measured before the fix: a
 * shotgun or longbow turn ran the whole 45 s timer, because the controller reported "one barrel
 * left" on every shot, the reducer bounced back to Active, and the CPU had already thrown its plan
 * away. A completed CPU action must advance the turn without waiting for timeout.
 */

const WORLD = { w: 1200, h: 500 };
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

/** Human Reds against a CPU Blues team that owns exactly one weapon, with infinite ammo. */
function makeController(only: WeaponId, seed = 5): Controller {
  const ammo: Partial<Record<WeaponId, number>> = {};
  for (const id of PANEL_WEAPON_IDS) ammo[id] = id === only ? -1 : 0;
  const setup: MatchSetup = {
    seed,
    worldSize: WORLD,
    waterY: WORLD.h - 24,
    startingTeamIndex: 1,
    teams: [
      { name: 'Reds', colorIndex: 0, controller: 'human', wormNames: ['Rojo', 'Rita', 'Rex'] },
      { name: 'Blues', colorIndex: 1, controller: 'cpu', cpu: { difficulty: 'normal', personality: 'aggressive' }, wormNames: ['Azul', 'Ana', 'Ash'], ammo },
    ],
  };
  const game = buildGame({ setup, createContext: createFakeFactory().factory });
  if (!game.ok) throw new Error(game.error.message);
  return createController(game.value, { cpu: { client: null, registry: WEAPONS } });
}

/** Ticks until the CPU's turn is Active, then until TurnEnd; returns ticks spent in the turn and its log kinds. */
async function playCpuTurn(controller: Controller): Promise<{ ticks: number; retreatTicks: number; kinds: string[]; fired: WeaponId[] }> {
  let guard = 0;
  while (!(controller.state().phase === 'Active' && activeTeamOf(controller.state())?.controller === 'cpu') && guard < 3000) {
    controller.tick(IDLE);
    guard += 1;
  }
  expect(controller.state().phase).toBe('Active');
  const logStart = controller.state().log.length;
  let ticks = 0;
  let retreatTicks = 0;
  while (controller.state().phase !== 'TurnEnd' && ticks < 4000) {
    controller.tick(IDLE);
    ticks += 1;
    if (controller.state().phase === 'Retreat') retreatTicks += 1;
    // The CPU decision is a resolved promise; let the microtask land between ticks.
    if (ticks % 5 === 0) await Promise.resolve();
  }
  const entries = controller.state().log.slice(logStart);
  const fired = entries.filter((e) => e.kind === 'fire').map((e) => e.text.split(' fires ')[1] as WeaponId);
  return { ticks, retreatTicks, kinds: entries.map((e) => e.kind), fired };
}

describe('controller: the CPU turn ends after its shot', () => {
  it('a shotgun turn fires both barrels and ends through the retreat, far under the turn timer', async () => {
    const controller = makeController('shotgun');
    const turn = await playCpuTurn(controller);
    expect(turn.fired.filter((w) => w === 'shotgun')).toHaveLength(2);
    expect(turn.kinds).toContain('retreat');
    expect(turn.kinds).not.toContain('turn.timeout');
    expect(turn.ticks * TICK_MS).toBeLessThan(GAME_CONFIG.turnMs / 3);
  });

  it('a longbow turn, the other two shot weapon, behaves the same', async () => {
    const controller = makeController('longbow');
    const turn = await playCpuTurn(controller);
    expect(turn.fired.filter((w) => w === 'longbow')).toHaveLength(2);
    expect(turn.kinds).not.toContain('turn.timeout');
    expect(turn.ticks * TICK_MS).toBeLessThan(GAME_CONFIG.turnMs / 3);
  });

  it('a bazooka turn, the control, still ends in a few seconds', async () => {
    const controller = makeController('bazooka');
    const turn = await playCpuTurn(controller);
    expect(turn.fired).toHaveLength(1);
    expect(turn.kinds).not.toContain('turn.timeout');
    // The CPU does not walk in the retreat window, so it ends the window at once instead of
    // standing for the full retreat time (3 s of dead air before this).
    expect(turn.retreatTicks).toBeLessThanOrEqual(2);
    expect(turn.ticks * TICK_MS).toBeLessThan(GAME_CONFIG.turnMs / 3);
  });
});
