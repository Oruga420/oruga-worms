/**
 * Deep freeze for the match ledger. reduce() and buildInitialState() freeze everything they
 * return, so a consumer that mutates the ledger fails loudly in strict mode instead of silently
 * desynchronising the HUD from the sim. Already frozen subtrees are skipped, which keeps the per
 * event cost proportional to what changed: untouched teams, worms and log entries are shared
 * between consecutive states and were frozen when they were first built.
 *
 * Never call this on typed arrays (freezing an ArrayBuffer view throws); the ledger holds none.
 */

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
