/**
 * The techniques of the anime row (WeaponDef.technique): how each is aimed, and the hand over to its
 * timeline in the sim (sim/techniques/*.ts). The shot stays open until the sim reports it done
 * (FireResult.sequence), as with the supers before them.
 *
 * - Antares: the needles go along the aim; the first worm on it before a wall is the victim.
 * - The Galaxian Explosion, the Hiken: thrown along the aim from the hands.
 * - The Tesoro del Cielo: locks the nearest enemy in plain sight within reach, by the Freezer's rule.
 * - Fujitora's meteor: called down on the point the player clicked.
 * - The Santoryu: the square ahead along the aim.
 * - Zoltraak: the beams meet at the first land or worm along the aim.
 * - The Explosión Final: no aim at all, it goes off where the worm stands.
 */

import { WORM_HEIGHT } from '../../sim/constants.ts';
import { firstWormOnLine, landOnLine } from '../../sim/techniques/common.ts';
import { spawnDice } from '../../sim/techniques/dice.ts';
import { spawnFinal } from '../../sim/techniques/final.ts';
import { spawnGalaxy } from '../../sim/techniques/galaxy.ts';
import { spawnHiken } from '../../sim/techniques/hiken.ts';
import { spawnMeteor } from '../../sim/techniques/meteor.ts';
import { needleTip, spawnNeedle } from '../../sim/techniques/needle.ts';
import { spawnTreasureCast } from '../../sim/techniques/treasure.ts';
import { meetingPoint, spawnZoltraak } from '../../sim/techniques/zoltraak.ts';
import { wormMiddleY } from '../../sim/worm-size.ts';
import { lockTarget } from './combo.ts';
import { aimDirection, endsAfter, muzzlePoint, type FireContext, type FireResult } from './types.ts';

const SEQUENCE: FireResult = Object.freeze({ endsTurn: true, shotsRemaining: 0, sequence: true });

/** Antares: the first worm along the aim from the fingertip, before the needles meet a wall. */
function fireNeedle(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  if (spec?.kind !== 'needle') return endsAfter(0);
  const tip = needleTip(worm.x, worm.y, worm.facing);
  const dir = aimDirection(worm, ctx.aim.angleDeg);
  const land = landOnLine(world, tip.x, tip.y, dir.x, dir.y, spec.rangePx);
  const reach = land === null ? spec.rangePx : land.t;
  const hit = firstWormOnLine(world, tip.x, tip.y, dir.x, dir.y, reach, worm.id);
  if (hit !== null) {
    spawnNeedle(world, { weaponId: def.id, attacker: worm, victim: hit.worm, spec, facing: worm.facing, targetX: hit.worm.x, targetY: wormMiddleY(hit.worm) });
  } else {
    spawnNeedle(world, { weaponId: def.id, attacker: worm, victim: null, spec, facing: worm.facing, targetX: tip.x + dir.x * reach, targetY: tip.y + dir.y * reach });
  }
  return SEQUENCE;
}

function fireThrown(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  const hands = muzzlePoint(worm);
  const dir = aimDirection(worm, ctx.aim.angleDeg);
  if (spec?.kind === 'galaxy') spawnGalaxy(world, { weaponId: def.id, attacker: worm, spec, x0: hands.x, y0: hands.y, dx: dir.x, dy: dir.y });
  else if (spec?.kind === 'hiken') spawnHiken(world, { weaponId: def.id, attacker: worm, spec, x0: hands.x, y0: hands.y, dx: dir.x, dy: dir.y });
  else return endsAfter(0);
  return SEQUENCE;
}

/** The Tesoro del Cielo: the nearest enemy in plain sight within reach; nobody, and the wheel turns over nothing. */
function fireTreasure(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  if (spec?.kind !== 'treasure') return endsAfter(0);
  const target = lockTarget(world, worm, spec.rangePx);
  const facing: 1 | -1 = target === null ? worm.facing : target.x > worm.x ? 1 : target.x < worm.x ? -1 : worm.facing;
  spawnTreasureCast(world, { weaponId: def.id, caster: worm, target, spec, facing });
  return SEQUENCE;
}

/** Fujitora's meteor: on the point clicked, or straight ahead of the worm when there is none. */
function fireMeteor(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  if (spec?.kind !== 'meteor') return endsAfter(0);
  const target = ctx.aim.targetPoint ?? { x: worm.x + worm.facing * 120, y: worm.y };
  spawnMeteor(world, { weaponId: def.id, attacker: worm, spec, targetX: target.x, targetY: target.y });
  return SEQUENCE;
}

function fireDice(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  if (spec?.kind !== 'dice') return endsAfter(0);
  spawnDice(world, { weaponId: def.id, attacker: worm, spec, facing: worm.facing, angleDeg: ctx.aim.angleDeg });
  return SEQUENCE;
}

function fireZoltraak(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  if (spec?.kind !== 'zoltraak') return endsAfter(0);
  const hands = muzzlePoint(worm);
  const dir = aimDirection(worm, ctx.aim.angleDeg);
  const meet = meetingPoint(world, spec, hands.x, hands.y, dir.x, dir.y, worm.id);
  spawnZoltraak(world, { weaponId: def.id, attacker: worm, spec, facing: worm.facing, targetX: meet.x, targetY: meet.y });
  return SEQUENCE;
}

/** Hands a technique to its timeline in the sim; the row's own call first, for the mixer. */
export function fireTechnique(ctx: FireContext): FireResult {
  const spec = ctx.def.technique;
  if (spec === undefined) return endsAfter(0);
  ctx.world.events.push({ type: 'sound', id: ctx.def.sfx.fire, x: ctx.worm.x, y: ctx.worm.y - WORM_HEIGHT / 2 });
  switch (spec.kind) {
    case 'needle':
      return fireNeedle(ctx);
    case 'galaxy':
    case 'hiken':
      return fireThrown(ctx);
    case 'treasure':
      return fireTreasure(ctx);
    case 'meteor':
      return fireMeteor(ctx);
    case 'dice':
      return fireDice(ctx);
    case 'zoltraak':
      return fireZoltraak(ctx);
    case 'final':
      return fireFinal(ctx);
  }
}

/** The Explosión Final: nothing to aim, it goes off where the worm stands. */
function fireFinal(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.technique;
  if (spec?.kind !== 'final') return endsAfter(0);
  spawnFinal(world, { weaponId: def.id, attacker: worm, spec });
  return SEQUENCE;
}
