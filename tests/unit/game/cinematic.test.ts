import { describe, expect, it } from 'vitest';
import { NO_CINEMATIC, cinematicFor } from '@/game/cinematic.ts';
import type { ComboBody, ComboStage } from '@/sim/types.ts';
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
