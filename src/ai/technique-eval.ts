/**
 * The CPU's reading of the anime row's techniques (heuristic.ts asks here): where each would land
 * from a spot and a facing, by the sim's own rules, and what that is worth, enemies less friends
 * (twice) and the worm itself (three times). The price is not counted here: heuristic.ts takes the
 * toll off every candidate, and the Tesoro del Cielo's strikes are counted with its value below.
 *
 * - Antares: the first worm on the line to an enemy, before any land: a kill, its whole health.
 * - The Galaxian Explosion: where the galaxy stops on the line, and every worm in the kill radius.
 * - The Tesoro del Cielo: the worm the lock picks; a kill, plus the turns it sits out (whole turns
 *   of its team when it is the last), less the strikes the caster pays for, and never when the
 *   strikes would take all the caster has.
 * - The Hiken: where the fist stops on the line, and its blast.
 * - Fujitora's meteor: called on each enemy, where the rock would really come down, and its blast.
 * - The Santoryu: the square ahead at a fan of aims, and every worm in it.
 * - Zoltraak: the beams meeting on the first thing along the line to an enemy.
 * - The Explosión Final: where the worm stands, everyone in the radius, itself first of all: only
 *   worth it when the enemies in reach are worth more than the worm three times over.
 */

import { degToRad } from '../core/math.ts';
import { discBlocked, sweep } from '../sim/collision.ts';
import { THROWN_CORE_PX } from '../sim/techniques/common.ts';
import { diceSquare } from '../sim/techniques/dice.ts';
import { meteorPath } from '../sim/techniques/meteor.ts';
import { needleTip } from '../sim/techniques/needle.ts';
import { CIRCLE_CLEARANCE_PX, circleSpots } from '../sim/techniques/zoltraak.ts';
import { wormHalfWidth, wormHeight, wormMiddleY } from '../sim/worm-size.ts';
import { blastDamage } from '../sim/damage.ts';
import type { TerrainMask } from '../terrain/mask.ts';
import type { BlastSpec, WeaponDef, WeaponId } from '../weapons/types.ts';
import { pickLockTarget } from '../weapons/behaviors/combo.ts';
import type { WormPoint } from './trajectory.ts';

export interface TechniqueCandidate {
  readonly weapon: WeaponId;
  readonly angleDeg: number;
  readonly power: number;
  readonly score: number;
  readonly confidence: number;
  readonly targetPoint?: { readonly x: number; readonly y: number };
}

export interface TechniqueScene {
  readonly mask: TerrainMask;
  readonly waterY: number;
  readonly team: string;
  readonly worms: readonly WormPoint[];
}

/**
 * What a turn the sealed worm sits out is worth to the CPU, in damage points: a whole turn when it
 * is the last of its team (the team loses the turn), little when the team plays on without it.
 */
export const LOST_TURN_VALUE = 20;
export const SAT_OUT_TURN_VALUE = 5;
/** The aims either side of a straight line to an enemy a thrown technique is also tried at, degrees. */
const AROUND_DEG: readonly number[] = Object.freeze([0, -4, 4]);
/** The Santoryu's fan of aims. */
const DICE_AIMS: readonly number[] = Object.freeze([-90, -60, -30, -15, 0, 15, 30, 60, 90]);

function enemiesOf(scene: TechniqueScene): WormPoint[] {
  return scene.worms.filter((w) => w.alive && w.teamId !== scene.team && w.y < scene.waterY);
}

/** The aim, in the worm's elevation convention, from (x0, y0) to (x1, y1) for a worm facing `facing`; null behind it. */
function aimTo(x0: number, y0: number, x1: number, y1: number, facing: 1 | -1): number | null {
  const dx = (x1 - x0) * facing;
  if (dx <= 0) return null;
  const angle = (Math.atan2(-(y1 - y0), dx) * 180) / Math.PI;
  return Math.max(-85, Math.min(85, angle));
}

function direction(angleDeg: number, facing: 1 | -1): { readonly x: number; readonly y: number } {
  const a = degToRad(angleDeg);
  return { x: Math.cos(a) * facing, y: -Math.sin(a) };
}

/** The first worm (not `skip`) a line passes within its half width and `pad` of, before `range`. */
function firstOnLine(worms: readonly WormPoint[], x0: number, y0: number, dx: number, dy: number, range: number, skip: string, pad: number): { readonly worm: WormPoint; readonly t: number } | null {
  let best: { worm: WormPoint; t: number } | null = null;
  for (const worm of worms) {
    if (!worm.alive || worm.id === skip) continue;
    const cx = worm.x;
    const cy = wormMiddleY(worm);
    const t = (cx - x0) * dx + (cy - y0) * dy;
    if (t < 0 || t > range || (best !== null && t >= best.t)) continue;
    if (Math.abs((cx - x0) * dy - (cy - y0) * dx) <= wormHalfWidth(worm) + pad) best = { worm, t };
  }
  return best;
}

