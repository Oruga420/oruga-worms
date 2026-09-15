/**
 * Melee weapons (fire punch, baseball bat): an arc hit test in front of the worm that damages
 * and throws the worms it catches. The bat's huge horizontal knockback is the classic water kill
 * (throwRangePx documents the 643 px at 45 degrees). Fire punch cuts the land above it.
 */

import { degToRad } from '../../core/math.ts';
import { MELEE_KNOCKBACK_SCALE, WORM_HEIGHT } from '../../sim/constants.ts';
import { carve } from '../../terrain/terrain.ts';
import type { MeleeSpec } from '../types.ts';
import { endsAfter, muzzlePoint, type FireContext, type FireResult } from './types.ts';

function withinArc(ctx: FireContext, melee: MeleeSpec, wx: number, wy: number): boolean {
  const ox = ctx.worm.x;
  const oy = ctx.worm.y - WORM_HEIGHT / 2;
  const dx = wx - ox;
  const dy = wy - WORM_HEIGHT / 2 - oy;
  const dist = Math.hypot(dx, dy);
  if (dist > melee.reachPx || dist === 0) return false;
  const facingDot = (dx * ctx.worm.facing) / dist;
  const cosHalf = Math.cos(degToRad(melee.arcDeg / 2));
  return facingDot >= cosHalf - 0.2;
}

export function fireMelee(ctx: FireContext): FireResult {
  const melee = ctx.def.melee;
  if (melee === undefined) return endsAfter(0);
  const muzzle = muzzlePoint(ctx.worm);
  ctx.world.events.push({ type: 'sound', id: ctx.def.sfx.fire, x: muzzle.x, y: muzzle.y });
  for (const worm of ctx.world.worms) {
    if (!worm.alive || worm.id === ctx.worm.id) continue;
    if (!withinArc(ctx, melee, worm.x, worm.y)) continue;
    ctx.world.events.push({ type: 'damage', wormId: worm.id, amount: melee.damage, sourceTeamId: ctx.worm.teamId, sourceWormId: ctx.worm.id, cause: 'melee' });
    worm.vx += melee.knockback.x * ctx.worm.facing * MELEE_KNOCKBACK_SCALE;
    worm.vy -= melee.knockback.y * MELEE_KNOCKBACK_SCALE;
    worm.motion = 'flying';
    worm.onGround = false;
    worm.exemptNextLanding = false;
  }
  if (melee.carveRadiusPx !== undefined && melee.carveRadiusPx > 0) {
    carve(ctx.world.terrain, Math.round(muzzle.x + ctx.worm.facing * melee.reachPx * 0.4), Math.round(muzzle.y - melee.reachPx * 0.4), melee.carveRadiusPx);
    ctx.world.events.push({ type: 'activity', kind: 'carve' });
  }
  return endsAfter(ctx.def.shotsPerTurn - 1 - ctx.shotIndex);
}
