/**
 * Blast resolution (architecture.md section C, in this order): carve the terrain, emit damage
 * events for worms in range (damage is emitted, never applied here: the match reducer applies
 * it), knock worms back into the flying state with the post blast landing exemption, trigger
 * chain reactions on nearby mines and chain reaction projectiles, then emit the explosion,
 * activity and sound events.
 */

import { vec2 } from '../core/math.ts';
import { carve } from '../terrain/terrain.ts';
import type { BlastSpec } from '../weapons/types.ts';
import { WORM_HEIGHT } from './constants.ts';
import { blastDamage, knockbackVelocity } from './damage.ts';
import type { SimWorld } from './world.ts';

export interface BlastInput {
  readonly x: number;
  readonly y: number;
  readonly blast: BlastSpec;
  readonly sourceTeamId: string | null;
  readonly sourceWormId: string | null;
  /** Explosion sound cue, when the weapon has one. */
  readonly soundId?: string;
}

const CHAIN_MARGIN_PX = 4;

export function explode(world: SimWorld, input: BlastInput): void {
  const { x, y, blast } = input;
  const r = blast.radiusPx;
  if (blast.carve && r > 0) {
    const result = carve(world.terrain, x, y, r);
    if (result.spans.length > 0) world.events.push({ type: 'activity', kind: 'carve' });
  }
  for (const worm of world.worms) {
    if (!worm.alive || worm.motion === 'drowning') continue;
    const center = vec2(worm.x, worm.y - WORM_HEIGHT / 2);
    const distance = Math.hypot(center.x - x, center.y - y);
    if (distance > r) continue;
    const amount = blastDamage(blast.maxDamage, distance, r);
    if (amount > 0) {
      world.events.push({ type: 'damage', wormId: worm.id, amount, sourceTeamId: input.sourceTeamId, sourceWormId: input.sourceWormId, cause: 'blast' });
    }
    const push = knockbackVelocity(vec2(x, y), center, blast.knockback, r);
    if (push.x !== 0 || push.y !== 0) {
      worm.vx += push.x;
      worm.vy += push.y;
      worm.motion = 'flying';
      worm.onGround = false;
      worm.exemptNextLanding = true;
      worm.restTicks = 0;
    }
  }
  for (const projectile of world.projectiles) {
    if (!projectile.alive || !projectile.spec.chainReaction) continue;
    if (Math.hypot(projectile.x - x, projectile.y - y) <= r + CHAIN_MARGIN_PX) projectile.chainTriggered = true;
  }
  for (const mine of world.mines) {
    if (!mine.alive) continue;
    if (Math.hypot(mine.x - x, mine.y - y) <= r + CHAIN_MARGIN_PX) {
      mine.armed = true;
      mine.fuseTicks = Math.min(mine.fuseTicks < 0 ? Number.MAX_SAFE_INTEGER : mine.fuseTicks, 1);
    }
  }
  world.events.push({ type: 'explosion', x, y, radius: r, particle: blast.particle, shake: blast.shake });
  if (input.soundId !== undefined) world.events.push({ type: 'sound', id: input.soundId, x, y });
}
