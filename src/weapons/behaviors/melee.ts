/**
 * Melee weapons (fire punch, baseball bat): an arc hit test in front of the worm that damages
 * and throws the worms it catches. The bat's huge horizontal knockback is the classic water kill
 * (throwRangePx documents the 643 px at 45 degrees). Fire punch cuts the land above it. A melee
 * row with a combo block is a super move and plays out over time instead (combo.ts), and so is
 * one with a devour block, Gear 5 (devour.ts).
 */

import { degToRad } from '../../core/math.ts';
import { MELEE_KNOCKBACK_SCALE } from '../../sim/constants.ts';
import type { WormBody } from '../../sim/types.ts';
import { wormHeight, wormMiddleY } from '../../sim/worm-size.ts';
import { carve } from '../../terrain/terrain.ts';
import type { MeleeSpec } from '../types.ts';
import { fireCombo } from './combo.ts';
import { fireDevour } from './devour.ts';
import { endsAfter, muzzlePoint, type FireContext, type FireResult } from './types.ts';

function withinArc(ctx: FireContext, melee: MeleeSpec, target: WormBody): boolean {
  const ox = ctx.worm.x;
  const oy = wormMiddleY(ctx.worm);
  const dx = target.x - ox;
  const dy = wormMiddleY(target) - oy;
  const dist = Math.hypot(dx, dy);
  if (dist > melee.reachPx || dist === 0) return false;
  const facingDot = (dx * ctx.worm.facing) / dist;
  const cosHalf = Math.cos(degToRad(melee.arcDeg / 2));
  return facingDot >= cosHalf - 0.2;
}

export function fireMelee(ctx: FireContext): FireResult {
  if (ctx.def.combo !== undefined) return fireCombo(ctx);
  if (ctx.def.devour !== undefined) return fireDevour(ctx);
  const melee = ctx.def.melee;
  if (melee === undefined) return endsAfter(0);
  const muzzle = muzzlePoint(ctx.worm);
  ctx.world.events.push({ type: 'sound', id: ctx.def.sfx.fire, x: muzzle.x, y: muzzle.y });
  ctx.world.events.push({ type: 'swing', wormId: ctx.worm.id, weaponId: ctx.def.id, x: muzzle.x, y: muzzle.y, facing: ctx.worm.facing });
  // The blow's direction: along the knockback, so the blood flies where the victim goes.
  const push = Math.hypot(melee.knockback.x, melee.knockback.y) || 1;
  const dir = { dx: (melee.knockback.x / push) * ctx.worm.facing, dy: -melee.knockback.y / push };
  for (const worm of ctx.world.worms) {
    if (!worm.alive || worm.id === ctx.worm.id) continue;
    if (!withinArc(ctx, melee, worm)) continue;
    const at = { x: worm.x - ctx.worm.facing * 3, y: worm.y - wormHeight(worm) * 0.6, ...dir };
    ctx.world.events.push({ type: 'damage', wormId: worm.id, amount: melee.damage, sourceTeamId: ctx.worm.teamId, sourceWormId: ctx.worm.id, cause: 'melee', at });
    if (ctx.def.sfx.impact !== undefined) ctx.world.events.push({ type: 'sound', id: ctx.def.sfx.impact, x: worm.x, y: worm.y });
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
