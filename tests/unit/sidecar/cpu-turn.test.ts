import { describe, expect, it } from 'vitest';
import { CPU_TURN_SCHEMA } from '../../../src/ai/contract.ts';
import { err, ok } from '../../../src/core/result.ts';
import type { ApiDecision } from '../../../sidecar/backends/api.ts';
import { decideCpuTurn, type CpuTurnDeps, type TurnRequester } from '../../../sidecar/cpu-turn.ts';
import { createMatchBudget } from '../../../sidecar/rate-limit.ts';

function body(): Record<string, unknown> {
  return {
    schema: CPU_TURN_SCHEMA,
    matchId: 'match-1',
    turn: 2,
    difficulty: 'normal',
    personality: 'aggressive',
    windStep: 2,
    wind: 0.2,
    gravity: 900,
    waterY: 640,
    world: { w: 1920, h: 696 },
    active: { wormId: 'a1', team: 'Reds', x: 600, y: 400, hp: 90, canMoveLeft: true, canMoveRight: true },
    allies: [],
    enemies: [{ id: 'e1', team: 'Blues', x: 1200, y: 400, hp: 100 }],
    ammo: [{ weapon: 'bazooka', count: -1 }, { weapon: 'grenade', count: 2 }, { weapon: 'air_strike', count: 1 }],
    terrain: { profile: [400, 420], sampleStepPx: 30 },
    lineOfSight: [{ targetWormId: 'e1', clear: true, distancePx: 600, bearingDeg: 0 }],
  };
}

function decision(raw: unknown): ApiDecision {
  return { raw, model: 'fake', durationMs: 5, inputTokens: 10, outputTokens: 5, costUsd: 0.0001, stopReason: 'end_turn' };
}

const goodRaw = {
  weapon: 'grenade',
  aimAngleDeg: 40,
  power: 65,
  facing: 'right',
  move: { direction: 'none', durationMs: 0 },
  fuseMs: 3000,
  targetPoint: null,
  taunt: 'Catch!',
  confidence: 0.8,
  reasoning: 'lob it',
};

function deps(overrides: Partial<CpuTurnDeps> = {}): CpuTurnDeps {
  const requester: TurnRequester = () => Promise.resolve(ok(decision(goodRaw)));
  return { backend: 'api', llmEnabled: true, budget: createMatchBudget(5), requestViaApi: requester, log: () => undefined, ...overrides };
}

describe('decideCpuTurn', () => {
  it('returns a sanitized 200 response for a good decision', async () => {
    const result = await decideCpuTurn(body(), deps());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ weapon: 'grenade', aimAngleDeg: 40, power: 65, fuseMs: 3000, taunt: 'Catch!' });
  });

  it('rejects an invalid body with 400 before touching any backend', async () => {
    let called = false;
    const result = await decideCpuTurn({ schema: 'nope' }, deps({ requestViaApi: () => { called = true; return Promise.resolve(ok(decision(goodRaw))); } }));
    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  it('falls back with 503 when the kill switch is off, the backend is off, or the api key is missing', async () => {
    expect((await decideCpuTurn(body(), deps({ llmEnabled: false }))).status).toBe(503);
    expect((await decideCpuTurn(body(), deps({ backend: 'off' }))).status).toBe(503);
    const noKey = await decideCpuTurn(body(), { backend: 'api', llmEnabled: true, budget: createMatchBudget(5) });
    expect(noKey.status).toBe(503);
    expect(noKey.body).toMatchObject({ fallback: true });
  });

  it('charges the per match budget and falls back once it is exhausted', async () => {
    const d = deps({ budget: createMatchBudget(1) });
    expect((await decideCpuTurn(body(), d)).status).toBe(200);
    const second = await decideCpuTurn(body(), d);
    expect(second.status).toBe(503);
    expect(String((second.body as { reason?: string }).reason)).toContain('budget');
  });

  it('turns a backend failure into a 502 fallback', async () => {
    const result = await decideCpuTurn(body(), deps({ requestViaApi: () => Promise.resolve(err('boom')) }));
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ fallback: true, reason: 'boom' });
  });

  it('turns a rejected model answer into a 502 fallback', async () => {
    const bad = { ...goodRaw, weapon: 'nuke' };
    const result = await decideCpuTurn(body(), deps({ requestViaApi: () => Promise.resolve(ok(decision(bad))) }));
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ fallback: true });
  });

  it('uses the cli requester when the backend is cli', async () => {
    const result = await decideCpuTurn(body(), deps({ backend: 'cli', requestViaCli: () => Promise.resolve(ok(decision({ ...goodRaw, weapon: 'bazooka' }))) }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ weapon: 'bazooka' });
  });
});
