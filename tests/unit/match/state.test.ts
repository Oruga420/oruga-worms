import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import {
  MATCH_LOG_CAP,
  MATCH_PHASES,
  WIND_STEP_COUNT,
  WIND_STEP_MAX,
  WIND_STEP_MIN,
  clampWindStep,
  makeWindState,
  windFractionFromStep,
} from '@/match/state.ts';

describe('match state: wind', () => {
  it('has 21 discrete steps, matching the config', () => {
    expect(WIND_STEP_MIN).toBe(-10);
    expect(WIND_STEP_MAX).toBe(10);
    expect(WIND_STEP_COUNT).toBe(21);
    expect(WIND_STEP_COUNT).toBe(GAME_CONFIG.wind.steps);
  });

  it('derives the fraction of gravity from the step', () => {
    expect(windFractionFromStep(10)).toBeCloseTo(1.19, 9);
    expect(windFractionFromStep(-10)).toBeCloseTo(-1.19, 9);
    expect(windFractionFromStep(5)).toBeCloseTo(0.595, 9);
    expect(windFractionFromStep(0)).toBe(0);
  });

  it('clamps and rounds steps', () => {
    expect(clampWindStep(12)).toBe(10);
    expect(clampWindStep(-40)).toBe(-10);
    expect(clampWindStep(2.6)).toBe(3);
  });

  it('builds a frozen wind state', () => {
    const wind = makeWindState(7);
    expect(wind).toEqual({ step: 7, fraction: windFractionFromStep(7) });
    expect(Object.isFrozen(wind)).toBe(true);
  });
});

describe('match state: phases and log', () => {
  it('includes the hot seat and the resolving phases', () => {
    expect(MATCH_PHASES).toContain('HotSeat');
    expect(MATCH_PHASES).toContain('Resolving');
    expect(MATCH_PHASES[0]).toBe('TurnStart');
    expect(MATCH_PHASES.at(-1)).toBe('MatchEnd');
  });

  it('caps the match log ring at 200 entries', () => {
    expect(MATCH_LOG_CAP).toBe(200);
  });
});
