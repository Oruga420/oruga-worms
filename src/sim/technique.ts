/**
 * The techniques of the anime row in the sim: Antares, the Galaxian Explosion, the Tesoro del Cielo,
 * the Hiken, Fujitora's meteor, the Santoryu, Zoltraak and the Explosión Final. Each is a timeline of its own module
 * (sim/techniques/*.ts); they all live in one list, world.techniques, and the world steps, holds,
 * cancels and times them through here, by kind, so a new one is a module and a line in each switch.
 *
 * Like the supers before them they HOLD their worms while they play (stepWorld skips a held worm in
 * the worm controller) and keep the shot open until they are done (FireResult.sequence).
 */

import type { TechniqueBody } from './types.ts';
import type { SimWorld } from './world.ts';
import { cancelDice, diceHolds, diceStageLength, stepDice } from './techniques/dice.ts';
import { cancelFinal, finalHolds, finalStageLength, stepFinal } from './techniques/final.ts';
import { cancelGalaxy, galaxyHolds, galaxyStageLength, stepGalaxy } from './techniques/galaxy.ts';
import { cancelHiken, hikenHolds, hikenStageLength, stepHiken } from './techniques/hiken.ts';
import { cancelMeteor, meteorHolds, meteorStageLength, stepMeteor } from './techniques/meteor.ts';
import { cancelNeedle, needleHolds, needleStageLength, stepNeedle } from './techniques/needle.ts';
import { cancelTreasure, stepTreasure, treasureHolds, treasureStageLength } from './techniques/treasure.ts';
import { cancelZoltraak, stepZoltraak, zoltraakHolds, zoltraakStageLength } from './techniques/zoltraak.ts';

const NOBODY: ReadonlySet<string> = new Set();

/** One tick of a technique. Runs after the worm controller, so its placements are final for the tick. */
export function stepTechnique(world: SimWorld, body: TechniqueBody): void {
  if (!body.alive) return;
  switch (body.kind) {
    case 'needle':
      return stepNeedle(world, body);
    case 'galaxy':
      return stepGalaxy(world, body);
    case 'treasure':
      return stepTreasure(world, body);
    case 'hiken':
      return stepHiken(world, body);
    case 'meteor':
      return stepMeteor(world, body);
    case 'dice':
      return stepDice(world, body);
    case 'zoltraak':
      return stepZoltraak(world, body);
    case 'final':
      return stepFinal(world, body);
  }
}

/** Ids of the worms live techniques hold this tick. */
export function heldByTechniques(techniques: readonly TechniqueBody[]): ReadonlySet<string> {
  if (techniques.length === 0) return NOBODY;
  const held = new Set<string>();
  for (const body of techniques) {
    if (!body.alive) continue;
    switch (body.kind) {
      case 'needle':
        needleHolds(body, held);
        break;
      case 'galaxy':
        galaxyHolds(body, held);
        break;
      case 'treasure':
        treasureHolds(body, held);
        break;
      case 'hiken':
        hikenHolds(body, held);
        break;
      case 'meteor':
        meteorHolds(body, held);
        break;
      case 'dice':
        diceHolds(body, held);
        break;
      case 'zoltraak':
        zoltraakHolds(body, held);
        break;
      case 'final':
        finalHolds(body, held);
        break;
    }
  }
  return held;
}

/** Ticks the current stage lasts. */
export function techniqueStageLength(body: TechniqueBody): number {
  switch (body.kind) {
    case 'needle':
      return needleStageLength(body);
    case 'galaxy':
      return galaxyStageLength(body);
    case 'treasure':
      return treasureStageLength(body);
    case 'hiken':
      return hikenStageLength(body);
    case 'meteor':
      return meteorStageLength(body);
    case 'dice':
      return diceStageLength(body);
    case 'zoltraak':
      return zoltraakStageLength(body);
    case 'final':
      return finalStageLength(body);
  }
}

/** 0..1 through the current stage, for the presentation. */
export function techniqueProgress(body: TechniqueBody): number {
  return Math.min(1, Math.max(0, body.stageTicks / Math.max(1, techniqueStageLength(body))));
}

/**
 * Ends every live technique on the spot and lets its worms go. For a match that ends mid technique
 * (a surrender): the sim is not stepped after MatchEnd, so one left alive would never finish.
 */
export function cancelTechniques(world: SimWorld): void {
  for (const body of world.techniques) {
    if (!body.alive) continue;
    switch (body.kind) {
      case 'needle':
        cancelNeedle(world, body);
        break;
      case 'galaxy':
        cancelGalaxy(world, body);
        break;
      case 'treasure':
        cancelTreasure(world, body);
        break;
      case 'hiken':
        cancelHiken(world, body);
        break;
      case 'meteor':
        cancelMeteor(world, body);
        break;
      case 'dice':
        cancelDice(world, body);
        break;
      case 'zoltraak':
        cancelZoltraak(world, body);
        break;
      case 'final':
        cancelFinal(world, body);
        break;
    }
  }
  world.techniques = world.techniques.filter((t) => t.alive);
}

/** A technique still playing. */
export function techniquePlaying(world: { readonly techniques?: readonly TechniqueBody[] }): boolean {
  return (world.techniques ?? []).some((t) => t.alive);
}
