import { describe, expect, it } from 'vitest';
import { CPU_TURN_SCHEMA } from '../../../src/ai/contract.ts';
import { LIMITS, validateCpuTurnRequest } from '../../../sidecar/validate-request.ts';

function base(): Record<string, unknown> {
  return {
    schema: CPU_TURN_SCHEMA,
    matchId: 'm-1',
    turn: 3,
    difficulty: 'normal',
    personality: 'cautious',
    windStep: 4,
    wind: 0.4,
    gravity: 900,
    waterY: 640,
    world: { w: 1920, h: 696 },
    active: { wormId: 'a1', team: 'Reds', x: 100, y: 200, hp: 100, canMoveLeft: true, canMoveRight: false },
    allies: [{ id: 'a2', team: 'Reds', x: 150, y: 210, hp: 80 }],
    enemies: [{ id: 'e1', team: 'Blues', x: 900, y: 300, hp: 100 }],
    ammo: [{ weapon: 'bazooka', count: -1 }, { weapon: 'grenade', count: 3 }],
    terrain: { profile: [400, 410, 420], sampleStepPx: 30 },
    lineOfSight: [{ targetWormId: 'e1', clear: true, distancePx: 806, bearingDeg: 7 }],
    lastTurnSummary: 'missed by 40px',
  };
}

describe('validateCpuTurnRequest', () => {
  it('defaults active.maxWalkMs to the contract cap when absent and keeps a legal value', () => {
    const absent = validateCpuTurnRequest(base());
    expect(absent.ok && absent.value.active.maxWalkMs).toBe(3000);
    const given = validateCpuTurnRequest({ ...base(), active: { ...(base()['active'] as object), maxWalkMs: 1200 } });
    expect(given.ok && given.value.active.maxWalkMs).toBe(1200);
  });

  it('rejects active.maxWalkMs outside [0, 3000] or non integer', () => {
    for (const bad of [5000, 1.5, -1, '900']) {
      const result = validateCpuTurnRequest({ ...base(), active: { ...(base()['active'] as object), maxWalkMs: bad } });
      expect(result.ok).toBe(false);
    }
  });

  it('accepts a well formed request and preserves its values', () => {
    const result = validateCpuTurnRequest(base());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.active.wormId).toBe('a1');
      expect(result.value.ammo[1]).toEqual({ weapon: 'grenade', count: 3 });
      expect(result.value.lastTurnSummary).toBe('missed by 40px');
    }
  });

  it('accepts a request without the optional summary and omits the key', () => {
    const body = base();
    delete body['lastTurnSummary'];
    const result = validateCpuTurnRequest(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect('lastTurnSummary' in result.value).toBe(false);
  });

  it('rejects non objects and the wrong schema', () => {
    expect(validateCpuTurnRequest(null).ok).toBe(false);
    expect(validateCpuTurnRequest('x').ok).toBe(false);
    const wrong = validateCpuTurnRequest({ ...base(), schema: 'cpu-turn/1' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain('schema');
  });

  it('enforces list caps', () => {
    const many = Array.from({ length: LIMITS.maxEnemies + 1 }, (_, i) => ({ id: `e${i}`, team: 'B', x: 0, y: 0, hp: 1 }));
    const result = validateCpuTurnRequest({ ...base(), enemies: many });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('enemies');
    const profile = Array.from({ length: LIMITS.maxProfileSamples + 1 }, () => 1);
    expect(validateCpuTurnRequest({ ...base(), terrain: { profile, sampleStepPx: 30 } }).ok).toBe(false);
  });

  it('rejects bad numbers, enums and booleans', () => {
    expect(validateCpuTurnRequest({ ...base(), turn: 1.5 }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), windStep: 11 }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), wind: 2 }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), gravity: Number.NaN }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), difficulty: 'insane' }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), personality: 'sleepy' }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), active: { ...(base()['active'] as object), canMoveLeft: 'yes' } }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), ammo: [{ weapon: 'bazooka', count: -2 }] }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), world: { w: 10, h: 10 } }).ok).toBe(false);
  });

  it('rejects an unknown ammo weapon id (the one field that reaches the prompt)', () => {
    expect(validateCpuTurnRequest({ ...base(), ammo: [{ weapon: 'not_a_real_weapon', count: 1 }] }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), ammo: [{ weapon: '<<<GAME_STATE_JSON', count: 1 }] }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), ammo: [{ weapon: 'grenade', count: 1 }] }).ok).toBe(true);
  });

  it('bounds string lengths', () => {
    expect(validateCpuTurnRequest({ ...base(), matchId: 'x'.repeat(LIMITS.maxStringChars + 1) }).ok).toBe(false);
    expect(validateCpuTurnRequest({ ...base(), lastTurnSummary: 'x'.repeat(LIMITS.maxSummaryChars + 1) }).ok).toBe(false);
  });
});
