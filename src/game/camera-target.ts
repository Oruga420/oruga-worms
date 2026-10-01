/**
 * Camera director: when a shot is in the air the camera rides the projectile, then holds on the
 * impact point for a beat so the hit and the damage are readable, then hands control back to the
 * active worm. A super move frames the fight, a beam its worm while it charges and then the worm
 * with the beam running across the screen, Gear 5 its worm, then the arm and what it grabs, then
 * the mouth, the Freezer its worm pointing, then the light on its way, then the worm the light went
 * into as it floats, swells and bursts, a Saibaman seed the ground where it went in and then the
 * Saibaman leaping out, and a worm thrown through the air is followed until it lands. Pure, so the
 * timings and the hand back are unit tested.
 *
 * Two details drive the design:
 * - Dead projectiles are filtered out of `world.projectiles` on the same step they explode, so the
 *   director has to remember the last position itself; by the time the explosion is visible there
 *   is nothing left in the world to point at.
 * - Ammo travels fast, so following it uses a much tighter smoothing constant than the worm
 *   follow. With the default tau the camera lags behind a bazooka shell and the impact happens off
 *   screen, which is the whole thing this is meant to fix.
 */

import { holdsVictim } from '../sim/combo.ts';
import { devourHand } from '../sim/devour.ts';
import { hexLift, hexLight } from '../sim/hex.ts';
import { WORM_HEIGHT } from '../sim/constants.ts';
import { techniqueProgress } from '../sim/technique.ts';
import { galaxyAt } from '../sim/techniques/galaxy.ts';
import { hikenAt } from '../sim/techniques/hiken.ts';
import type { BeamBody, TechniqueBody } from '../sim/types.ts';
import type { SimWorld } from '../sim/world.ts';

/** Smoothing while chasing ammo. Well under the camera's 150 ms default so the shell stays framed. */
export const PROJECTILE_TAU_MS = 60;
/** Smoothing on a super move: tight, the fight is the whole picture. */
export const COMBO_TAU_MS = 45;
/** Smoothing on a beam: loose enough that the swing from the worm to the beam reads as a pan. */
export const BEAM_TAU_MS = 90;
/**
 * How far along a firing beam the camera sits, as a share of the distance from the centre of the
 * view to its edge in the beam's direction. At a half the worm stays well inside the frame, clear
 * of the touch controls, and the beam runs from it across the rest of the screen.
 */
export const BEAM_FRAME_SHARE = 0.5;
/** Smoothing on Gear 5: quick enough to keep up with the rubber arm, soft enough to read as a pan. */
export const DEVOUR_TAU_MS = 70;
/** Smoothing on the Freezer: quick enough to keep up with the light, soft enough to read as a pan. */
export const HEX_TAU_MS = 70;
/** Smoothing on a Saibaman seed: an easy pan down to the ground, quick enough to catch the leap. */
export const SPROUT_TAU_MS = 80;
/** Smoothing on a technique: quick enough to ride a galaxy or a meteor, soft enough to read as a pan. */
export const TECHNIQUE_TAU_MS = 75;
/** A knocked worm this fast is worth watching fly (world px per second). */
export const FLYER_MIN_SPEED = 160;
/** Smoothing while sitting on the impact, slightly looser so the settle is not abrupt. */
export const IMPACT_TAU_MS = 120;
/** How long the camera stays on the impact point before returning to the active worm. */
export const IMPACT_HOLD_MS = 900;

export type CameraFocus = 'worm' | 'projectile' | 'impact' | 'combo' | 'beam' | 'devour' | 'hex' | 'sprout' | 'technique' | 'flyer';

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

/** Half the view's width and height in world px, at the camera's zoom. */
export interface ViewExtent {
  readonly halfW: number;
  readonly halfH: number;
}

export interface CameraAim {
  readonly director: CameraDirector;
  /** Point to follow, or null to mean "keep following the active worm". */
  readonly target: { readonly x: number; readonly y: number } | null;
  readonly tauMs: number | undefined;
}

/**
 * Where to look at a firing beam: its middle, pulled back towards the worm as far as it takes to
 * keep the worm in the view. A 640 px beam is wider than the screen, so framing its middle put the
 * worm and both ends out of the picture. Without a view, the middle.
 */
