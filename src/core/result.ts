/**
 * Result<T, E>: explicit success or failure at system boundaries (asset loading, JSON parsing,
 * the sidecar sanitizer, settings from localStorage). Never throw across a boundary; return one
 * of these. Values are frozen so a Result can never be mutated after creation.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true as const, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ ok: false as const, error });
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transforms the success value, passes an Err through untouched. */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transforms the error, passes an Ok through untouched. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chains a second fallible step onto a success. */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function unwrapOrElse<T, E>(result: Result<T, E>, fallback: (error: E) => T): T {
  return result.ok ? result.value : fallback(result.error);
}

/** Collects many Results into one: the first Err wins, otherwise Ok of every value in order. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(Object.freeze(values));
}

/** Runs a function that may throw and turns the throw into an Err through onError. */
export function fromThrowable<T, E>(fn: () => T, onError: (thrown: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (thrown: unknown) {
    return err(onError(thrown));
  }
}
