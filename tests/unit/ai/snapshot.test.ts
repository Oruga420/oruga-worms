import { describe, expect, it } from 'vitest';
import { buildCpuRequest, walkBudgetToMs, type SnapshotInput } from '@/ai/snapshot.ts';
import { CPU_TURN_SCHEMA } from '@/ai/contract.ts';
import { GRAVITY_PX_PER_S2 } from '@/sim/constants.ts';
import { createMask, setSpan, SOLID } from '@/terrain/mask.ts';
import type { WeaponId } from '@/weapons/types.ts';

function terrainMask() {
  const m = createMask(640, 300);
  for (let y = 200; y < 300; y += 1) setSpan(m, y, 0, 639, SOLID);
  // A wall between the active worm and enemy b2 so its line of sight is blocked.
  for (let y = 0; y < 300; y += 1) setSpan(m, y, 320, 324, SOLID);
  return m;
}

function snapshot(): SnapshotInput {
  return {
    matchId: 'match-9',
    turn: 5,
    difficulty: 'normal',
    personality: 'cautious',
    windStep: -4,
    windFraction: -0.476,
    gravity: GRAVITY_PX_PER_S2,
    waterY: 280,
    mask: terrainMask(),
    activeWormId: 'r1',
    activeTeamId: 'red',
    worms: [
      { id: 'r1', teamId: 'red', x: 100, y: 199, hp: 82, alive: true },
      { id: 'r2', teamId: 'red', x: 150, y: 199, hp: 40, alive: true },
      { id: 'b1', teamId: 'blue', x: 250, y: 199, hp: 100, alive: true },
      { id: 'b2', teamId: 'blue', x: 500, y: 199, hp: 100, alive: true },
      { id: 'b3', teamId: 'blue', x: 300, y: 199, hp: 0, alive: false },
    ],
    ammo: [
      { weapon: 'bazooka' as WeaponId, count: -1 },
      { weapon: 'banana_bomb' as WeaponId, count: 0 },
    ],
    canMoveLeft: false,
    canMoveRight: true,
    walkBudgetPx: 320,
  };
}

describe('buildCpuRequest', () => {
  it('produces a compact request with the schema, rounded numbers and the active worm', () => {
    const request = buildCpuRequest(snapshot());
    expect(request.schema).toBe(CPU_TURN_SCHEMA);
    expect(request.matchId).toBe('match-9');
    expect(request.wind).toBeCloseTo(-0.48, 2);
    expect(request.active).toMatchObject({ wormId: 'r1', team: 'red', hp: 82, canMoveLeft: false, canMoveRight: true });
    expect(Number.isInteger(request.active.x)).toBe(true);
  });

  it('tells the model the walk it can still afford, capped at the contract limit', () => {
    // 320 px at 60 px/s is 5333 ms, above the 3000 ms contract cap.
    expect(buildCpuRequest(snapshot()).active.maxWalkMs).toBe(3000);
    // 90 px is 1500 ms of walking.
    expect(buildCpuRequest({ ...snapshot(), walkBudgetPx: 90 }).active.maxWalkMs).toBe(1500);
    expect(buildCpuRequest({ ...snapshot(), walkBudgetPx: 0 }).active.maxWalkMs).toBe(0);
    expect(walkBudgetToMs(-5)).toBe(0);
    expect(walkBudgetToMs(Number.NaN)).toBe(0);
  });

  it('splits allies and living enemies and drops the dead and the empty ammo', () => {
    const request = buildCpuRequest(snapshot());
    expect(request.allies.map((a) => a.id)).toEqual(['r2']);
    expect(request.enemies.map((e) => e.id)).toEqual(['b1', 'b2']);
    expect(request.ammo.map((a) => a.weapon)).toEqual(['bazooka']);
  });

  it('reports line of sight per enemy: clear to the near one, blocked behind the wall', () => {
    const request = buildCpuRequest(snapshot());
    const toB1 = request.lineOfSight.find((l) => l.targetWormId === 'b1');
    const toB2 = request.lineOfSight.find((l) => l.targetWormId === 'b2');
    expect(toB1?.clear).toBe(true);
    expect(toB2?.clear).toBe(false);
    expect(toB1?.distancePx).toBeGreaterThan(0);
  });

  it('samples about 64 terrain heights', () => {
    const request = buildCpuRequest(snapshot());
    expect(request.terrain.profile.length).toBeGreaterThanOrEqual(60);
    expect(request.terrain.profile.length).toBeLessThanOrEqual(70);
    expect(request.terrain.sampleStepPx).toBeGreaterThan(0);
  });
});
