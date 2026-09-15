/**
 * The one API handler, exposed two ways: the Vite dev middleware mounted at /api and the
 * standalone sidecar server. Routes are RELATIVE to the /api mount ("/cpu-turn",
 * "/cpu-turn/health"); mounting at /api/cpu-turn would strip the prefix and break the health
 * route (ultraplan.html, design rules from the bug hunt).
 *
 * Health is a plain GET that reports the backend. The turn route delegates to cpu-turn.ts,
 * which validates, budgets, calls the backend and sanitizes. The request guards (host, origin,
 * token, content type, throttle) live in server.ts and the Vite plugin, in front of this.
 */

import { CPU_TURN_SCHEMA, type CpuBackend, type CpuHealthResponse, type CpuTurnHttpResponse } from '../src/ai/contract.ts';
import { decideCpuTurn, type CpuTurnDeps } from './cpu-turn.ts';

export interface ApiRequest {
  readonly method: string;
  /** Path relative to the /api mount, may carry a query string. */
  readonly path: string;
  readonly body?: unknown;
}

export interface ApiErrorBody {
  readonly error: string;
}

export type ApiBody = CpuHealthResponse | CpuTurnHttpResponse | ApiErrorBody;

export interface ApiResponse {
  readonly status: number;
  readonly body: ApiBody;
}

export interface HandlerOptions {
  readonly backend: CpuBackend;
  /** When present the turn route serves real decisions; without it every turn is a 503 fallback. */
  readonly deps?: CpuTurnDeps;
}

export const DEFAULT_HANDLER_OPTIONS: HandlerOptions = Object.freeze({ backend: 'off' });

export const ROUTE_CPU_TURN = '/cpu-turn';
export const ROUTE_CPU_TURN_HEALTH = '/cpu-turn/health';

export function json(status: number, body: ApiBody): ApiResponse {
  return Object.freeze({ status, body: Object.freeze(body) });
}

/** Drops the query string and trailing slashes; "" becomes "/". */
export function normalizeRoute(path: string): string {
  const cut = path.indexOf('?');
  const bare = (cut === -1 ? path : path.slice(0, cut)).replace(/\/+$/, '');
  return bare === '' ? '/' : bare;
}

export async function handleApiRoute(req: ApiRequest, options: HandlerOptions = DEFAULT_HANDLER_OPTIONS): Promise<ApiResponse> {
  const route = normalizeRoute(req.path);
  const method = req.method.toUpperCase();

  if (route === ROUTE_CPU_TURN_HEALTH) {
    if (method !== 'GET') return json(405, { error: 'method not allowed' });
    return json(200, { ok: true, schema: CPU_TURN_SCHEMA, backend: options.backend });
  }

  if (route === ROUTE_CPU_TURN) {
    if (method !== 'POST') return json(405, { error: 'method not allowed' });
    if (options.deps === undefined) {
      return json(503, { fallback: true, reason: `cpu backend ${options.backend} is not serving turns yet` });
    }
    const result = await decideCpuTurn(req.body, options.deps);
    return json(result.status, result.body);
  }

  return json(404, { error: 'not found' });
}
