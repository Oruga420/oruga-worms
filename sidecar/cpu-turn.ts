/**
 * The CPU turn orchestration behind POST /api/cpu-turn: validate the body, honor the kill
 * switch and the backend selection, charge the per match budget, ask the backend, sanitize the
 * answer, and return either a CpuTurnResponse (200) or a fallback (502 or 503) that makes the
 * browser play the deterministic heuristic. The model output is never trusted: only what
 * sanitize.ts accepts leaves this module. Logging never includes prompts or keys.
 */

import type { CpuBackend, CpuTurnHttpResponse, CpuTurnRequest } from '../src/ai/contract.ts';
import type { Result } from '../src/core/result.ts';
import { requestCpuTurnViaApi, type ApiDecision } from './backends/api.ts';
import { requestCpuTurnViaCli } from './backends/cli.ts';
import type { MatchBudget } from './rate-limit.ts';
import { sanitizeCpuTurn } from './sanitize.ts';
import { validateCpuTurnRequest } from './validate-request.ts';
import { sanitizeContextFor } from './weapon-meta.ts';

export type TurnRequester = (req: CpuTurnRequest) => Promise<Result<ApiDecision, string>>;

export interface CpuTurnDeps {
  readonly backend: CpuBackend;
  /** ORUGAS_CPU_LLM kill switch; false means heuristic only without any model call. */
  readonly llmEnabled: boolean;
  readonly budget: MatchBudget;
  readonly apiKey?: string;
  readonly modelOverride?: string;
  /** Injectable for tests; defaults to the real backends. */
  readonly requestViaApi?: TurnRequester;
  readonly requestViaCli?: TurnRequester;
  readonly log?: (line: string) => void;
}

export interface CpuTurnResult {
  readonly status: 200 | 400 | 502 | 503;
  readonly body: CpuTurnHttpResponse | { readonly error: string };
}

function fallback(status: 502 | 503, reason: string): CpuTurnResult {
  return Object.freeze({ status, body: Object.freeze({ fallback: true as const, reason }) });
}

function pickRequester(deps: CpuTurnDeps): TurnRequester | null {
  if (deps.backend === 'api') {
    if (deps.requestViaApi !== undefined) return deps.requestViaApi;
    const apiKey = deps.apiKey;
    if (apiKey === undefined || apiKey.trim() === '') return null;
    const model = deps.modelOverride;
    return (req) => requestCpuTurnViaApi(req, model === undefined ? { apiKey } : { apiKey, model });
  }
  if (deps.backend === 'cli') {
    if (deps.requestViaCli !== undefined) return deps.requestViaCli;
    const model = deps.modelOverride;
    return (req) => requestCpuTurnViaCli(req, model === undefined ? {} : { model });
  }
  return null;
}

export async function decideCpuTurn(body: unknown, deps: CpuTurnDeps): Promise<CpuTurnResult> {
  const validated = validateCpuTurnRequest(body);
  if (!validated.ok) return Object.freeze({ status: 400, body: Object.freeze({ error: validated.error }) });
  const req = validated.value;
  const log = deps.log ?? (() => undefined);

  if (!deps.llmEnabled) return fallback(503, 'cpu llm is switched off');
  if (deps.backend === 'off') return fallback(503, 'cpu backend off');
  const requester = pickRequester(deps);
  if (requester === null) return fallback(503, `cpu backend ${deps.backend} is not configured (missing key)`);

  const budget = deps.budget.tryConsume(req.matchId);
  if (!budget.ok) {
    log(`cpu-turn match=${req.matchId} turn=${req.turn} budget=${budget.reason} used=${budget.used}`);
    return fallback(503, budget.reason === 'exhausted' ? 'per match call budget exhausted' : 'invalid match id');
  }

  const decision = await requester(req);
  if (!decision.ok) {
    log(`cpu-turn match=${req.matchId} turn=${req.turn} backend=${deps.backend} error=${decision.error}`);
    return fallback(502, decision.error);
  }

  const clean = sanitizeCpuTurn(decision.value.raw, sanitizeContextFor(req));
  const d = decision.value;
  if (!clean.ok) {
    log(`cpu-turn match=${req.matchId} turn=${req.turn} backend=${deps.backend} ms=${d.durationMs} cost=${d.costUsd.toFixed(5)} rejected=${clean.reason}`);
    return fallback(502, clean.reason);
  }
  log(
    `cpu-turn match=${req.matchId} turn=${req.turn} backend=${deps.backend} model=${d.model} ms=${d.durationMs} ` +
      `tokens=${d.inputTokens}/${d.outputTokens} cost=${d.costUsd.toFixed(5)} weapon=${clean.value.weapon} used=${budget.used}/${deps.budget.maxCallsPerMatch}`,
  );
  return Object.freeze({ status: 200, body: clean.value });
}
