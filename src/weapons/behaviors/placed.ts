/**
 * Placed weapons: dynamite (a fused projectile dropped at the worm's feet that does not roll) and
 * the mine (a proximity hazard). Both drop where the worm stands.
 */

import { spawnMine } from '../../sim/mine.ts';
import { spawnProjectile } from '../../sim/projectile.ts';
import { endsAfter, type FireContext, type FireResult } from './types.ts';

export function firePlaced(ctx: FireContext): FireResult {
  const { def, worm, world } = ctx;
  if (def.spawn !== undefined && def.spawn.entityType === 'mine' && def.blast !== undefined) {
    spawnMine(world, { ownerTeamId: worm.teamId, x: worm.x + worm.facing * 4, y: worm.y - 4, spec: def.spawn, blast: def.blast });
    world.events.push({ type: 'sound', id: def.sfx.fire, x: worm.x, y: worm.y });
    return endsAfter(0);
  }
  if (def.projectile !== undefined && def.blast !== undefined) {
    // Dynamite: a heavy fused body with no horizontal velocity so it stays put.
    spawnProjectile(world, {
      weaponId: def.id,
      ownerTeamId: worm.teamId,
      ownerWormId: worm.id,
      x: worm.x + worm.facing * 4,
      y: worm.y - 6,
      vx: 0,
      vy: 0,
      spec: def.projectile,
      blast: def.blast,
      windAffected: false,
      gravityScale: def.gravityScale,
      fuseMs: def.fuse?.defaultMs ?? 5000,
    });
    world.events.push({ type: 'sound', id: def.sfx.fire, x: worm.x, y: worm.y });
  }
  return endsAfter(0);
}
