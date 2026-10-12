import { describe, expect, it } from 'vitest';
import { techniqueCinematic } from '@/game/cinematic.ts';
import { techniqueFocus } from '@/game/camera-target.ts';
import type { ClawsBody, ForceFieldBody, TimeStopBody } from '@/sim/types.ts';

const base = { id: 1, weaponId: 'test', attackerId: 'a', ownerTeamId: 'a', stageTicks: 20, holdX: 100, holdY: 200, facing: 1 as const, alive: true };
const timeStop: TimeStopBody = { ...base, kind: 'time_stop', stage: 'charge', applied: false, spec: { kind: 'time_stop', chargeMs: 600, recoverMs: 600, freezeTurns: 1 } };
const forceField: ForceFieldBody = { ...base, kind: 'force_field', stage: 'charge', applied: false, spec: { kind: 'force_field', chargeMs: 600, recoverMs: 600, durability: 100, ownTurns: 1 } };
const claws: ClawsBody = { ...base, kind: 'claws', stage: 'windup', struck: false, victimId: 'b', targetX: 150, targetY: 200, spec: { kind: 'claws', windupMs: 600, recoverMs: 600, rangePx: 90 } };

describe('new power camera dispatch', () => {
  it.each([timeStop, forceField, claws])('frames and lights $kind through charge and recovery', (body) => {
    const charging = techniqueCinematic(body);
    expect(charging.dim).toBeGreaterThan(0);
    expect(charging.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(techniqueFocus(body, []).x)).toBe(true);
    const recovery = techniqueCinematic({ ...body, stage: 'recover', stageTicks: 36 });
    expect(recovery.zoom).toBeCloseTo(1);
    expect(recovery.dim).toBeCloseTo(0);
  });

  it('frames the claw target after striking instead of looking away', () => {
    expect(techniqueFocus({ ...claws, stage: 'recover', struck: true }, [])).toEqual({ x: 150, y: 200 });
  });
});
