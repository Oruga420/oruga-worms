/**
 * Per match call budget (ultraplan rev 2, Agentic CPU opponent): a runaway loop, a stuck
 * client or a hostile page cannot spend without bound. Measured in Phase 0.3 at about 0.0025
 * USD per turn, 200 turns is about 0.50 USD per match. The throttle in auth.ts limits the rate;
 * this limits the total per match. Idle matches are forgotten after a TTL so memory stays flat.
 */

const MATCH_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export interface MatchBudgetOptions {
  /** Forget a match after this much idle time. */
  readonly idleTtlMs?: number;
  /** Maximum matches tracked at once; the oldest is evicted beyond this. */
  readonly maxMatches?: number;
}

export type BudgetDecision =
  | { readonly ok: true; readonly used: number; readonly remaining: number }
  | { readonly ok: false; readonly reason: 'exhausted' | 'invalid_match'; readonly used: number };

export interface MatchBudget {
  readonly maxCallsPerMatch: number;
  tryConsume(matchId: string, nowMs?: number): BudgetDecision;
  used(matchId: string): number;
  trackedMatches(): number;
}

interface Entry {
  used: number;
  lastSeenMs: number;
}

export const DEFAULT_BUDGET_OPTIONS: Required<MatchBudgetOptions> = Object.freeze({
  idleTtlMs: 2 * 60 * 60 * 1000,
  maxMatches: 256,
});

export function isValidMatchId(matchId: unknown): matchId is string {
  return typeof matchId === 'string' && MATCH_ID_PATTERN.test(matchId);
}

export function createMatchBudget(maxCallsPerMatch: number, options: MatchBudgetOptions = {}): MatchBudget {
  const limits = { ...DEFAULT_BUDGET_OPTIONS, ...options };
  const cap = Number.isFinite(maxCallsPerMatch) && maxCallsPerMatch > 0 ? Math.floor(maxCallsPerMatch) : 0;
  // Mutable map on purpose: this is the one ledger of the process, pruned on every call.
  const matches = new Map<string, Entry>();

  const pruneIdle = (nowMs: number): void => {
    for (const [id, entry] of matches) {
      if (nowMs - entry.lastSeenMs > limits.idleTtlMs) matches.delete(id);
    }
  };

  /** Runs after an insert so the newest match (largest lastSeenMs) is never the one evicted. */
  const evictOverflow = (): void => {
    while (matches.size > limits.maxMatches) {
      const oldest = [...matches.entries()].sort((a, b) => a[1].lastSeenMs - b[1].lastSeenMs)[0];
      if (oldest === undefined) break;
      matches.delete(oldest[0]);
    }
  };

  return {
    maxCallsPerMatch: cap,
    tryConsume(matchId, nowMs = Date.now()) {
      if (!isValidMatchId(matchId)) return { ok: false, reason: 'invalid_match', used: 0 };
      pruneIdle(nowMs);
      const entry = matches.get(matchId) ?? { used: 0, lastSeenMs: nowMs };
      entry.lastSeenMs = nowMs;
      matches.set(matchId, entry);
      evictOverflow();
      if (entry.used >= cap) return { ok: false, reason: 'exhausted', used: entry.used };
      entry.used += 1;
      return { ok: true, used: entry.used, remaining: cap - entry.used };
    },
    used(matchId) {
      return matches.get(matchId)?.used ?? 0;
    },
    trackedMatches() {
      return matches.size;
    },
  };
}