/** Where a body flying along a line stops: land (swept with landRadius), a worm within radius, or the end of its reach. */
function flightEnd(scene: TechniqueScene, x0: number, y0: number, dx: number, dy: number, range: number, radius: number, landRadius: number, skip: string): { readonly x: number; readonly y: number } {
  const path = sweep(scene.mask, x0, y0, x0 + dx * range, y0 + dy * range, landRadius);
  const landT = path.hit === null ? range : Math.hypot(path.x - x0, path.y - y0);
  const worm = firstOnLine(scene.worms, x0, y0, dx, dy, landT + radius, skip, radius);
  const t = worm !== null ? Math.min(landT, Math.max(0, worm.t - radius)) : landT;
  return { x: x0 + dx * t, y: y0 + dy * t };
}

/** What a blast at (x, y) is worth: enemy damage less friendly damage (twice) and the worm's own (three times). */
function blastWorth(scene: TechniqueScene, from: WormPoint, x: number, y: number, blast: Pick<BlastSpec, 'radiusPx' | 'maxDamage'>, times = 1): { readonly score: number; readonly enemy: number } {
  let enemy = 0;
  let friendly = 0;
  for (const worm of scene.worms) {
    if (!worm.alive || worm.y >= scene.waterY) continue;
    const dealt = Math.min(worm.hp, blastDamage(blast.maxDamage, Math.hypot(worm.x - x, wormMiddleY(worm) - y), blast.radiusPx) * times);
    if (dealt <= 0) continue;
    if (worm.id === from.id) friendly += dealt * 3;
    else if (worm.teamId === scene.team) friendly += dealt * 2;
    else enemy += dealt;
  }
  return { score: enemy - friendly, enemy };
}

/** Every worm within `radius` of (x, y) dies: enemies count their health, friends twice, the worm itself three times. */
function killWorth(scene: TechniqueScene, from: WormPoint, x: number, y: number, radius: number): { readonly score: number; readonly enemy: number } {
  let enemy = 0;
  let friendly = 0;
  for (const worm of scene.worms) {
    if (!worm.alive || worm.y >= scene.waterY || Math.hypot(worm.x - x, wormMiddleY(worm) - y) > radius) continue;
    if (worm.id === from.id) friendly += worm.hp * 3;
    else if (worm.teamId === scene.team) friendly += worm.hp * 2;
    else enemy += worm.hp;
  }
  return { score: enemy - friendly, enemy };
}

function better(a: TechniqueCandidate | null, b: TechniqueCandidate | null): TechniqueCandidate | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.score > a.score ? b : a;
}

/** The hands a thrown technique leaves from, as the sim's muzzle (behaviors/types.ts): lower and closer on a Saibaman. */
function hands(from: WormPoint, facing: 1 | -1): { readonly x: number; readonly y: number } {
  return { x: from.x + facing * 6 * (from.size ?? 1), y: from.y - wormHeight(from) * 0.6 };
}

