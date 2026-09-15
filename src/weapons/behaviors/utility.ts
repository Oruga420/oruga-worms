/**
 * Utilities (parachute, jetpack, teleport, girder, skip go). Teleport moves the worm to the
 * crosshair and ends the turn; girder places a bedrock plank; parachute and jetpack toggle a
 * controlled descent that keeps the turn; skip go ends the turn with no effect. The sustained
 * utilities are driven by the input layer after this call; here we only start them.
 */

import { placeGirder } from '../../terrain/terrain.ts';
import type { TerrainMask } from '../../terrain/mask.ts';
import { firstAirAbove, firstSolidBelow, isSolid } from '../../terrain/queries.ts';
import { WORM_HALF_WIDTH, WORM_HEIGHT } from '../../sim/constants.ts';
import type { FireContext, FireResult } from './types.ts';

const GIRDER_DEFAULT = { w: 64, h: 8 } as const;
/** How far a teleport target may sit inside the ground or above it and still snap to the surface. */
const TELEPORT_SNAP_PX = 24;

/** True when a worm standing with its feet at (x, feet) has its whole hitbox in air. */
function hitboxFree(mask: TerrainMask, x: number, feet: number): boolean {
  const cx = Math.round(x);
  for (let dx = -WORM_HALF_WIDTH; dx <= WORM_HALF_WIDTH; dx += 1) {
    for (let dy = 1; dy <= WORM_HEIGHT; dy += 1) {
      if (isSolid(mask, cx + dx, Math.round(feet) - dy)) return false;
    }
  }
  return true;
}

/**
 * Where a teleport lands. The player clicks a spot; the worm's position is its FEET, so a click on
 * the ground surface is by definition inside or touching solid terrain. Snap: a point in the ground
 * rises to the first air above it, a point in the air drops to the ground just below if there is
 * one within reach (otherwise the worm arrives mid air and falls, as in the source game). Then the
 * whole hitbox must be clear and the feet above the water, or the destination is refused.
 */
export function resolveTeleport(mask: TerrainMask, waterY: number, target: { readonly x: number; readonly y: number }): { x: number; y: number } | null {
  const x = Math.round(target.x);
  const y = Math.round(target.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y < WORM_HEIGHT || y >= mask.height) return null;
  if (x < WORM_HALF_WIDTH || x >= mask.width - WORM_HALF_WIDTH) return null;
  let feet: number | null = null;
  if (isSolid(mask, x, y)) {
    const above = firstAirAbove(mask, x, y, TELEPORT_SNAP_PX);
    if (above !== null) feet = above;
  } else {
    const below = firstSolidBelow(mask, x, y, TELEPORT_SNAP_PX);
    feet = below === null ? y : below - 1;
  }
  if (feet === null || feet >= waterY) return null;
  if (!hitboxFree(mask, x, feet)) return null;
  return { x, y: feet };
}

/** Validate placement before consuming a charge; the behavior repeats this for direct callers. */
export function validateUtilityTarget({ world, worm, def, aim }: FireContext): boolean {
  const effect = def.utility?.effect;
  if (effect === 'teleport') {
    const target = aim.targetPoint;
    return target !== undefined && resolveTeleport(world.terrain.mask, world.terrain.water.y, target) !== null;
  }
  if (effect !== 'girder') return true;
  const target = aim.targetPoint ?? { x: worm.x + worm.facing * 32, y: worm.y };
  const size = def.utility?.girderSizePx ?? GIRDER_DEFAULT;
  const left = Math.round(target.x - size.w / 2);
  const top = Math.round(target.y - size.h / 2);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
  if (Math.hypot(target.x - worm.x, target.y - worm.y) > (def.utility?.rangePx ?? Infinity)) return false;
  if (left < 0 || top < 0 || left + size.w > world.terrain.width || top + size.h >= world.terrain.water.y) return false;
  for (const body of world.worms) {
    if (body.alive && body.x + WORM_HALF_WIDTH >= left && body.x - WORM_HALF_WIDTH < left + size.w && body.y >= top && body.y - WORM_HEIGHT < top + size.h) return false;
  }
  for (let y = top; y < top + size.h; y += 1) {
    for (let x = left; x < left + size.w; x += 1) {
      if (isSolid(world.terrain.mask, x, y)) return false;
    }
  }
  return true;
}

export function fireUtility(ctx: FireContext): FireResult {
  const { def, worm, world, aim } = ctx;
  const effect = def.utility?.effect ?? 'skip';
  switch (effect) {
    case 'teleport': {
      // The old gate tested a 2 px disc at the target and the target is the FEET, so every click on
      // the ground was "blocked": 70 of 70 surface targets refused, silently, with the charge and
      // the turn gone. Now the click snaps to a standing spot, and a refusal keeps the turn.
      const target = aim.targetPoint;
      const spot = target === undefined ? null : resolveTeleport(world.terrain.mask, world.terrain.water.y, target);
      if (spot === null) {
        world.events.push({ type: 'sound', id: 'ui_select_click', x: worm.x, y: worm.y });
        return { endsTurn: false, shotsRemaining: 0 };
      }
      world.events.push({ type: 'sound', id: 'wpn_teleport_zap', x: worm.x, y: worm.y });
      worm.x = spot.x;
      worm.y = spot.y;
      worm.vx = 0;
      worm.vy = 0;
      worm.motion = 'idle';
      worm.onGround = false;
      world.events.push({ type: 'activity', kind: 'spawn' });
      world.events.push({ type: 'sound', id: 'wpn_teleport_zap', x: spot.x, y: spot.y });
      return { endsTurn: true, shotsRemaining: 0 };
    }
    case 'girder': {
      if (!validateUtilityTarget(ctx)) return { endsTurn: false, shotsRemaining: 0 };
      const size = def.utility?.girderSizePx ?? GIRDER_DEFAULT;
      const target = aim.targetPoint ?? { x: worm.x + worm.facing * 32, y: worm.y };
      placeGirder(world.terrain, Math.round(target.x - size.w / 2), Math.round(target.y - size.h / 2), size.w, size.h);
      world.events.push({ type: 'sound', id: 'wpn_girder_place', x: target.x, y: target.y });
      world.events.push({ type: 'activity', kind: 'carve' });
      return { endsTurn: false, shotsRemaining: 0 };
    }
    case 'parachute':
      worm.motion = 'parachuting';
      worm.onGround = false;
      world.events.push({ type: 'sound', id: 'wpn_parachute_open', x: worm.x, y: worm.y });
      return { endsTurn: false, shotsRemaining: 0, controlledDescent: true };
    case 'jetpack':
      worm.motion = 'jetpacking';
      worm.onGround = false;
      worm.fuelMs = def.utility?.fuelMs ?? 5000;
      return { endsTurn: false, shotsRemaining: 0, controlledDescent: true };
    default:
      return { endsTurn: true, shotsRemaining: 0 };
  }
}
