/**
 * Camera director: when a shot is in the air the camera rides the projectile, then holds on the
 * impact point for a beat so the hit and the damage are readable, then hands control back to the
 * active worm. Pure, so the timings and the hand back are unit tested.
 *
 * Two details drive the design:
 * - Dead projectiles are filtered out of `world.projectiles` on the same step they explode, so the
 *   director has to remember the last position itself; by the time the explosion is visible there
 *   is nothing left in the world to point at.
 * - Ammo travels fast, so following it uses a much tighter smoothing constant than the worm
 *   follow. With the default tau the camera lags behind a bazooka shell and the impact happens off
 *   screen, which is the whole thing this is meant to fix.
 */

import type { SimWorld } from '../sim/world.ts';

/** Smoothing while chasing ammo. Well under the camera's 150 ms default so the shell stays framed. */
export const PROJECTILE_TAU_MS = 60;
/** Smoothing while sitting on the impact, slightly looser so the settle is not abrupt. */
export const IMPACT_TAU_MS = 120;
/** How long the camera stays on the impact point before returning to the active worm. */
export const IMPACT_HOLD_MS = 900;

export type CameraFocus = 'worm' | 'projectile' | 'impact';

export interface CameraDirector {
  readonly focus: CameraFocus;
  /** Which projectile is being ridden, so a cluster child does not silently steal the camera. */
  readonly projectileId: number | null;
  /** Last seen position of the ridden projectile; the impact hold points here. */
  readonly x: number;
  readonly y: number;
  readonly holdMs: number;
}

export const INITIAL_DIRECTOR: CameraDirector = Object.freeze({
  focus: 'worm',
  projectileId: null,
  x: 0,
  y: 0,
  holdMs: 0,
});

export interface CameraAim {
  readonly director: CameraDirector;
  /** Point to follow, or null to mean "keep following the active worm". */
  readonly target: { readonly x: number; readonly y: number } | null;
  readonly tauMs: number | undefined;
}

/**
 * Advances the director one tick. Returns the point the camera should follow, or null when the
 * caller should fall back to the active worm.
 */
export function updateCameraTarget(director: CameraDirector, world: SimWorld, dtMs: number): CameraAim {
  // Anything the player released and is watching travel: shells, and the sheep, which is a body of
  // its own. Body ids come from one counter, so "newest" is well defined across both lists.
  const ridable: readonly { readonly id: number; readonly x: number; readonly y: number }[] = [...world.projectiles, ...(world.sheep ?? []).filter((s) => s.alive)];

  // Keep riding the same body while it lives, so a cluster child spawning mid flight does not
  // yank the camera off the shell the player is actually watching.
  const current = director.projectileId === null ? undefined : ridable.find((p) => p.id === director.projectileId);
  // Otherwise take the newest one, which is the shot just fired.
  const newest = ridable.length === 0 ? undefined : ridable.reduce((a, b) => (b.id > a.id ? b : a));
  const ride = current ?? newest;

  if (ride !== undefined) {
    return {
      director: { focus: 'projectile', projectileId: ride.id, x: ride.x, y: ride.y, holdMs: IMPACT_HOLD_MS },
      target: { x: ride.x, y: ride.y },
      tauMs: PROJECTILE_TAU_MS,
    };
  }

  // The shell we were riding is gone: it detonated, timed out or left the map. Sit on where it was.
  if (director.focus === 'projectile') {
    return {
      director: { ...director, focus: 'impact', projectileId: null, holdMs: IMPACT_HOLD_MS },
      target: { x: director.x, y: director.y },
      tauMs: IMPACT_TAU_MS,
    };
  }

  if (director.focus === 'impact') {
    const holdMs = director.holdMs - dtMs;
    if (holdMs > 0) {
      return { director: { ...director, holdMs }, target: { x: director.x, y: director.y }, tauMs: IMPACT_TAU_MS };
    }
    return { director: { ...INITIAL_DIRECTOR }, target: null, tauMs: undefined };
  }

  return { director, target: null, tauMs: undefined };
}