export function evaluateTechnique(scene: TechniqueScene, def: WeaponDef, from: WormPoint, facing: 1 | -1): TechniqueCandidate | null {
  const spec = def.technique;
  if (spec === undefined) return null;
  const enemies = enemiesOf(scene);
  let best: TechniqueCandidate | null = null;
  switch (spec.kind) {
    case 'needle': {
      const tip = needleTip(from.x, from.y, facing);
      for (const enemy of enemies) {
        const angle = aimTo(tip.x, tip.y, enemy.x, wormMiddleY(enemy), facing);
        if (angle === null) continue;
        const dir = direction(angle, facing);
        const wall = sweep(scene.mask, tip.x, tip.y, tip.x + dir.x * spec.rangePx, tip.y + dir.y * spec.rangePx, 0);
        const reach = wall.hit === null ? spec.rangePx : Math.hypot(wall.x - tip.x, wall.y - tip.y);
        const first = firstOnLine(scene.worms, tip.x, tip.y, dir.x, dir.y, reach, from.id, 2);
        if (first === null || first.worm.teamId === scene.team) continue;
        best = better(best, { weapon: def.id, angleDeg: Math.round(angle), power: 1, score: first.worm.hp, confidence: 1 });
      }
      return best;
    }
    case 'galaxy':
    case 'hiken': {
      const start = hands(from, facing);
      for (const enemy of enemies) {
        const straight = aimTo(start.x, start.y, enemy.x, wormMiddleY(enemy), facing);
        if (straight === null) continue;
        for (const off of AROUND_DEG) {
          const angle = Math.max(-85, Math.min(85, straight + off));
          const dir = direction(angle, facing);
          const end = flightEnd(scene, start.x, start.y, dir.x, dir.y, spec.rangePx, spec.radiusPx, THROWN_CORE_PX, from.id);
          const worth = spec.kind === 'galaxy' ? killWorth(scene, from, end.x, end.y, spec.killRadiusPx) : blastWorth(scene, from, end.x, end.y, spec.blast);
          if (worth.enemy <= 0) continue;
          const full = spec.kind === 'galaxy' ? 100 : spec.blast.maxDamage;
          best = better(best, { weapon: def.id, angleDeg: Math.round(angle), power: 1, score: worth.score, confidence: Math.min(1, worth.enemy / full) });
        }
      }
      return best;
    }
    case 'treasure': {
      // The strikes come out of the caster: one that cannot pay for them all never sees the kill.
      if (from.hp <= spec.hitToll * spec.hits) return null;
      const victim = pickLockTarget(scene.mask, { x: from.x, y: from.y, facing }, enemies, spec.rangePx);
      if (victim === null || victim.hp <= 0) return null;
      const alone = !enemies.some((w) => w.teamId === victim.teamId && w.id !== victim.id);
      const turn = alone ? LOST_TURN_VALUE : SAT_OUT_TURN_VALUE;
      return { weapon: def.id, angleDeg: 0, power: 1, score: victim.hp + (turn - spec.hitToll) * spec.hits, confidence: 1 };
    }
    case 'meteor': {
      for (const enemy of enemies) {
        const side: 1 | -1 = enemy.x >= from.x ? 1 : -1;
        if (side !== facing) continue;
        const path = meteorPath(spec, enemy.x, enemy.y, side);
        const end = flightEnd(scene, path.startX, path.startY, path.dx, path.dy, Math.hypot(scene.mask.width, scene.mask.height), spec.radiusPx, spec.radiusPx, '');
        const worth = blastWorth(scene, from, end.x, end.y, spec.blast);
        if (worth.enemy <= 0) continue;
        best = better(best, { weapon: def.id, angleDeg: 60, power: 1, score: worth.score, confidence: Math.min(1, worth.enemy / spec.blast.maxDamage), targetPoint: { x: enemy.x, y: enemy.y } });
      }
      return best;
    }
    case 'dice': {
      for (const angle of DICE_AIMS) {
        const square = diceSquare(spec, from, facing, angle);
        let enemy = 0;
        let friendly = 0;
        for (const worm of scene.worms) {
          if (!worm.alive || worm.id === from.id) continue;
          const middle = wormMiddleY(worm);
          if (worm.x < square.x - 2 || worm.x > square.x + square.side + 2 || middle < square.y - 2 || middle > square.y + square.side + 2) continue;
          const dealt = Math.min(worm.hp, spec.damage);
          if (worm.teamId === scene.team) friendly += dealt * 2;
          else enemy += dealt;
        }
        if (enemy <= 0) continue;
        best = better(best, { weapon: def.id, angleDeg: angle, power: 1, score: enemy - friendly, confidence: Math.min(1, enemy / spec.damage) });
      }
      return best;
    }
    case 'zoltraak': {
      const start = hands(from, facing);
      const circles = circleSpots(spec, from.x, from.y, facing).filter((spot) => !discBlocked(scene.mask, spot.x, spot.y, CIRCLE_CLEARANCE_PX)).length;
      if (circles === 0) return null;
      for (const enemy of enemies) {
        const angle = aimTo(start.x, start.y, enemy.x, wormMiddleY(enemy), facing);
        if (angle === null) continue;
        const dir = direction(angle, facing);
        const end = flightEnd(scene, start.x, start.y, dir.x, dir.y, spec.rangePx, 0, 0, from.id);
        const worth = blastWorth(scene, from, end.x, end.y, spec.beamBlast, circles);
        if (worth.enemy <= 0) continue;
        best = better(best, { weapon: def.id, angleDeg: Math.round(angle), power: 1, score: worth.score, confidence: Math.min(1, worth.enemy / (spec.beamBlast.maxDamage * circles)) });
      }
      return best;
    }
    case 'final': {
      const worth = killWorth(scene, from, from.x, wormMiddleY(from), spec.killRadiusPx);
      if (worth.enemy <= 0 || worth.score <= 0) return null;
      return { weapon: def.id, angleDeg: 0, power: 1, score: worth.score, confidence: 1 };
    }
  }
}
