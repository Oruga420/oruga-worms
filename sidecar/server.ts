/**
 * Standalone sidecar http server for `vite preview` and local production. Binds 127.0.0.1 only
 * and validates the Host header on every request. In front of the turn route it applies the
 * guards from the security requirements (ultraplan rev 2): JSON content type (forces a CORS
 * preflight for any cross site page), Origin allowlist, optional per boot token and the throttle
 * (one in flight, ten per minute). No CORS headers are ever sent, so a foreign origin cannot
 * read a response even if it manages to send one.
 *
 * readJsonBody, writeJson and checkTurnGuards are shared with the Vite dev middleware.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CpuBackend } from '../src/ai/contract.ts';
import { err, ok, type Result } from '../src/core/result.ts';
import { createThrottle, hasValidToken, isAllowedHost, isAllowedOrigin, isJsonContentType, type Throttle, type ThrottleOptions } from './auth.ts';
import type { CpuTurnDeps } from './cpu-turn.ts';
import { handleApiRoute, normalizeRoute, ROUTE_CPU_TURN, type ApiResponse, type HandlerOptions } from './handler.ts';

export const API_PREFIX = '/api';
export const MAX_BODY_BYTES = 64 * 1024;
export const TOKEN_HEADER_NAME = 'x-orugas-token';

export interface GuardConfig {
  readonly allowedOrigins: readonly string[];
  readonly token?: string;
  readonly throttle?: ThrottleOptions;
}

export interface SidecarOptions {
  /** 0 picks an ephemeral port (tests). */
  readonly port: number;
  readonly host?: string;
  readonly backend: CpuBackend;
  readonly deps?: CpuTurnDeps;
  /** Without guards the turn route only has the Host check: test mode. Production always passes guards. */
  readonly guards?: GuardConfig;
}

export interface RunningSidecar {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

export interface BodyError {
  readonly status: 400 | 413;
  readonly message: string;
}

export interface GuardHeaders {
  readonly contentType?: string;
  readonly origin?: string;
  readonly token?: string;
}

export type GuardVerdict =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly response: ApiResponse; readonly retryAfterMs?: number };

/**
 * Applies the turn route guards in order: content type, origin, token, throttle. Pure apart from
 * the throttle state, so the Vite middleware and the server share one implementation.
 */
export function checkTurnGuards(headers: GuardHeaders, guards: GuardConfig, throttle: Throttle, nowMs = Date.now()): GuardVerdict {
  if (!isJsonContentType(headers.contentType)) {
    return { ok: false, response: { status: 415, body: { error: 'content type must be application/json' } } };
  }
  if (!isAllowedOrigin(headers.origin, guards.allowedOrigins)) {
    return { ok: false, response: { status: 403, body: { error: 'origin not allowed' } } };
  }
  if (guards.token !== undefined && !hasValidToken(headers.token, guards.token)) {
    return { ok: false, response: { status: 403, body: { error: 'token missing or invalid' } } };
  }
  const slot = throttle.tryAcquire(nowMs);
  if (!slot.ok) {
    return {
      ok: false,
      response: { status: 429, body: { error: slot.reason === 'in_flight' ? 'a turn is already in progress' : 'too many turns, slow down' } },
      retryAfterMs: slot.retryAfterMs,
    };
  }
  return { ok: true, release: slot.release };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function guardHeadersFrom(req: IncomingMessage): GuardHeaders {
  const contentType = headerValue(req.headers['content-type']);
  const origin = headerValue(req.headers['origin']);
  const token = headerValue(req.headers[TOKEN_HEADER_NAME]);
  return {
    ...(contentType === undefined ? {} : { contentType }),
    ...(origin === undefined ? {} : { origin }),
    ...(token === undefined ? {} : { token }),
  };
}

/**
 * Reads and parses a JSON body with a size cap; an empty body is Ok(undefined). An oversized
 * body is drained and reported as 413 so the client still receives a response instead of a reset.
 */
export function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Result<unknown, BodyError>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;
    let settled = false;
    const finish = (result: Result<unknown, BodyError>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (oversized) return;
      if (size > maxBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) {
        finish(err({ status: 413, message: `body exceeds ${maxBytes} bytes` }));
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') {
        finish(ok(undefined));
        return;
      }
      try {
        finish(ok(JSON.parse(text) as unknown));
      } catch {
        finish(err({ status: 400, message: 'body is not valid JSON' }));
      }
    });
    req.on('error', () => finish(err({ status: 400, message: 'body read failed' })));
  });
}

export function writeJson(res: ServerResponse, response: ApiResponse, extraHeaders: Readonly<Record<string, string>> = {}): void {
  const text = JSON.stringify(response.body);
  res.writeHead(response.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(text);
}

/** Serves one request whose path is already relative to /api. Shared by the server and the Vite plugin. */
export async function serveApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  relativePath: string,
  handlerOptions: HandlerOptions,
  guards: GuardConfig | undefined,
  throttle: Throttle,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (method !== 'POST') {
    writeJson(res, await handleApiRoute({ method, path: relativePath }, handlerOptions));
    return;
  }
  let release: () => void = () => undefined;
  if (guards !== undefined && normalizeRoute(relativePath) === ROUTE_CPU_TURN) {
    const verdict = checkTurnGuards(guardHeadersFrom(req), guards, throttle);
    if (!verdict.ok) {
      const retry = verdict.retryAfterMs === undefined ? {} : { 'Retry-After': String(Math.ceil(verdict.retryAfterMs / 1000)) };
      writeJson(res, verdict.response, retry);
      return;
    }
    release = verdict.release;
  }
  try {
    const body = await readJsonBody(req);
    if (!body.ok) {
      writeJson(res, { status: body.error.status, body: { error: body.error.message } });
      return;
    }
    writeJson(res, await handleApiRoute({ method, path: relativePath, body: body.value }, handlerOptions));
  } finally {
    release();
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  allowedPorts: readonly number[],
  handlerOptions: HandlerOptions,
  guards: GuardConfig | undefined,
  throttle: Throttle,
): Promise<void> {
  if (!isAllowedHost(req.headers.host, allowedPorts)) {
    writeJson(res, { status: 403, body: { error: 'host not allowed' } });
    return;
  }
  const url = req.url ?? '/';
  if (url !== API_PREFIX && !url.startsWith(`${API_PREFIX}/`)) {
    writeJson(res, { status: 404, body: { error: 'not found' } });
    return;
  }
  const relative = url.slice(API_PREFIX.length) || '/';
  await serveApiRequest(req, res, relative, handlerOptions, guards, throttle);
}

/** Binds the server and resolves once it listens; the Host guard uses the port actually bound. */
export function startSidecar(options: SidecarOptions): Promise<RunningSidecar> {
  const host = options.host ?? '127.0.0.1';
  const handlerOptions: HandlerOptions = Object.freeze({
    backend: options.backend,
    ...(options.deps === undefined ? {} : { deps: options.deps }),
  });
  const throttle = createThrottle(options.guards?.throttle ?? {});
  let allowedPorts: readonly number[] = [];
  const server = createServer((req, res) => {
    route(req, res, allowedPorts, handlerOptions, options.guards, throttle).catch(() => {
      if (!res.headersSent) writeJson(res, { status: 500, body: { error: 'internal error' } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: options.port, host, exclusive: true }, () => {
      const address = server.address() as AddressInfo;
      allowedPorts = Object.freeze([address.port]);
      resolve({
        server,
        port: address.port,
        host,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