function beamFrame(beam: BeamBody, view: ViewExtent | undefined): { readonly x: number; readonly y: number } {
  const toEdge = view === undefined ? Infinity : Math.min(view.halfW / Math.max(1e-6, Math.abs(beam.dx)), view.halfH / Math.max(1e-6, Math.abs(beam.dy)));
  const along = Math.min(beam.length / 2, BEAM_FRAME_SHARE * toEdge);
  return { x: beam.x0 + beam.dx * along, y: beam.y0 + beam.dy * along };
}

/** A point over a worm standing at (x, y): its middle, where the eye goes. */
function over(x: number, y: number): { readonly x: number; readonly y: number } {
  return { x, y: y - WORM_HEIGHT * 0.6 };
}

/**
 * Where to look at a technique, by kind and stage: the worm as it gathers itself, then what it
 * sends (the galaxy, the fist, the meteor) or what it does it to (the stung worm, the sealed one,
 * the square cut, the point the beams meet), then where it ended.
 */
export function techniqueFocus(body: TechniqueBody, worms: readonly { readonly id: string; readonly x: number; readonly y: number; readonly alive: boolean }[]): { readonly x: number; readonly y: number } {
  const victim = (id: string | null) => (id === null ? undefined : worms.find((w) => w.id === id));
  const home = over(body.holdX, body.holdY);
  switch (body.kind) {
    case 'needle': {
      if (body.stage === 'point') return home;
      const v = victim(body.victimId);
      return v !== undefined ? over(v.x, v.y) : { x: body.targetX, y: body.targetY };
    }
    case 'galaxy':
      if (body.stage === 'charge') return home;
      return galaxyAt(body) ?? (body.burstX !== null && body.burstY !== null ? { x: body.burstX, y: body.burstY } : home);
    case 'treasure': {
      const at = over(body.targetX, body.targetY);
      if (body.stage === 'cast') return techniqueProgress(body) < 0.45 ? home : at;
      return at;
    }
    case 'hiken':
      if (body.stage === 'windup') return home;
      return hikenAt(body) ?? (body.burstX !== null && body.burstY !== null ? { x: body.burstX, y: body.burstY } : home);
    case 'meteor':
      if (body.stage === 'call') return techniqueProgress(body) < 0.4 ? home : { x: body.targetX, y: body.targetY };
      if (body.stage === 'fall') return { x: body.x, y: body.y };
      return body.burstX !== null && body.burstY !== null ? { x: body.burstX, y: body.burstY } : { x: body.targetX, y: body.targetY };
    case 'dice': {
      const middle = { x: body.squareX + body.side / 2, y: body.squareY + body.side / 2 };
      return body.stage === 'draw' ? { x: (home.x + middle.x) / 2, y: (home.y + middle.y) / 2 } : middle;
    }
    case 'zoltraak':
      if (body.stage === 'form') return { x: home.x, y: home.y - 10 };
      if (body.stage === 'fire') return { x: (home.x + body.targetX) / 2, y: (home.y + body.targetY) / 2 };
      return { x: body.targetX, y: body.targetY };
  }
}

/**
 * Advances the director one tick. Returns the point the camera should follow, or null when the
 * caller should fall back to the active worm.
 */
