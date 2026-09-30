import { describe, expect, it } from 'vitest';
import { NO_CINEMATIC, cinematicFor } from '@/game/cinematic.ts';
import type { BeamBody, BeamStage, ComboBody, ComboStage, DevourBody, DevourStage } from '@/sim/types.ts';
import { drumTicks } from '@/sim/devour.ts';
import { WEAPONS } from '@/weapons/registry.ts';

function combo(stage: ComboStage, stageTicks: number, victimId: string | null = 'v', hitsLanded = 0): ComboBody {
  return {
    id: 1,
    weaponId: 'ryuko_ranbu',
    attackerId: 'a',
    ownerTeamId: 't',
    victimId,
    spec: WEAPONS.ryuko_ranbu.combo!,
    stage,
    stageTicks,
    fromX: 0,
    fromY: 0,
    toX: 10,
    toY: 0,
    restX: 10,
    restY: 0,
    holdX: 24,
    holdY: 0,
    facing: 1,
    hitsLanded,
    alive: true,
  };
}

describe('cinematic', () => {
  it('does nothing without a live combo', () => {
    expect(cinematicFor([])).toBe(NO_CINEMATIC);
    expect(cinematicFor([{ ...combo('flurry', 3), alive: false }])).toBe(NO_CINEMATIC);
  });

  it('dims and pulls in during the super freeze, with the aura up', () => {
    const c = cinematicFor([combo('startup', 30)]);
    expect(c.whiteout).toBe(0);
    expect(c.dim).toBeGreaterThan(0.4);
    expect(c.zoom).toBeGreaterThan(1.1);
    expect(c.aura).toBeGreaterThan(0.5);
  });

  it('turns the screen white for the beating, and flares it on every blow', () => {
    const between = cinematicFor([combo('flurry', 3)]);
    const onBlow = cinematicFor([combo('flurry', 1)]);
    expect(between.whiteout).toBeGreaterThan(0.9);
    expect(onBlow.whiteout).toBe(1);
    expect(onBlow.zoom).toBeGreaterThan(between.zoom);
    expect(cinematicFor([combo('finisher', 1)]).whiteout).toBe(1);
  });

  it('lets the world come back after the finisher', () => {
    const early = cinematicFor([combo('recover', 1, 'v', 16)]);
    const late = cinematicFor([combo('recover', 40, 'v', 16)]);
    expect(early.whiteout).toBeGreaterThan(late.whiteout);
    expect(late.whiteout).toBe(0);
    expect(late.zoom).toBeLessThan(early.zoom);
  });

  it('never whites out a whiffed rush', () => {
    expect(cinematicFor([combo('dash', 10, null)]).whiteout).toBe(0);
    expect(cinematicFor([combo('recover', 1, null)]).whiteout).toBe(0);
  });
});

function beam(stage: BeamStage, stageTicks: number, length = 0): BeamBody {
  return {
    id: 2,
    weaponId: 'kamehameha',
    attackerId: 'a',
    ownerTeamId: 't',
    spec: WEAPONS.kamehameha.beam!,
    stage,
    stageTicks,
    x0: 0,
    y0: 0,
    dx: 1,
    dy: 0,
    holdX: 0,
    holdY: 0,
    facing: 1,
    length,
    maxLength: 640,
    carved: 0,
    hit: [],
    alive: true,
  };
}

describe('cinematic: the beam', () => {
  it('darkens and closes in on the worm as the ki gathers, with the aura building', () => {
    const early = cinematicFor([], [beam('charge', 10)]);
    const late = cinematicFor([], [beam('charge', 80)]);
    expect(late.dim).toBeGreaterThan(early.dim);
    expect(late.zoom).toBeGreaterThan(early.zoom);
    expect(late.aura).toBeGreaterThan(early.aura);
    expect(late.whiteout).toBe(0);
  });

  it('pulls back to take in the whole beam, then lets the world back as it fades', () => {
    const out = cinematicFor([], [beam('fire', 5, 640)]);
    expect(out.zoom).toBeLessThan(1);
    expect(out.dim).toBeGreaterThan(0.3);
    const gone = cinematicFor([], [beam('fade', 1000)]);
    expect(gone.dim).toBeCloseTo(0, 6);
    expect(gone.zoom).toBeCloseTo(1, 6);
    expect(cinematicFor([], [{ ...beam('fire', 5, 300), alive: false }])).toBe(NO_CINEMATIC);
  });

  it('a live combo takes the screen over a beam', () => {
    expect(cinematicFor([combo('flurry', 3)], [beam('charge', 80)]).whiteout).toBeGreaterThan(0.9);
  });
});

function devour(stage: DevourStage, stageTicks: number): DevourBody {
  return {
    id: 3,
    weaponId: 'gear_five',
    attackerId: 'a',
    ownerTeamId: 't',
    victimId: 'v',
    spec: WEAPONS.gear_five.devour!,
    stage,
    stageTicks,
    holdX: 0,
    holdY: 0,
    facing: 1,
    shoulderX: 4,
    shoulderY: -9,
    reachX: 100,
    reachY: -8,
    grabX: 100,
    grabY: 0,
    mouthX: 11,
    mouthY: -7,
    chomps: 0,
    swallowed: false,
    burped: false,
    alive: true,
  };
}

describe('cinematic: gear 5', () => {
  const SPEC = WEAPONS.gear_five.devour!;
  const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));

  it('darkens the world and closes in a step on every drum as the worm awakens', () => {
    const start = cinematicFor([], [], [devour('awaken', 1)]);
    const late = cinematicFor([], [], [devour('awaken', ticks(SPEC.awakenMs) - 1)]);
    expect(start.dim).toBeLessThan(late.dim);
    expect(late.zoom).toBeGreaterThan(1.2);
    const drum = drumTicks(SPEC)[1]!;
    expect(cinematicFor([], [], [devour('awaken', drum)]).zoom).toBeGreaterThan(cinematicFor([], [], [devour('awaken', drum - 1)]).zoom);
    expect(late.whiteout).toBe(0);
  });

  it('pulls back for the arm, pushes in on the meal and eases off at the end', () => {
    const arm = cinematicFor([], [], [devour('stretch', ticks(SPEC.stretchMs))]);
    const meal = cinematicFor([], [], [devour('chew', 5)]);
    expect(arm.zoom).toBeLessThan(meal.zoom);
    expect(meal.dim).toBeGreaterThan(0);
    expect(cinematicFor([], [], [devour('recover', ticks(SPEC.recoverMs))])).toEqual({ ...NO_CINEMATIC, dim: 0 });
    expect(cinematicFor([], [], [{ ...devour('chew', 5), alive: false }])).toBe(NO_CINEMATIC);
  });
});
