import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THROTTLE,
  createThrottle,
  hasValidToken,
  isAllowedHost,
  isAllowedOrigin,
  isJsonContentType,
  normalizeOrigin,
  parseHostHeader,
} from '../../../sidecar/auth.ts';

describe('auth: host header', () => {
  it('parses host and port', () => {
    expect(parseHostHeader('localhost:8788')).toEqual({ host: 'localhost', port: 8788 });
    expect(parseHostHeader('[::1]:8788')).toEqual({ host: '[::1]', port: 8788 });
    expect(parseHostHeader('LOCALHOST:8788')).toEqual({ host: 'localhost', port: 8788 });
    expect(parseHostHeader('localhost')).toEqual({ host: 'localhost', port: null });
    expect(parseHostHeader('localhost:99999')).toBeNull();
    expect(parseHostHeader('local host:1')).toBeNull();
    expect(parseHostHeader(undefined)).toBeNull();
  });

  it('allows only loopback hosts with an allowed port', () => {
    const ports = [8788];
    expect(isAllowedHost('localhost:8788', ports)).toBe(true);
    expect(isAllowedHost('127.0.0.1:8788', ports)).toBe(true);
    expect(isAllowedHost('[::1]:8788', ports)).toBe(true);
    expect(isAllowedHost('localhost:8787', ports)).toBe(false);
    expect(isAllowedHost('evil.example:8788', ports)).toBe(false);
    expect(isAllowedHost('localhost', ports)).toBe(false);
    expect(isAllowedHost('localhost:8788:1', ports)).toBe(false);
    expect(isAllowedHost(undefined, ports)).toBe(false);
    expect(isAllowedHost('localhost:8788', [])).toBe(false);
  });
});

describe('auth: origin allowlist', () => {
  it('normalizes bare origins', () => {
    expect(normalizeOrigin('HTTP://LOCALHOST:5174')).toBe('http://localhost:5174');
    expect(normalizeOrigin('http://localhost:5174/')).toBe('http://localhost:5174');
    expect(normalizeOrigin('http://localhost:5174/path')).toBeNull();
    expect(normalizeOrigin('http://user:pw@localhost:5174')).toBeNull();
    expect(normalizeOrigin('ftp://localhost:5174')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });

  it('matches exactly against the allowlist', () => {
    const allow = ['http://localhost:5174', 'http://127.0.0.1:5174'];
    expect(isAllowedOrigin('http://localhost:5174', allow)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5174/', allow)).toBe(true);
    expect(isAllowedOrigin('HTTP://LOCALHOST:5174', allow)).toBe(true);
    expect(isAllowedOrigin('https://localhost:5174', allow)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', allow)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5174.evil.example', allow)).toBe(false);
    expect(isAllowedOrigin('null', allow)).toBe(false);
    expect(isAllowedOrigin(undefined, allow)).toBe(false);
  });
});

describe('auth: token', () => {
  it('accepts only the exact token, never an empty expectation', () => {
    expect(hasValidToken('abc123', 'abc123')).toBe(true);
    expect(hasValidToken(' abc123 ', 'abc123')).toBe(true);
    expect(hasValidToken('abc124', 'abc123')).toBe(false);
    expect(hasValidToken('abc', 'abc123')).toBe(false);
    expect(hasValidToken('abc123', '')).toBe(false);
    expect(hasValidToken('', '')).toBe(false);
    expect(hasValidToken(undefined, 'abc123')).toBe(false);
  });
});

describe('auth: content type', () => {
  it('requires application/json', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('Application/JSON')).toBe(true);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('application/jsonx')).toBe(false);
    expect(isJsonContentType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

describe('auth: throttle', () => {
  it('defaults to one in flight and ten per minute', () => {
    expect(DEFAULT_THROTTLE).toEqual({ maxInFlight: 1, maxPerWindow: 10, windowMs: 60_000 });
  });

  it('allows one request in flight at a time', () => {
    const throttle = createThrottle();
    const first = throttle.tryAcquire(0);
    expect(first.ok).toBe(true);
    expect(throttle.tryAcquire(1)).toEqual({ ok: false, reason: 'in_flight', retryAfterMs: 1000 });
    if (first.ok) first.release();
    expect(throttle.snapshot(2).inFlight).toBe(0);
    expect(throttle.tryAcquire(2).ok).toBe(true);
  });

  it('releasing twice does not open a second slot', () => {
    const throttle = createThrottle();
    const first = throttle.tryAcquire(0);
    if (first.ok) {
      first.release();
      first.release();
    }
    expect(throttle.snapshot(0).inFlight).toBe(0);
    const second = throttle.tryAcquire(0);
    expect(second.ok).toBe(true);
    expect(throttle.tryAcquire(0).ok).toBe(false);
  });

  it('caps starts per window and reopens once the oldest start leaves the window', () => {
    const throttle = createThrottle();
    for (let i = 0; i < 10; i += 1) {
      const decision = throttle.tryAcquire(i);
      expect(decision.ok).toBe(true);
      if (decision.ok) decision.release();
    }
    expect(throttle.tryAcquire(10)).toEqual({ ok: false, reason: 'rate_limited', retryAfterMs: 59_990 });
    expect(throttle.snapshot(10).usedInWindow).toBe(10);
    const reopened = throttle.tryAcquire(60_000);
    expect(reopened.ok).toBe(true);
    expect(throttle.snapshot(60_000).usedInWindow).toBe(10);
  });

  it('honours custom limits', () => {
    const throttle = createThrottle({ maxInFlight: 2, maxPerWindow: 2, windowMs: 1000 });
    expect(throttle.tryAcquire(0).ok).toBe(true);
    expect(throttle.tryAcquire(0).ok).toBe(true);
    expect(throttle.tryAcquire(0)).toMatchObject({ ok: false, reason: 'in_flight' });
  });
});
