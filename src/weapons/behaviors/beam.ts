/**
 * Beam supers (Kamehameha): the beam leaves the hands along the aim, like a gun's ray, but it is
 * charged first and plays out over time, so the fire behavior only hands the timeline to the sim
 * (sim/beam.ts). The shot stays open until the sim reports the beam done (FireResult.sequence).
 */

import { spawnBeam } from '../../sim/beam.ts';
import { aimDirection, endsAfter, muzzlePoint, type FireContext, type FireResult } from './types.ts';

export function fireBeam(ctx: FireContext): FireResult {
  const { world, worm, def } = ctx;
  const spec = def.beam;
  if (spec === undefined) return endsAfter(0);
  const hands = muzzlePoint(worm);
  const dir = aimDirection(worm, ctx.aim.angleDeg);
  spawnBeam(world, { weaponId: def.id, attacker: worm, spec, x0: hands.x, y0: hands.y, dx: dir.x, dy: dir.y });
  return { endsTurn: true, shotsRemaining: 0, sequence: true };
}
