/**
 * Targeted weapons: the air strike drops a row of bombs on the crosshair x from the side the
 * worm faces. The crosshair target is required; the caller (or the sanitizer) guarantees it.
 */

import { launchStrike } from '../../sim/strike.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';

export function fireTargeted(ctx: FireContext): FireResult {
  const { def, worm, world, aim } = ctx;
  const strike = def.strike;
  if (strike === undefined) return endsAfter(0);
  const targetX = aim.targetPoint?.x ?? worm.x;
  launchStrike(world, { weaponId: def.id, ownerTeamId: worm.teamId, ownerWormId: worm.id, targetX, direction: worm.facing, strike });
  return endsAfter(0);
}
