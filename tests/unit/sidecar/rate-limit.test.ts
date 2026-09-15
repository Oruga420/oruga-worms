import { describe, expect, it } from 'vitest';
import { createMatchBudget, isValidMatchId } from '../../../sidecar/rate-limit.ts';

describe('match budget', () => {
  it('allows up to the cap and then reports exhausted', () => {
    const budget = createMatchBudget(2);
    expect(budget.tryConsume('m1', 1000)).toEqual({ ok: true, used: 1, remaining: 1 });
    expect(budget.tryConsume('m1', 1001)).toEqual({ ok: true, used: 2, remaining: 0 });
    expect(budget.tryConsume('m1', 1002)).toEqual({ ok: false, reason: 'exhausted', used: 2 });
    expect(budget.used('m1')).toBe(2);
  });

  it('keeps matches independent', () => {
    const budget = createMatchBudget(1);
    expect(budget.tryConsume('a', 1).ok).toBe(true);
    expect(budget.tryConsume('b', 2).ok).toBe(true);
    expect(budget.tryConsume('a', 3).ok).toBe(false);
  });

  it('rejects invalid match ids without spending', () => {
    const budget = createMatchBudget(5);
    expect(budget.tryConsume('has space', 1)).toEqual({ ok: false, reason: 'invalid_match', used: 0 });
    expect(budget.tryConsume('', 1).ok).toBe(false);
    expect(isValidMatchId('ok_id-1.2')).toBe(true);
    expect(isValidMatchId('x'.repeat(65))).toBe(false);
  });

  it('forgets idle matches after the ttl and evicts beyond the cap', () => {
    const budget = createMatchBudget(1, { idleTtlMs: 100, maxMatches: 2 });
    budget.tryConsume('a', 0);
    budget.tryConsume('b', 10);
    budget.tryConsume('c', 20);
    expect(budget.trackedMatches()).toBe(2);
    expect(budget.tryConsume('a', 500).ok).toBe(true);
    expect(budget.trackedMatches()).toBe(1);
  });

  it('treats a non positive cap as zero budget', () => {
    const budget = createMatchBudget(0);
    expect(budget.maxCallsPerMatch).toBe(0);
    expect(budget.tryConsume('m', 1).ok).toBe(false);
  });
});
