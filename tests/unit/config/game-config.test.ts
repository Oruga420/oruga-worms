import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';

describe('game config', () => {
  it('is frozen at every level', () => {
    const nested: readonly object[] = [
      GAME_CONFIG,
      GAME_CONFIG.suddenDeath,
      GAME_CONFIG.wormHitbox,
      GAME_CONFIG.fallDamage,
      GAME_CONFIG.wind,
      GAME_CONFIG.crates,
      GAME_CONFIG.resolve,
      GAME_CONFIG.mines,
      GAME_CONFIG.grenadeBounce,
      GAME_CONFIG.grenadeBounce.max,
      GAME_CONFIG.grenadeBounce.min,
      GAME_CONFIG.dpr,
    ];
    for (const value of nested) expect(Object.isFrozen(value)).toBe(true);
  });

  it('rejects mutation instead of silently accepting it', () => {
    const mutable = GAME_CONFIG as unknown as { turnMs: number; wind: { steps: number } };
    expect(() => {
      mutable.turnMs = 1;
    }).toThrow(TypeError);
    expect(() => {
      mutable.wind.steps = 3;
    }).toThrow(TypeError);
    expect(GAME_CONFIG.turnMs).toBe(45_000);
    expect(GAME_CONFIG.wind.steps).toBe(21);
  });

  it('carries the reconciled constants of the plan', () => {
    expect(GAME_CONFIG.turnMs).toBe(45_000);
    expect(GAME_CONFIG.hotSeatMs).toBe(5_000);
    expect(GAME_CONFIG.retreatGroundMs).toBe(3_000);
    expect(GAME_CONFIG.retreatAirMs).toBe(5_000);
    expect(GAME_CONFIG.roundMs).toBe(900_000);
    expect(GAME_CONFIG.suddenDeath).toEqual({ hpCap: 1, waterRisePxPerTurn: 20 });
    expect(GAME_CONFIG.wormHp).toBe(100);
    expect(GAME_CONFIG.wormHitbox).toEqual({ w: 9, h: 16 });
    expect(GAME_CONFIG.wind).toEqual({ steps: 21, maxFractionOfGravity: 1.19 });
    // Crate kind weights preserve the configured weapon/health/utility proportions; the original 6.7/3.3/3.3
    // made one fall every seven or eight turns and read as "crates never fall".
    expect(GAME_CONFIG.crates).toEqual({ weaponPct: 20, healthPct: 8, utilityPct: 8, maxOnMap: 5, healthAmount: 25, dropEveryTurns: 3 });
    expect(GAME_CONFIG.movement).toEqual({ stepsPerTurn: 10, stepPx: 32, jumpStepCost: 2 });
    expect(GAME_CONFIG.resolve).toEqual({ inactivityMs: 8_000, absoluteMs: 45_000 });
    expect(GAME_CONFIG.mines).toEqual({ placedFuseMs: 3_000, mapFuseMinMs: 0, mapFuseMaxMs: 3_000, dudChance: 0 });
    expect(GAME_CONFIG.grenadeBounce.max).toEqual({ x: 0.96, y: 0.6 });
    expect(GAME_CONFIG.grenadeBounce.min).toEqual({ x: 0.96, y: 0.3 });
    expect(GAME_CONFIG.grenadeBounce.default).toBe('max');
    expect(GAME_CONFIG.dpr).toEqual({ cap: 2, stepDownAtMs: 14 });
  });

  it('documents a fall damage formula that gives 67 at terminal speed and nothing below the threshold', () => {
    const { thresholdPxPerFrame, terminalPxPerFrame, coefficient, epsilon, max, formula } = GAME_CONFIG.fallDamage;
    const damage = (vspeed: number): number =>
      Math.max(0, Math.floor(((vspeed - thresholdPxPerFrame + epsilon) * coefficient + 18) / 18));
    expect(thresholdPxPerFrame).toBe(8);
    expect(terminalPxPerFrame).toBe(32);
    expect(damage(terminalPxPerFrame)).toBe(max);
    expect(max).toBe(67);
    expect(damage(7)).toBe(0);
    expect(damage(9)).toBeGreaterThan(0);
    expect(formula).toBe('INT(((VSPEED - 8 + 1/65536) * 50 + 18) / 18)');
  });
});
