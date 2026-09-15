/**
 * Charged and timed projectile launch: the bazooka and homing missile (contact or homing), the
 * mortar (clusters on impact), and the four fused grenades (bounce until the fuse ends). One
 * function serves both kinds; the def's fuse and cluster fields decide the behavior.
 */

import { spawnProjectile } from '../../sim/projectile.ts';
import type { WeaponDef } from '../types.ts';
import { aimDirection, endsAfter, muzzlePoint, type FireContext, type FireResult } from './types.ts';

function homingTargetFor(def: WeaponDef, ctx: FireContext): { readonly x: number; readonly y: number } | null {
  if (def.projectile?.homing === undefined) return null;
  if (ctx.aim.targetPoint !== undefined) return ctx.aim.targetPoint;
  // No explicit target: the nearest enemy worm, so the CPU and a quick fire both work.
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const worm of ctx.world.worms) {
    if (!worm.alive || worm.teamId === ctx.worm.teamId) continue;
    const d = Math.hypot(worm.x - ctx.worm.x, worm.y - ctx.worm.y);
    if (d < bestDist) {
      bestDist = d;
      best = { x: worm.x, y: worm.y };
    }
  }
  return best;
}

export function fireProjectile(ctx: FireContext): FireResult {
  const { def, aim, worm, world } = ctx;
  const spec = def.projectile;
  const blast = def.blast;
  if (spec === undefined || blast === undefined) return endsAfter(0);
  const muzzle = muzzlePoint(worm);
  const dir = aimDirection(worm, aim.angleDeg);
  const speed = def.charged ? def.maxPower * Math.max(0.05, aim.power) : def.maxPower;
  spawnProjectile(world, {
    weaponId: def.id,
    ownerTeamId: worm.teamId,
    ownerWormId: worm.id,
    x: muzzle.x,
    y: muzzle.y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    spec,
    blast,
    cluster: def.cluster ?? null,
    windAffected: def.windAffected,
    gravityScale: def.gravityScale,
    fuseMs: def.fuse === undefined ? null : (aim.fuseMs ?? def.fuse.defaultMs),
    restBeforeDetonate: def.fuse?.restBeforeDetonate ?? false,
    homingTarget: homingTargetFor(def, ctx),
  });
  world.events.push({ type: 'sound', id: def.sfx.fire, x: muzzle.x, y: muzzle.y });
  const shotsRemaining = def.shotsPerTurn - 1 - ctx.shotIndex;
  return endsAfter(shotsRemaining);
}
