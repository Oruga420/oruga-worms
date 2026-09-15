/**
 * Air strike (architecture.md section C): the player picks a target x and a plane direction;
 * count bombs spawn above the map spaced spacingPx apart with a small shared horizontal speed
 * from the plane heading, and fall as ordinary contact projectiles.
 */

import type { StrikeSpec } from '../weapons/types.ts';
import { STRIKE_BOMB_VX_PX_PER_S } from './constants.ts';
import { spawnProjectile } from './projectile.ts';
import type { ProjectileBody } from './types.ts';
import type { SimWorld } from './world.ts';

export interface LaunchStrikeParams {
  readonly weaponId: string;
  readonly ownerTeamId: string | null;
  readonly ownerWormId: string | null;
  readonly targetX: number;
  readonly direction: 1 | -1;
  readonly strike: StrikeSpec;
}

/** Bomb x positions centered on the target, in drop order (upwind first). */
export function bombColumns(targetX: number, count: number, spacingPx: number, direction: 1 | -1): number[] {
  const columns: number[] = [];
  const start = targetX - (direction * spacingPx * (count - 1)) / 2;
  for (let i = 0; i < count; i += 1) columns.push(start + direction * spacingPx * i);
  return columns;
}

export function launchStrike(world: SimWorld, params: LaunchStrikeParams): ProjectileBody[] {
  const { strike } = params;
  const bombs: ProjectileBody[] = [];
  const columns = bombColumns(params.targetX, strike.count, strike.spacingPx, params.direction);
  for (const [i, x] of columns.entries()) {
    bombs.push(
      spawnProjectile(world, {
        kind: 'strike_bomb',
        weaponId: strike.childWeaponId ?? `${params.weaponId}_bomb`,
        ownerTeamId: params.ownerTeamId,
        ownerWormId: params.ownerWormId,
        x,
        y: strike.spawnY - i * 6,
        vx: params.direction * STRIKE_BOMB_VX_PX_PER_S,
        vy: 0,
        spec: strike.childProjectile,
        blast: strike.childBlast,
        windAffected: false,
        gravityScale: 1,
      }),
    );
  }
  world.events.push({ type: 'sound', id: 'wpn_airstrike_flyby', x: params.targetX, y: 0 });
  return bombs;
}