export function updateCameraTarget(director: CameraDirector, world: SimWorld, dtMs: number, view?: ViewExtent): CameraAim {
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

  // A super move frames the fight: both fighters while the victim is held, then the thrown victim.
  const combo = (world.combos ?? []).find((c) => c.alive);
  if (combo !== undefined) {
    const worms = world.worms ?? [];
    const attacker = worms.find((w) => w.id === combo.attackerId);
    const victim = combo.victimId === null ? undefined : worms.find((w) => w.id === combo.victimId);
    const focus =
      victim !== undefined && !holdsVictim(combo.stage) ? { x: victim.x, y: victim.y - 8 }
      : victim !== undefined && combo.stage !== 'startup' ? { x: (combo.toX + combo.holdX) / 2, y: (combo.toY + combo.holdY) / 2 - 8 }
      : attacker !== undefined ? { x: attacker.x, y: attacker.y - 8 }
      : null;
    if (focus !== null) {
      return { director: { focus: 'combo', projectileId: null, x: focus.x, y: focus.y, holdMs: IMPACT_HOLD_MS }, target: focus, tauMs: COMBO_TAU_MS };
    }
  }

  // A beam: its worm while the energy gathers, then the worm and as much of the beam as fits.
  const beam = (world.beams ?? []).find((b) => b.alive);
  if (beam !== undefined) {
    const attacker = (world.worms ?? []).find((w) => w.id === beam.attackerId);
    const focus =
      beam.stage === 'charge' ? (attacker === undefined ? { x: beam.x0, y: beam.y0 } : { x: attacker.x, y: attacker.y - 8 })
      : beamFrame(beam, view);
    return { director: { focus: 'beam', projectileId: null, x: focus.x, y: focus.y, holdMs: IMPACT_HOLD_MS }, target: focus, tauMs: BEAM_TAU_MS };
  }

  // Gear 5: the worm while it awakens, then the arm and whatever it grabbed, then the mouth.
  const devour = (world.devours ?? []).find((d) => d.alive);
  if (devour !== undefined) {
    const hand = devourHand(devour);
    const middle = { x: devour.holdX, y: devour.holdY - WORM_HEIGHT * 0.6 };
    const focus =
      hand !== null ? { x: (middle.x + hand.x) / 2, y: (middle.y + hand.y) / 2 }
      : devour.stage === 'awaken' ? middle
      : { x: devour.holdX + devour.facing * 6, y: devour.holdY - WORM_HEIGHT };
    return { director: { focus: 'devour', projectileId: null, x: focus.x, y: focus.y, holdMs: IMPACT_HOLD_MS }, target: focus, tauMs: DEVOUR_TAU_MS };
  }

  // The Freezer: the worm pointing, the light on its way, then the worm it went into, up to where it
  // bursts, and the burst while the pieces fly (a whiff: where the light went out).
  const hex = (world.hexes ?? []).find((h) => h.alive);
  if (hex !== undefined) {
    const light = hexLight(hex);
    const focus =
      light !== null ? light
      : hex.stage === 'point' ? { x: hex.holdX, y: hex.holdY - WORM_HEIGHT * 0.6 }
      : { x: hex.groundX, y: hex.groundY - WORM_HEIGHT / 2 - (hex.stage === 'recover' && hex.burst ? hex.liftPx : hexLift(hex)) };
    return { director: { focus: 'hex', projectileId: null, x: focus.x, y: focus.y, holdMs: IMPACT_HOLD_MS }, target: focus, tauMs: HEX_TAU_MS };
  }

  // A Saibaman seed: between the planter and the ground it went into, then the Saibaman as it leaps out.
  const sprout = (world.sprouts ?? []).find((s) => s.alive);
  if (sprout !== undefined) {
    const out = sprout.sproutId === null ? undefined : (world.worms ?? []).find((w) => w.id === sprout.sproutId && w.alive);
    const focus = out !== undefined ? { x: out.x, y: out.y - WORM_HEIGHT / 2 } : { x: (sprout.holdX + sprout.spotX) / 2, y: sprout.spotY - WORM_HEIGHT * 0.6 };
    return { director: { focus: 'sprout', projectileId: null, x: focus.x, y: focus.y, holdMs: IMPACT_HOLD_MS }, target: focus, tauMs: SPROUT_TAU_MS };
  }

  // A technique of the anime row: the worm, what it sends or what it does it to, where it ends.
  const technique = (world.techniques ?? []).find((t) => t.alive);
  if (technique !== undefined) {
    const focus = techniqueFocus(technique, world.worms ?? []);
    return { director: { focus: 'technique', projectileId: null, x: focus.x, y: focus.y, holdMs: IMPACT_HOLD_MS }, target: focus, tauMs: TECHNIQUE_TAU_MS };
  }

  // A worm thrown by a blast or a blow: follow it until it lands, as the source game does.
  let flyer: { readonly x: number; readonly y: number; readonly speed: number } | null = null;
  for (const worm of world.worms ?? []) {
    if (!worm.alive || worm.motion !== 'flying') continue;
    const speed = Math.hypot(worm.vx, worm.vy);
    if (speed >= FLYER_MIN_SPEED && (flyer === null || speed > flyer.speed)) flyer = { x: worm.x, y: worm.y, speed };
  }
  if (flyer !== null) {
    return { director: { focus: 'flyer', projectileId: null, x: flyer.x, y: flyer.y, holdMs: IMPACT_HOLD_MS }, target: { x: flyer.x, y: flyer.y }, tauMs: PROJECTILE_TAU_MS };
  }

  // The shell we were riding is gone: it detonated, timed out or left the map. Sit on where it was.
  // The same for a finished fight or a worm that has landed.
  if (director.focus === 'projectile' || director.focus === 'combo' || director.focus === 'beam' || director.focus === 'devour' || director.focus === 'hex' || director.focus === 'sprout' || director.focus === 'technique' || director.focus === 'flyer') {
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
