/**
 * Frozen gameplay tunables, from the "Reconciled constants" card of ultraplan.html rev 2
 * (architecture.md loses where it differs). Every number here is a canonical Worms Armageddon
 * Intermediate scheme value as decoded by the C2 refuter, or a decision the plan states.
 *
 * Per frame quantities are in SOURCE px per logic frame and must pass through
 * config/units.ts before they touch the 60 Hz simulation.
 */

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export const GAME_CONFIG = deepFreeze({
  /** Turn clock. */
  turnMs: 45_000,
  /** Hot seat pause between turns, so the next player can take the keyboard. */
  hotSeatMs: 5_000,
  /** Retreat window after the last shot, worm on the ground. */
  retreatGroundMs: 3_000,
  /** Retreat window on a controlled descent (parachute, jetpack; rope in phase 2). */
  retreatAirMs: 5_000,
  /** Round length before sudden death. */
  roundMs: 900_000,
  /** Sudden death: every worm to hpCap once, then the water rises each turn. */
  suddenDeath: { hpCap: 1, waterRisePxPerTurn: 20 },
  wormHp: 100,
  /** World px. */
  wormHitbox: { w: 9, h: 16 },
  /**
   * DAMAGE = INT(((VSPEED - 8 + 1/65536) * 50 + 18) / 18), VSPEED in source px per logic frame.
   * At the terminal 32 px per frame the formula gives 67, which is the cap. The first landing
   * after a blast is exempt (exemptNextLanding) and taking fall damage ends the turn.
   */
  fallDamage: {
    thresholdPxPerFrame: 8,
    terminalPxPerFrame: 32,
    coefficient: 50,
    epsilon: 1 / 65536,
    formula: 'INT(((VSPEED - 8 + 1/65536) * 50 + 18) / 18)',
    max: 67,
  },
  /** 21 discrete steps (-10..10); step 10 is 119 percent of gravity on a bazooka shell. Rerolled every turn. */
  wind: { steps: 21, maxFractionOfGravity: 1.19 },
  /** Scheduled supply drop every three completed turns; percentages weight the random kind. */
  crates: { weaponPct: 20, healthPct: 8, utilityPct: 8, maxOnMap: 5, healthAmount: 25, dropEveryTurns: 3 },
  /**
   * Movement budget per turn. A step is stepPx of real
   * horizontal displacement while walking; at the 60 px per second walk speed 10 steps of 32 px
   * is about 5 s of walking, roughly a sixth of a map. A jump spends jumpStepCost steps up front
   * because it covers more ground than a stride. Applies in the Active phase only: the retreat
   * window is already capped by its own timer.
   */
  movement: { stepsPerTurn: 10, stepPx: 32, jumpStepCost: 2 },
  /**
   * Resolving phase caps: inactivityMs resets on every bounce, carve, damage event or spawn;
   * absoluteMs is the hard ceiling. Controlled descents are exempt from the inactivity timer.
   */
  resolve: { inactivityMs: 8_000, absoluteMs: 45_000 },
  /** Placed mine fuse is fixed; map mines draw a fuse in [mapFuseMinMs, mapFuseMaxMs] and may dud. */
  mines: { placedFuseMs: 3_000, mapFuseMinMs: 0, mapFuseMaxMs: 3_000, dudChance: 0 },
  /** Grenade restitution presets, MAX by default (the source default is undocumented; v1 choice). */
  grenadeBounce: { max: { x: 0.96, y: 0.6 }, min: { x: 0.96, y: 0.3 }, default: 'max' },
  /** Device pixel ratio policy: cap, and step down (1.5 then 1) when the average frame exceeds stepDownAtMs. */
  dpr: { cap: 2, stepDownAtMs: 14 },
} as const);

export type GameConfig = typeof GAME_CONFIG;
