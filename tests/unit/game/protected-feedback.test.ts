import { describe, expect, it } from 'vitest';
import { createController, type ControllerInput } from '@/game/controller.ts';
import { quickGame } from '@/game/setup.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

const IDLE: ControllerInput = { moveX: 0, jump: false, backflip: false, aimDelta: 0, fireHeld: false, fireReleased: false, thrust: false, selectedSlot: null, pointer: { x: 0, y: 0 }, pointerClicked: false };

function prepared(shield: number, immortal = 0) {
  const built = quickGame(7, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!built.ok) throw new Error(built.error.message);
  const victim = built.value.state.teams[1]?.worms[0];
  if (!victim) throw new Error('Missing victim');
  const state = { ...built.value.state, phase: 'Active' as const, teams: built.value.state.teams.map((team) => ({ ...team, worms: team.worms.map((worm) => worm.id === victim.id ? { ...worm, shieldDurability: shield, immortalityCharges: immortal } : worm) })) };
  const controller = createController({ ...built.value, state }, { cpu: { client: null, registry: WEAPONS } });
  const hit = (amount: number) => controller.world().events.push({ type: 'damage', wormId: victim.id, amount, sourceTeamId: state.teams[0]?.id ?? null, sourceWormId: state.teams[0]?.worms[0]?.id ?? null, cause: 'hit' });
  return { controller, hit, victimId: victim.id };
}

describe('protected hit feedback', () => {
  it('does not show blood or a damage number for a fully absorbed hit', () => {
    const { controller, hit, victimId } = prepared(100);
    hit(60);
    controller.tick(IDLE);
    expect(controller.drainEvents().filter((event) => event.type === 'damage' && event.wormId === victimId)).toEqual([]);
  });

  it('shows only actual health loss when two hits exhaust a shield in the same batch', () => {
    const { controller, hit, victimId } = prepared(100);
    hit(60);
    hit(70);
    controller.tick(IDLE);
    const hits = controller.drainEvents().filter((event) => event.type === 'damage' && event.wormId === victimId);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ amount: 30, lost: 30 });
  });

  it('shows99rather than100health lost when immortality saves a100HPworm', () => {
    const { controller, hit, victimId } = prepared(0, 3);
    hit(1000);
    controller.tick(IDLE);
    const hits = controller.drainEvents().filter((event) => event.type === 'damage' && event.wormId === victimId);
    expect(hits[0]).toMatchObject({ lost: 99 });
  });
});
