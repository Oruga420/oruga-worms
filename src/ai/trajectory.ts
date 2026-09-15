/**
 * Cheap shot simulation for the heuristic CPU (architecture.md section F, ai/trajectory.ts):
 * march a candidate projectile with the REAL integrator against the terrain mask (read only, no
 * carve during the search) to find where it detonates, then estimate the blast damage at that
 * point against each worm. Deterministic and fast: about 120 ticks per candidate, no world clone.
 *
 * It ignores bounces off freshly carved terrain and knockback into water, which is the accepted
 * tradeoff of a scoring heuristic. The real shot, fired through the sim, is what actually plays.
 */

import { GRAVITY_PX_PER_S2, TICK_S, WORM_HEIGHT } from '../sim/constants.ts';
import { blastDamage } from '../sim/damage.ts';
import { discBlocked, sweep } from '../sim/collision.ts';
import type { TerrainMask } from '../terrain/mask.ts';

export interface ShotSpec {
  readonly x0: number;
  readonly y0: number;
  readonly vx: number;
  readonly vy: number;
  readonly radiusPx: number;
  readonly bounce: number;
  readonly friction: number;
  readonly windAffected: boolean;
  readonly gravityScale: number;
  /** Fuse in ms, or null for contact detonation. */
  readonly fuseMs: number | null;
  readonly maxLifetimeMs: number;
  readonly water: 'splash' | 'skim' | 'pass';
}

export interface Impact {
  readonly x: number;
  readonly y: number;
  readonly ticks: number;
  readonly reason: 'contact' | 'fuse' | 'water' | 'timeout' | 'bounds';
}

export interface TrajectoryEnv {
  readonly mask: TerrainMask;
  readonly waterY: number;
  /** Wind as a fraction of gravity, positive blows right. */
  readonly wind: number;
  readonly gravity?: number;
}

/** Marches the shot and returns where it would go off, or null if it leaves the world without detonating. */
export function simulateShot(shot: ShotSpec, env: TrajectoryEnv): Impact | null {
  const gravity = env.gravity ?? GRAVITY_PX_PER_S2;
  const width = env.mask.width;
  const height = env.mask.height;
  let x = shot.x0;
  let y = shot.y0;
  let vx = shot.vx;
  let vy = shot.vy;
  const maxTicks = Math.min(1200, Math.max(1, Math.round(shot.maxLifetimeMs / 1000 / TICK_S)));
  const fuseTicks = shot.fuseMs === null ? -1 : Math.max(1, Math.round(shot.fuseMs / 1000 / TICK_S));
  for (let t = 1; t <= maxTicks; t += 1) {
    vy += gravity * shot.gravityScale * TICK_S;
    if (shot.windAffected) vx += env.wind * gravity * TICK_S;
    const nx = x + vx * TICK_S;
    const ny = y + vy * TICK_S;
    const hit = sweep(env.mask, x, y, nx, ny, shot.radiusPx);
    if (hit.hit !== null) {
      if (shot.bounce > 0 && fuseTicks > 0 && t < fuseTicks) {
        // A bouncing fused shot: reflect roughly and keep going until the fuse ends.
        const n = hit.hit.normal;
        const along = vx * n.x + vy * n.y;
        vx = (vx - 2 * along * n.x) * shot.friction;
        vy = (vy - 2 * along * n.y) * shot.bounce;
        x = hit.x + n.x;
        y = hit.y + n.y;
        continue;
      }
      return { x: hit.x, y: hit.y, ticks: t, reason: 'contact' };
    }
    x = nx;
    y = ny;
    if (fuseTicks > 0 && t >= fuseTicks) return { x, y, ticks: t, reason: 'fuse' };
    if (y >= env.waterY) {
      if (shot.water === 'skim' && vy > 0 && vy < Math.abs(vx) * 0.35) {
        vy = -vy * 0.6;
        y = env.waterY - 1;
        continue;
      }
      if (shot.water !== 'pass') return { x, y: env.waterY, ticks: t, reason: 'water' };
    }
    if (x < -32 || x > width + 32 || y > height + 32) return { x, y, ticks: t, reason: 'bounds' };
  }
  return { x, y, ticks: maxTicks, reason: 'timeout' };
}

export interface WormPoint {
  readonly id: string;
  readonly teamId: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly alive: boolean;
}

export interface BlastEstimate {
  readonly perWorm: ReadonlyMap<string, number>;
  readonly total: number;
}

/** Expected damage to each worm from a blast at (bx, by), clamped to the worm's hp. */
export function estimateBlast(bx: number, by: number, radiusPx: number, maxDamage: number, worms: readonly WormPoint[]): BlastEstimate {
  const perWorm = new Map<string, number>();
  let total = 0;
  for (const worm of worms) {
    if (!worm.alive) continue;
    const distance = Math.hypot(worm.x - bx, worm.y - WORM_HEIGHT / 2 - by);
    const raw = blastDamage(maxDamage, distance, radiusPx);
    const dealt = Math.min(raw, worm.hp);
    if (dealt > 0) {
      perWorm.set(worm.id, dealt);
      total += dealt;
    }
  }
  return { perWorm, total };
}

/** True when the straight line from (ax, ay) to (bx, by) is clear of solid terrain. */
export function clearShot(mask: TerrainMask, ax: number, ay: number, bx: number, by: number): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  if (dist === 0) return true;
  const steps = Math.ceil(dist);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (discBlocked(mask, ax + (bx - ax) * t, ay + (by - ay) * t, 0)) return false;
  }
  return true;
}
