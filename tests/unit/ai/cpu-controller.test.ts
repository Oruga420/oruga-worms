import { describe, expect, it } from 'vitest';
import type { CpuBackend } from '@/ai/contract.ts';
import type { CpuClient, HealthInfo } from '@/ai/client.ts';
import { createCpuState, decideCpuTurn, type CpuControllerOptions } from '@/ai/cpu-controller.ts';
import { buildCpuRequest, type SnapshotInput } from '@/ai/snapshot.ts';
import { createMask, setSpan, SOLID } from '@/terrain/mask.ts';
import { GRAVITY_PX_PER_S2 } from '@/sim/constants.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';

function mask(width = 1000, height = 400, floorY = 300) {
  const m = createMask(width, height);
  for (let y = floorY; y < height; y += 1) setSpan(m, y, 0, width - 1, SOLID);
  return m;
}

function snapshot(): SnapshotInput {
  return {
    matchId: 'm',
    turn: 4,
    difficulty: 'normal',
    personality: 'sniper',
    windStep: 2,
    windFraction: 0.24,
    gravity: GRAVITY_PX_PER_S2,
    waterY: 390,
    mask: mask(),
    activeWormId: 'r1',
    activeTeamId: 'red',
    worms: [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 500, y: 299, hp: 100, alive: true },
    ],
    ammo: [{ weapon: 'bazooka' as WeaponId, count: -1 }],
    canMoveLeft: true,
    canMoveRight: true,
    walkBudgetPx: 320,
  };
}

function fakeClient(health: HealthInfo, turn: unknown | null): CpuClient {
  return {
    health: () => Promise.resolve(health),
    requestTurn: () => Promise.resolve(turn),
  };
}

const registry = WEAPONS;

describe('buildCpuRequest', () => {
  it('splits allies and enemies, samples the terrain and computes line of sight', () => {
    const request = buildCpuRequest(snapshot());
    expect(request.active.wormId).toBe('r1');
    expect(request.enemies.map((e) => e.id)).toEqual(['b1']);
    expect(request.allies).toHaveLength(0);
    expect(request.terrain.profile.length).toBeGreaterThan(0);
    expect(request.lineOfSight[0]?.targetWormId).toBe('b1');
    expect(request.ammo).toHaveLength(1);
  });
});

describe('decideCpuTurn', () => {
  const options = (client: CpuClient | null): CpuControllerOptions => ({ client, registry });

  it('uses the heuristic when there is no client', async () => {
    const decision = await decideCpuTurn(snapshot(), options(null), createCpuState());
    expect(decision.source).toBe('heuristic');
    expect(decision.response.weapon).toBe('bazooka');
  });

  it('uses the heuristic when the backend is off', async () => {
    const client = fakeClient({ available: true, backend: 'off' as CpuBackend }, null);
    const decision = await decideCpuTurn(snapshot(), options(client), createCpuState());
    expect(decision.source).toBe('heuristic');
  });

  it('uses a valid model answer when the backend is available', async () => {
    const model = { schema: 'cpu-turn/2', weapon: 'bazooka', aimAngleDeg: 12, power: 90, facing: 'right', move: { direction: 'none', durationMs: 0 }, taunt: 'You are done.', confidence: 0.9, reasoning: 'clear shot' };
    const client = fakeClient({ available: true, backend: 'api' }, model);
    const decision = await decideCpuTurn(snapshot(), options(client), createCpuState());
    expect(decision.source).toBe('model');
    expect(decision.response.aimAngleDeg).toBe(12);
    expect(decision.response.power).toBe(90);
  });

  it('falls back to the heuristic when the model answer is rejected', async () => {
    const bad = { schema: 'cpu-turn/2', weapon: 'nuke', aimAngleDeg: 0, power: 50, facing: 'right', move: { direction: 'none', durationMs: 0 }, taunt: '', confidence: 0.9, reasoning: '' };
    const client = fakeClient({ available: true, backend: 'api' }, bad);
    const decision = await decideCpuTurn(snapshot(), options(client), createCpuState());
    expect(decision.source).toBe('heuristic');
  });

  it('falls back when the model returns null (timeout or fallback)', async () => {
    const client = fakeClient({ available: true, backend: 'api' }, null);
    const decision = await decideCpuTurn(snapshot(), options(client), createCpuState());
    expect(decision.source).toBe('heuristic');
  });

  it('probes the backend only once per match', async () => {
    let probes = 0;
    const client: CpuClient = {
      health: () => {
        probes += 1;
        return Promise.resolve({ available: false, backend: null });
      },
      requestTurn: () => Promise.resolve(null),
    };
    const state = createCpuState();
    await decideCpuTurn(snapshot(), options(client), state);
    await decideCpuTurn(snapshot(), options(client), state);
    expect(probes).toBe(1);
  });
});
