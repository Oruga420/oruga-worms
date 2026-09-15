/**
 * The browser side sidecar client (architecture.md section F, ai/client.ts): a health probe run
 * once per match with a short timeout, and a per turn POST to /api/cpu-turn with an Abort
 * controller so a slow or absent backend never blocks the turn. Both return null on any problem;
 * the cpu controller falls back to the heuristic. The page origin is sent so the sidecar guard
 * passes; the per boot token, when the dev server injected one, rides in a header.
 */

import type { CpuBackend, CpuTurnRequest } from './contract.ts';

export interface ClientOptions {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly healthTimeoutMs?: number;
  readonly turnTimeoutMs?: number;
}

export interface HealthInfo {
  readonly available: boolean;
  readonly backend: CpuBackend | null;
}

const DEFAULT_HEALTH_TIMEOUT = 500;
const DEFAULT_TURN_TIMEOUT = 8000;

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export function createCpuClient(options: ClientOptions = {}) {
  const base = options.baseUrl ?? '';
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token !== undefined) headers['x-orugas-token'] = options.token;

  return {
    async health(): Promise<HealthInfo> {
      const { signal, cancel } = timeoutSignal(options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT);
      try {
        const response = await doFetch(`${base}/api/cpu-turn/health`, { signal });
        if (!response.ok) return { available: false, backend: null };
        const body = (await response.json()) as { ok?: boolean; backend?: CpuBackend };
        return { available: body.ok === true, backend: body.backend ?? null };
      } catch {
        return { available: false, backend: null };
      } finally {
        cancel();
      }
    },

    /** POSTs a turn; returns the raw JSON body (validated by the caller) or null on any failure. */
    async requestTurn(request: CpuTurnRequest): Promise<unknown | null> {
      const { signal, cancel } = timeoutSignal(options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT);
      try {
        const response = await doFetch(`${base}/api/cpu-turn`, { method: 'POST', headers, body: JSON.stringify(request), signal });
        if (!response.ok) return null;
        const body = (await response.json()) as { fallback?: boolean };
        if (body.fallback === true) return null;
        return body;
      } catch {
        return null;
      } finally {
        cancel();
      }
    },
  };
}

export type CpuClient = ReturnType<typeof createCpuClient>;
