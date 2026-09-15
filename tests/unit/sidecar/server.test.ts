import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createThrottle } from '../../../sidecar/auth.ts';
import { checkTurnGuards, MAX_BODY_BYTES, startSidecar, type RunningSidecar } from '../../../sidecar/server.ts';

interface Reply {
  readonly status: number;
  readonly json: unknown;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface CallOptions {
  readonly method: string;
  readonly path: string;
  readonly body?: string;
  readonly host?: string;
  readonly contentType?: string;
  readonly origin?: string;
  readonly token?: string;
}

function callOn(target: RunningSidecar, options: CallOptions): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: target.port,
        method: options.method,
        path: options.path,
        headers: {
          'content-type': options.contentType ?? 'application/json',
          ...(options.host === undefined ? {} : { host: options.host }),
          ...(options.origin === undefined ? {} : { origin: options.origin }),
          ...(options.token === undefined ? {} : { 'x-orugas-token': options.token }),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: text === '' ? null : (JSON.parse(text) as unknown), headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

let running: RunningSidecar;
let guarded: RunningSidecar;
const ORIGIN = 'http://127.0.0.1:5174';

beforeAll(async () => {
  running = await startSidecar({ port: 0, backend: 'off' });
  guarded = await startSidecar({
    port: 0,
    backend: 'off',
    guards: { allowedOrigins: [ORIGIN], token: 'secret-token', throttle: { maxInFlight: 1, maxPerWindow: 1, windowMs: 60_000 } },
  });
});

afterAll(async () => {
  await running.close();
  await guarded.close();
});

describe('sidecar server', () => {
  const call = (options: CallOptions): Promise<Reply> => callOn(running, options);

  it('binds an ephemeral loopback port', () => {
    expect(running.host).toBe('127.0.0.1');
    expect(running.port).toBeGreaterThan(0);
  });

  it('serves the health route with the backend', async () => {
    const reply = await call({ method: 'GET', path: '/api/cpu-turn/health' });
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ ok: true, backend: 'off' });
  });

  it('answers cpu-turn with a 503 fallback', async () => {
    const reply = await call({ method: 'POST', path: '/api/cpu-turn', body: JSON.stringify({ schema: 'cpu-turn/2' }) });
    expect(reply.status).toBe(503);
    expect(reply.json).toMatchObject({ fallback: true });
  });

  it('rejects invalid JSON with 400 and an oversized body with 413', async () => {
    const bad = await call({ method: 'POST', path: '/api/cpu-turn', body: '{not json' });
    expect(bad.status).toBe(400);
    expect(bad.json).toEqual({ error: 'body is not valid JSON' });
    const huge = await call({ method: 'POST', path: '/api/cpu-turn', body: '"' + 'x'.repeat(MAX_BODY_BYTES + 1024) + '"' });
    expect(huge.status).toBe(413);
  });

  it('rejects a Host header that is not the bound loopback port', async () => {
    const spoofed = await call({ method: 'GET', path: '/api/cpu-turn/health', host: 'evil.example:80' });
    expect(spoofed.status).toBe(403);
    const wrongPort = await call({ method: 'GET', path: '/api/cpu-turn/health', host: `127.0.0.1:${running.port + 1}` });
    expect(wrongPort.status).toBe(403);
    const named = await call({ method: 'GET', path: '/api/cpu-turn/health', host: `localhost:${running.port}` });
    expect(named.status).toBe(200);
  });

  it('answers 404 outside /api and for unknown routes', async () => {
    expect((await call({ method: 'GET', path: '/' })).status).toBe(404);
    expect((await call({ method: 'GET', path: '/apix/cpu-turn/health' })).status).toBe(404);
    expect((await call({ method: 'GET', path: '/api/nope' })).status).toBe(404);
  });

  it('never sends CORS headers', async () => {
    const reply = await call({ method: 'GET', path: '/api/cpu-turn/health', origin: 'http://evil.example' });
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('turn route guards', () => {
  const call = (options: CallOptions): Promise<Reply> => callOn(guarded, options);
  const body = JSON.stringify({ schema: 'cpu-turn/2' });

  it('leaves the health route open', async () => {
    expect((await call({ method: 'GET', path: '/api/cpu-turn/health' })).status).toBe(200);
  });

  it('requires a JSON content type', async () => {
    const reply = await call({ method: 'POST', path: '/api/cpu-turn', body, contentType: 'text/plain', origin: ORIGIN, token: 'secret-token' });
    expect(reply.status).toBe(415);
  });

  it('requires an allowed origin', async () => {
    expect((await call({ method: 'POST', path: '/api/cpu-turn', body, token: 'secret-token' })).status).toBe(403);
    expect((await call({ method: 'POST', path: '/api/cpu-turn', body, origin: 'http://evil.example', token: 'secret-token' })).status).toBe(403);
  });

  it('requires the token when one is configured', async () => {
    expect((await call({ method: 'POST', path: '/api/cpu-turn', body, origin: ORIGIN })).status).toBe(403);
    expect((await call({ method: 'POST', path: '/api/cpu-turn', body, origin: ORIGIN, token: 'wrong' })).status).toBe(403);
  });

  it('lets a compliant request through once, then throttles with Retry-After', async () => {
    const first = await call({ method: 'POST', path: '/api/cpu-turn', body, origin: ORIGIN, token: 'secret-token' });
    expect(first.status).toBe(503);
    const second = await call({ method: 'POST', path: '/api/cpu-turn', body, origin: ORIGIN, token: 'secret-token' });
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });
});

describe('checkTurnGuards', () => {
  it('applies the guards in order and releases the throttle slot', () => {
    const throttle = createThrottle({ maxInFlight: 1, maxPerWindow: 5 });
    const guards = { allowedOrigins: [ORIGIN] };
    expect(checkTurnGuards({ contentType: 'text/html', origin: ORIGIN }, guards, throttle).ok).toBe(false);
    expect(checkTurnGuards({ contentType: 'application/json' }, guards, throttle).ok).toBe(false);
    const first = checkTurnGuards({ contentType: 'application/json; charset=utf-8', origin: ORIGIN }, guards, throttle);
    expect(first.ok).toBe(true);
    const busy = checkTurnGuards({ contentType: 'application/json', origin: ORIGIN }, guards, throttle);
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.response.status).toBe(429);
    if (first.ok) first.release();
    expect(checkTurnGuards({ contentType: 'application/json', origin: ORIGIN }, guards, throttle).ok).toBe(true);
  });
});
