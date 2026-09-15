import { describe, expect, it } from 'vitest';
import { CPU_TURN_SCHEMA } from '@/ai/contract.ts';
import { ok } from '../../../src/core/result.ts';
import type { CpuTurnDeps } from '../../../sidecar/cpu-turn.ts';
import { DEFAULT_HANDLER_OPTIONS, handleApiRoute, normalizeRoute } from '../../../sidecar/handler.ts';
import { createMatchBudget } from '../../../sidecar/rate-limit.ts';

describe('api handler', () => {
  it('normalizes routes: query string and trailing slashes are dropped', () => {
    expect(normalizeRoute('/cpu-turn/health?x=1')).toBe('/cpu-turn/health');
    expect(normalizeRoute('/cpu-turn/health/')).toBe('/cpu-turn/health');
    expect(normalizeRoute('')).toBe('/');
    expect(normalizeRoute('/')).toBe('/');
  });

  it('reports the backend on the health route', async () => {
    expect(DEFAULT_HANDLER_OPTIONS.backend).toBe('off');
    const response = await handleApiRoute({ method: 'GET', path: '/cpu-turn/health' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, schema: CPU_TURN_SCHEMA, backend: 'off' });
    expect(Object.isFrozen(response)).toBe(true);
    const api = await handleApiRoute({ method: 'get', path: '/cpu-turn/health?probe=1' }, { backend: 'api' });
    expect(api.body).toMatchObject({ backend: 'api' });
  });

  it('answers cpu-turn with 503 and a fallback while no deps serve turns', async () => {
    const response = await handleApiRoute({ method: 'POST', path: '/cpu-turn', body: { schema: CPU_TURN_SCHEMA } });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ fallback: true });
    expect(String((response.body as { reason?: string }).reason)).toContain('off');
  });

  it('delegates cpu-turn to the orchestration when deps are present', async () => {
    const deps: CpuTurnDeps = {
      backend: 'api',
      llmEnabled: true,
      budget: createMatchBudget(5),
      requestViaApi: () =>
        Promise.resolve(
          ok({
            raw: { weapon: 'bazooka', aimAngleDeg: 30, power: 80, facing: 'right', move: { direction: 'none', durationMs: 0 }, fuseMs: null, targetPoint: null, taunt: 'Fire!', confidence: 0.9, reasoning: 'x' },
            model: 'fake',
            durationMs: 1,
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            stopReason: 'end_turn',
          }),
        ),
      log: () => undefined,
    };
    const bad = await handleApiRoute({ method: 'POST', path: '/cpu-turn', body: { schema: 'nope' } }, { backend: 'api', deps });
    expect(bad.status).toBe(400);
    const good = await handleApiRoute(
      {
        method: 'POST',
        path: '/cpu-turn',
        body: {
          schema: CPU_TURN_SCHEMA,
          matchId: 'm',
          turn: 1,
          difficulty: 'easy',
          personality: 'sniper',
          windStep: 0,
          wind: 0,
          gravity: 900,
          waterY: 600,
          world: { w: 1920, h: 696 },
          active: { wormId: 'a', team: 'A', x: 1, y: 1, hp: 1, canMoveLeft: true, canMoveRight: true },
          allies: [],
          enemies: [{ id: 'e', team: 'B', x: 100, y: 1, hp: 1 }],
          ammo: [{ weapon: 'bazooka', count: -1 }],
          terrain: { profile: [1], sampleStepPx: 30 },
          lineOfSight: [],
        },
      },
      { backend: 'api', deps },
    );
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ weapon: 'bazooka', power: 80 });
  });

  it('rejects wrong methods and unknown routes', async () => {
    expect((await handleApiRoute({ method: 'GET', path: '/cpu-turn' })).status).toBe(405);
    expect((await handleApiRoute({ method: 'POST', path: '/cpu-turn/health' })).status).toBe(405);
    expect(await handleApiRoute({ method: 'GET', path: '/nope' })).toEqual({ status: 404, body: { error: 'not found' } });
    expect((await handleApiRoute({ method: 'GET', path: '/' })).status).toBe(404);
  });
});
