/**
 * Super moves (Ryuko Ranbu): locks the nearest enemy in plain sight within the combo's reach,
 * preferring one in front of the worm, plans where the attacker plants its feet and where it is
 * left standing, and hands the timeline to the sim (sim/combo.ts). With nobody in reach the rush
 * whiffs: the worm still flashes and dashes and the turn is spent, as a whiffed super is in any
 * fighting game. The shot stays open until the sim reports the combo done (FireResult.sequence).
 */

import { spawnCombo } from '../../sim/combo.ts';
import { sweep } from '../../sim/collision.ts';
import { WORM_HALF_WIDTH, WORM_HEIGHT } from '../../sim/constants.ts';
import type { WormBody } from '../../sim/types.ts';
import type { SimWorld } from '../../sim/world.ts';
import { firstSolidBelow, lineOfSight } from '../../terrain/queries.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';
import { resolveTeleport } from './utility.ts';

/** Feet to feet gap between the attacker and its victim during the beating, world px. */
export const COMBO_STAND_GAP_PX = 14;
/** A target behind the worm costs this much more distance: the rush prefers what it faces. */
const BEHIND_PENALTY = 1.5;
/** A whiffed rush covers this fraction of the lock range. */
const WHIFF_REACH = 0.45;

function inPlainSight(world: SimWorld, from: WormBody, to: WormBody): boolean {
  const mask = world.terrain.mask;
  // Chest to chest, or head to head over a bump in the ground between them.
  for (const height of [0.6, 0.9]) {
    if (lineOfSight(mask, from.x, from.y - WORM_HEIGHT * height, to.x, to.y - WORM_HEIGHT * height)) return true;
  }
  return false;
}

/**
 * The worm a super fired now would rush: the nearest living enemy within rangePx, centre to
 * centre, that the worm can see, those behind it counted a little farther. Null when nobody
 * qualifies. The aim UI calls this every frame to draw the lock on marker.
 */
export function lockTarget(world: SimWorld, worm: WormBody, rangePx: number): WormBody | null {
  let best: WormBody | null = null;
  let bestScore = Infinity;
  for (const other of world.worms) {
    if (!other.alive || other.teamId === worm.teamId || other.motion === 'drowning' || other.motion === 'dead') continue;
    if (other.y >= world.terrain.water.y) continue;
    const dx = other.x - worm.x;
    const dist = Math.hypot(dx, other.y - worm.y);
    if (dist > rangePx) continue;
    if (!inPlainSight(world, worm, other)) continue;
    const behind = dx !== 0 && Math.sign(dx) !== worm.facing;
    const score = dist * (behind ? BEHIND_PENALTY : 1);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

/**
 * A spot to stand on at (x, y), snapped like a teleport, with ground right under the feet; else the
 * fallback. A teleport may arrive in mid air, a finished super must not: a rush over a pit would
 * drop the attacker into it, into the water even, for having landed its blows.
 */
function standingSpot(world: SimWorld, x: number, y: number, fallback: { readonly x: number; readonly y: number }): { x: number; y: number } {
  const spot = resolveTeleport(world.terrain.mask, world.terrain.water.y, { x, y });
  if (spot === null || firstSolidBelow(world.terrain.mask, spot.x, spot.y + 1, 2) === null) return { x: fallback.x, y: fallback.y };
  return spot;
}

export function fireCombo(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.combo;
  if (spec === undefined) return endsAfter(0);
  const home = { x: worm.x, y: worm.y };
  const victim = lockTarget(world, worm, spec.rangePx);
  world.events.push({ type: 'sound', id: def.sfx.fire, x: worm.x, y: worm.y });
  if (victim !== null) {
    const facing: 1 | -1 = victim.x > worm.x ? 1 : victim.x < worm.x ? -1 : worm.facing;
    const toX = victim.x - facing * COMBO_STAND_GAP_PX;
    const toY = victim.y;
    const rest = standingSpot(world, toX, toY, home);
    spawnCombo(world, { weaponId: def.id, attacker: worm, victim, spec, facing, toX, toY, restX: rest.x, restY: rest.y });
    return { endsTurn: true, shotsRemaining: 0, sequence: true };
  }
  // Whiff: rush forward at chest height until a wall, and plant the feet there if possible.
  const chestY = worm.y - WORM_HEIGHT * 0.6;
  const reach = spec.rangePx * WHIFF_REACH;
  const path = sweep(world.terrain.mask, worm.x, chestY, worm.x + worm.facing * reach, chestY, 0);
  const travelled = Math.max(0, Math.abs(path.x - worm.x) - (path.hit === null ? 0 : WORM_HALF_WIDTH + 1));
  const toX = worm.x + worm.facing * travelled;
  const rest = standingSpot(world, toX, worm.y, home);
  spawnCombo(world, { weaponId: def.id, attacker: worm, victim: null, spec, facing: worm.facing, toX, toY: worm.y, restX: rest.x, restY: rest.y });
  return { endsTurn: true, shotsRemaining: 0, sequence: true };
}
