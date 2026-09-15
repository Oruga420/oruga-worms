import { describe, expect, it } from 'vitest';
import {
  all,
  andThen,
  err,
  fromThrowable,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrapOr,
  unwrapOrElse,
  type Result,
} from '@/core/result.ts';

describe('Result', () => {
  it('builds frozen ok and err values', () => {
    const success = ok(42);
    const failure = err('boom');
    expect(success).toEqual({ ok: true, value: 42 });
    expect(failure).toEqual({ ok: false, error: 'boom' });
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it('narrows with isOk and isErr', () => {
    const results: Result<number, string>[] = [ok(1), err('no')];
    expect(results.filter(isOk).map((r) => r.value)).toEqual([1]);
    expect(results.filter(isErr).map((r) => r.error)).toEqual(['no']);
  });

  it('maps the value and leaves errors alone', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(map(err<string>('x'), (n: number) => n * 3)).toEqual({ ok: false, error: 'x' });
  });

  it('maps the error and leaves values alone', () => {
    expect(mapErr(err('x'), (e) => `${e}!`)).toEqual({ ok: false, error: 'x!' });
    expect(mapErr(ok<number>(1), (e: string) => `${e}!`)).toEqual({ ok: true, value: 1 });
  });

  it('chains with andThen and short circuits on the first error', () => {
    const parse = (s: string): Result<number, string> => (/^\d+$/.test(s) ? ok(Number(s)) : err(`not a number: ${s}`));
    const positive = (n: number): Result<number, string> => (n > 0 ? ok(n) : err('not positive'));
    expect(andThen(parse('7'), positive)).toEqual({ ok: true, value: 7 });
    expect(andThen(parse('0'), positive)).toEqual({ ok: false, error: 'not positive' });
    expect(andThen(parse('x'), positive)).toEqual({ ok: false, error: 'not a number: x' });
  });

  it('unwraps with a fallback', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err('x'), 9)).toBe(9);
    expect(unwrapOrElse(err('x'), (e) => e.length)).toBe(1);
    expect(unwrapOrElse(ok(5), () => 0)).toBe(5);
  });

  it('collects many results, first error wins', () => {
    expect(all([ok(1), ok(2)])).toEqual({ ok: true, value: [1, 2] });
    expect(all<number, string>([ok(1), err('a'), err('b')])).toEqual({ ok: false, error: 'a' });
    const collected = all([ok(1)]);
    expect(collected.ok && Object.isFrozen(collected.value)).toBe(true);
  });

  it('turns throws into errors', () => {
    expect(fromThrowable(() => JSON.parse('{"a":1}') as unknown, String)).toEqual({ ok: true, value: { a: 1 } });
    const failed = fromThrowable(() => JSON.parse('{') as unknown, (thrown) => (thrown instanceof Error ? thrown.name : 'unknown'));
    expect(failed).toEqual({ ok: false, error: 'SyntaxError' });
  });
});
