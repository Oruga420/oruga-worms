/**
 * Pure request guards for the CPU sidecar (ultraplan.html, "Security requirements"): any page
 * open in the browser can POST to a local port, so every request must pass the Host check, the
 * Origin allowlist, the operator-supplied token (ORUGAS_CPU_TOKEN, static and optional, not
 * auto-rotated per process), the JSON content type and the throttle before it can spend a model
 * call. Nothing here touches the network; the server wires these in.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/;

export interface ParsedHost {
  readonly host: string;
  readonly port: number | null;
}

export function parseHostHeader(hostHeader: string | undefined): ParsedHost | null {
  if (typeof hostHeader !== 'string') return null;
  const value = hostHeader.trim().toLowerCase();
  if (value === '' || value.length > 255) return null;
  const match = HOST_PATTERN.exec(value);
  if (!match || match[1] === undefined) return null;
  const port = match[2] === undefined ? null : Number.parseInt(match[2], 10);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return Object.freeze({ host: match[1], port });
}

/** True only for a loopback host name with an explicit port from the allowed list. */
export function isAllowedHost(hostHeader: string | undefined, allowedPorts: readonly number[]): boolean {
  const parsed = parseHostHeader(hostHeader);
  if (parsed === null || parsed.port === null || !LOOPBACK_HOSTS.has(parsed.host)) return false;
  return allowedPorts.includes(parsed.port);
}

/** Lower cased scheme://host[:port] with nothing else, or null when the value is not a bare origin. */
export function normalizeOrigin(origin: string): string | null {
  let url: URL;
  try {
    url = new URL(origin.trim());
  } catch {
    return null;
  }
  const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
  if (!bare || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  return url.origin.toLowerCase();
}

/** Exact match against the allowlist after normalization. A missing or "null" Origin is rejected. */
export function isAllowedOrigin(origin: string | undefined, allowlist: readonly string[]): boolean {
  if (typeof origin !== 'string') return false;
  const normalized = normalizeOrigin(origin);
  if (normalized === null) return false;
  return allowlist.some((allowed) => normalizeOrigin(allowed) === normalized);
}

/** Constant time compare through fixed length digests, so neither length nor content leaks by timing. */
export function hasValidToken(headerValue: string | undefined, expected: string): boolean {
  if (typeof headerValue !== 'string' || expected.length === 0) return false;
  const presented = createHash('sha256').update(headerValue.trim(), 'utf8').digest();
  const wanted = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(presented, wanted);
}

/** application/json with an optional parameter list; anything else forces a rejection (and a CORS preflight). */
export function isJsonContentType(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const [mediaType] = value.split(';');
  return (mediaType ?? '').trim().toLowerCase() === 'application/json';
}

export interface ThrottleOptions {
  /** Requests allowed to be in progress at once. */
  readonly maxInFlight?: number;
  /** Requests allowed to start inside one window. */
  readonly maxPerWindow?: number;
  readonly windowMs?: number;
}

export type ThrottleDecision =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly reason: 'in_flight' | 'rate_limited'; readonly retryAfterMs: number };

export interface ThrottleSnapshot {
  readonly inFlight: number;
  readonly usedInWindow: number;
}

export interface Throttle {
  tryAcquire(nowMs?: number): ThrottleDecision;
  snapshot(nowMs?: number): ThrottleSnapshot;
}

export const DEFAULT_THROTTLE: Required<ThrottleOptions> = Object.freeze({
  maxInFlight: 1,
  maxPerWindow: 10,
  windowMs: 60_000,
});

/** In memory throttle: one request in flight and ten per minute by default. The clock is injectable for tests. */
export function createThrottle(options: ThrottleOptions = {}): Throttle {
  const limits = { ...DEFAULT_THROTTLE, ...options };
  let inFlight = 0;
  let starts: readonly number[] = [];
  const prune = (nowMs: number): readonly number[] => starts.filter((t) => nowMs - t < limits.windowMs);

  return {
    tryAcquire(nowMs = Date.now()) {
      starts = prune(nowMs);
      if (inFlight >= limits.maxInFlight) {
        return { ok: false, reason: 'in_flight', retryAfterMs: 1000 };
      }
      if (starts.length >= limits.maxPerWindow) {
        const oldest = starts[0] ?? nowMs;
        return { ok: false, reason: 'rate_limited', retryAfterMs: Math.max(1, oldest + limits.windowMs - nowMs) };
      }
      inFlight += 1;
      starts = [...starts, nowMs];
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          inFlight -= 1;
        },
      };
    },
    snapshot(nowMs = Date.now()) {
      return Object.freeze({ inFlight, usedInWindow: prune(nowMs).length });
    },
  };
}
