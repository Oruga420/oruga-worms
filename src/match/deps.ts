/**
 * Reducer dependencies (architecture.md section E: the reducer is pure given its inputs, and
 * every random draw goes through the seeded generator, never Math.random).
 *
 * MatchConfig is the structural slice of GAME_CONFIG that the match layer reads, typed with
 * plain numbers so a test can shorten a timer without fighting the literal types of the frozen
 * config. GAME_CONFIG satisfies it as is; production always passes GAME_CONFIG.
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import { createRng, type Rng } from '../core/rng.ts';

export interface MatchConfig {
  readonly turnMs: number;
  readonly hotSeatMs: number;
  readonly retreatGroundMs: number;
  readonly retreatAirMs: number;
  readonly roundMs: number;
  readonly suddenDeath: {
    readonly hpCap: number;
    readonly waterRisePxPerTurn: number;
  };
  readonly wormHp: number;
  readonly crates: {
    readonly weaponPct: number;
    readonly healthPct: number;
    readonly utilityPct: number;
    readonly maxOnMap: number;
    readonly healthAmount: number;
    /** Schedule a random supply drop every this many completed turns; 0 disables drops. */
    readonly dropEveryTurns: number;
  };
  /** Per turn movement budget: stepsPerTurn steps of stepPx real displacement; a jump costs jumpStepCost. */
  readonly movement: {
    readonly stepsPerTurn: number;
    readonly stepPx: number;
    readonly jumpStepCost: number;
  };
  readonly resolve: {
    readonly inactivityMs: number;
    readonly absoluteMs: number;
  };
}

export interface MatchDeps {
  readonly config: MatchConfig;
  /** Owned by the match: wind rolls and crate rolls draw from it, nothing else may. */
  readonly rng: Rng;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = GAME_CONFIG;

export function createMatchDeps(seed: number, config: MatchConfig = GAME_CONFIG): MatchDeps {
  return Object.freeze({ config, rng: createRng(seed) });
}
