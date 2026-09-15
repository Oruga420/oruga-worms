/**
 * Hitscan weapons (shotgun, uzi, minigun, handgun): straight pellet rays with no gravity, an
 * optional small carve at the impact, cumulative knockback on the hit worm, and a burst that
 * fires several pellets. The shotgun keeps the turn for its second barrel. Damage is emitted as
 * events; the match reducer applies it.
 */

import { vec2 } from '../../core/math.ts';
import { sweep } from '../../sim/collision.ts';
import { KNOCKBACK_SCALE, WORM_HALF_WIDTH, WORM_HEIGHT } from '../../sim/constants.ts';
import { carve } from '../../terrain/terrain.ts';
import type { HitscanSpec } from '../types.ts';
import { aimDirection, endsAfter, muzzlePoint, type FireContext, type FireResult } from './types.ts';

/** Particle burst radius for a bullet landing, world px: readable, never mistaken for a blast. */
const IMPACT_FX_RADIUS_PX = 6;

/** First worm whose hitbox the ray from (ox, oy) toward (dx, dy) crosses within range. */
function firstWormAlong(ctx: FireContext, ox: number, oy: number, dx: number, dy: number, range: number): { id: string; teamId: string; x: number; y: number } | null {
  let best: { id: string; teamId: string; x: number; y: number } | null = null;
  let bestT = range;
  for (const worm of ctx.world.worms) {
    if (!worm.alive || worm.id === ctx.worm.id) continue;
    const cx = worm.x;
    const cy = worm.y - WORM_HEIGHT / 2;
    const t = (cx - ox) * dx + (cy - oy) * dy;
    if (t < 0 || t > bestT) continue;
    const px = ox + dx * t;
    const py = oy + dy * t;
    if (Math.hypot(px - cx, py - cy) <= WORM_HALF_WIDTH + 2) {
      best = { id: worm.id, teamId: worm.teamId, x: worm.x, y: worm.y };
      bestT = t;
    }
  }
  return best;
}

function firePellet(ctx: FireContext, hitscan: HitscanSpec, jitterDeg: number): void {
  const muzzle = muzzlePoint(ctx.worm);
  const dir = aimDirection(ctx.worm, ctx.aim.angleDeg + jitterDeg);
  const worm = firstWormAlong(ctx, muzzle.x, muzzle.y, dir.x, dir.y, hitscan.rangePx);
  const wall = sweep(ctx.world.terrain.mask, muzzle.x, muzzle.y, muzzle.x + dir.x * hitscan.rangePx, muzzle.y + dir.y * hitscan.rangePx, 0);
  const wallT = wall.hit === null ? hitscan.rangePx : Math.hypot(wall.x - muzzle.x, wall.y - muzzle.y);
  if (worm !== null) {
    const wormT = (worm.x - muzzle.x) * dir.x + (worm.y - WORM_HEIGHT / 2 - muzzle.y) * dir.y;
    if (wormT <= wallT) {
      ctx.world.events.push({ type: 'damage', wormId: worm.id, amount: hitscan.damagePerPellet, sourceTeamId: ctx.worm.teamId, sourceWormId: ctx.worm.id, cause: 'hit' });
      // The hit is visible: a small burst on the body, no screen shake. Without it a gun that
      // connects looks identical to a gun that misses.
      ctx.world.events.push({ type: 'explosion', x: muzzle.x + dir.x * wormT, y: muzzle.y + dir.y * wormT, radius: IMPACT_FX_RADIUS_PX, particle: 'small', shake: 0 });
      ctx.world.events.push({ type: 'sound', id: ctx.def.sfx.impact ?? 'exp_small_1', x: worm.x, y: worm.y });
      const push = vec2(dir.x, dir.y);
      const target = ctx.world.worms.find((w) => w.id === worm.id);
      if (target !== undefined) {
        target.vx += push.x * hitscan.recoil * KNOCKBACK_SCALE;
        target.vy += push.y * hitscan.recoil * KNOCKBACK_SCALE - hitscan.recoil * 0.2;
        if (hitscan.recoil > 0) {
          target.motion = 'flying';
          target.onGround = false;
        }
      }
      return;
    }
  }
  if (wall.hit !== null) {
    if (hitscan.carveRadiusPx > 0) {
      carve(ctx.world.terrain, wall.hit.solidX, wall.hit.solidY, hitscan.carveRadiusPx);
      ctx.world.events.push({ type: 'activity', kind: 'carve' });
    }
    // Dust where the round lands, so the player sees where the shot went.
    ctx.world.events.push({ type: 'explosion', x: wall.x, y: wall.y, radius: Math.max(IMPACT_FX_RADIUS_PX, hitscan.carveRadiusPx), particle: 'small', shake: 0 });
  }
}

export function fireHitscan(ctx: FireContext): FireResult {
  const hitscan = ctx.def.hitscan;
  if (hitscan === undefined) return endsAfter(0);
  const muzzle = muzzlePoint(ctx.worm);
  ctx.world.events.push({ type: 'sound', id: ctx.def.sfx.fire, x: muzzle.x, y: muzzle.y });
  for (let i = 0; i < hitscan.pellets; i += 1) {
    const spread = hitscan.pellets === 1 ? 0 : (i / (hitscan.pellets - 1) - 0.5) * hitscan.spreadDeg;
    const jitter = spread + (hitscan.burstCount > 1 ? Math.sin(i * 12.9898) * hitscan.spreadDeg * 0.25 : 0);
    firePellet(ctx, hitscan, jitter);
  }
  const shotsRemaining = ctx.def.shotsPerTurn - 1 - ctx.shotIndex;
  return endsAfter(shotsRemaining);
}
