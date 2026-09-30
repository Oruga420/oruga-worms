/**
 * The super move's camera work, read straight off the sim's live combo (pure, so it is unit
 * tested): the super freeze dims the world around the attacker and pulls the camera in, the rush
 * turns the screen white, the flurry keeps it white with a flicker on every blow while the
 * fighters show as silhouettes, the finisher flashes it fully white, and the recovery lets the
 * world come back. A whiffed rush gets the freeze and the pull in, never the white screen.
 *
 * A beam super gets its own: the world darkens and the camera closes in on the worm while the ki
 * gathers, then it pulls back as the beam leaves the hands, and the dark lifts as the beam fades.
 *
 * So does Gear 5: the world darkens and the camera closes in a step on every drum, pulls back to
 * take in the arm as it shoots out, pushes in on the mouth for the meal, and eases off for the burp.
 *
 * And the Freezer: the world darkens round the worm pointing as the light gathers, the camera eases
 * back for the light's flight, then closes in on the victim as it floats and more and more as it
 * swells, and pulls back out as it bursts, the dark lifting so the pieces show.
 */

import { clamp } from '../core/math.ts';
import { beamProgress } from '../sim/beam.ts';
import { stageProgress, ticksFor } from '../sim/combo.ts';
import { devourProgress } from '../sim/devour.ts';
import { hexProgress } from '../sim/hex.ts';
import type { BeamBody, ComboBody, DevourBody, HexBody } from '../sim/types.ts';
import { drumBounce } from './gear-five.ts';

export interface Cinematic {
  /** 0..1 white over the world, the fighters in black on top. */
  readonly whiteout: number;
  /** 0..1 black over the world, the fighters in colour on top: the super freeze. */
  readonly dim: number;
  /** Multiplier on the camera zoom. */
  readonly zoom: number;
  /** 0..1 strength of the attacker's aura. */
  readonly aura: number;
}

export const NO_CINEMATIC: Cinematic = Object.freeze({ whiteout: 0, dim: 0, zoom: 1, aura: 0 });

/** Ticks the white fades out over once the finisher has landed. */
const FADE_TICKS = 14;
/** How close the camera gets for the beating: the fighters fill the middle of the screen. */
const FLURRY_ZOOM = 1.75;

function ease(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** How close the camera gets on a worm charging a beam, and how far out it goes for the beam. */
const CHARGE_ZOOM = 1.35;
const BEAM_ZOOM = 0.95;

function beamCinematic(beam: BeamBody): Cinematic {
  const p = beamProgress(beam);
  switch (beam.stage) {
    case 'charge':
      return { whiteout: 0, dim: 0.5 * ease(p * 1.5), zoom: 1 + (CHARGE_ZOOM - 1) * ease(p), aura: ease(p * 1.5) };
    case 'fire':
      return { whiteout: 0, dim: 0.5 - 0.1 * p, zoom: CHARGE_ZOOM + (BEAM_ZOOM - CHARGE_ZOOM) * ease(p * 1.6), aura: 1 };
    case 'hold':
      return { whiteout: 0, dim: 0.4, zoom: BEAM_ZOOM, aura: 0.8 };
    case 'fade':
      return { whiteout: 0, dim: 0.4 * (1 - p), zoom: BEAM_ZOOM + (1 - BEAM_ZOOM) * ease(p), aura: 0.8 * (1 - p) };
  }
}

/** How close the camera gets as Gear 5 awakens, and on the meal. */
const AWAKEN_ZOOM = 1.3;
const MEAL_ZOOM = 1.35;

function devourCinematic(devour: DevourBody): Cinematic {
  const p = devourProgress(devour);
  switch (devour.stage) {
    case 'awaken':
      return { whiteout: 0, dim: 0.55 * ease(p * 1.4), zoom: 1 + (AWAKEN_ZOOM - 1) * ease(p) + 0.05 * Math.max(0, drumBounce(devour)), aura: 0 };
    case 'stretch':
      return { whiteout: 0, dim: 0.55 - 0.2 * p, zoom: AWAKEN_ZOOM - (AWAKEN_ZOOM - 1) * ease(p), aura: 0 };
    case 'reel':
      return { whiteout: 0, dim: 0.35, zoom: 1 + (MEAL_ZOOM - 1) * ease(p), aura: 0 };
    case 'chew':
      return { whiteout: 0, dim: 0.45, zoom: MEAL_ZOOM, aura: 0 };
    case 'recover':
      return { whiteout: 0, dim: 0.45 * (1 - ease(p)), zoom: MEAL_ZOOM - (MEAL_ZOOM - 1) * ease(p), aura: 0 };
  }
}

/** How close the camera gets on the worm pointing, for the light's flight, and on the victim floating and at its fullest. */
const POINT_ZOOM = 1.2;
const FLIGHT_ZOOM = 1.05;
const FLOAT_ZOOM = 1.25;
const SWELL_ZOOM = 1.45;

function hexCinematic(hex: HexBody): Cinematic {
  const p = hexProgress(hex);
  switch (hex.stage) {
    case 'point':
      return { whiteout: 0, dim: 0.5 * ease(p * 1.5), zoom: 1 + (POINT_ZOOM - 1) * ease(p), aura: 0 };
    case 'shot':
      return { whiteout: 0, dim: 0.5, zoom: POINT_ZOOM - (POINT_ZOOM - FLIGHT_ZOOM) * ease(p), aura: 0 };
    case 'rise':
      return { whiteout: 0, dim: 0.5, zoom: FLIGHT_ZOOM + (FLOAT_ZOOM - FLIGHT_ZOOM) * ease(p), aura: 0 };
    case 'swell':
      return { whiteout: 0, dim: 0.5 + 0.15 * p, zoom: FLOAT_ZOOM + (SWELL_ZOOM - FLOAT_ZOOM) * ease(p), aura: 0 };
    case 'recover': {
      const from = hex.burst ? SWELL_ZOOM : FLIGHT_ZOOM;
      return { whiteout: 0, dim: (hex.burst ? 0.3 : 0.5) * (1 - ease(p / 0.6)), zoom: from - (from - 1) * ease(p), aura: 0 };
    }
  }
}

export function cinematicFor(combos: readonly ComboBody[], beams: readonly BeamBody[] = [], devours: readonly DevourBody[] = [], hexes: readonly HexBody[] = []): Cinematic {
  const combo = combos.find((c) => c.alive);
  if (combo === undefined) {
    const beam = beams.find((b) => b.alive);
    if (beam !== undefined) return beamCinematic(beam);
    const devour = devours.find((d) => d.alive);
    if (devour !== undefined) return devourCinematic(devour);
    const hex = hexes.find((h) => h.alive);
    return hex === undefined ? NO_CINEMATIC : hexCinematic(hex);
  }
  const p = stageProgress(combo);
  const landed = combo.victimId !== null;
  switch (combo.stage) {
    case 'startup':
      return { whiteout: 0, dim: 0.55 * ease(p * 3), zoom: 1 + 0.3 * ease(p), aura: ease(p * 2) };
    case 'dash':
      return { whiteout: landed ? 0.93 * ease(p) : 0, dim: 0.55 * (1 - p), zoom: 1.3 + (landed ? 0.45 : 0.1) * ease(p), aura: 1 - p };
    case 'flurry': {
      const interval = ticksFor(combo.spec.hitIntervalMs);
      const onBlow = (combo.stageTicks - 1) % interval === 0;
      return { whiteout: onBlow ? 1 : 0.93, dim: 0, zoom: FLURRY_ZOOM + (onBlow ? 0.05 : 0), aura: 0 };
    }
    case 'finisher':
      return { whiteout: 1, dim: 0, zoom: FLURRY_ZOOM + 0.08, aura: 0 };
    case 'recover': {
      const fade = clamp(combo.stageTicks / FADE_TICKS, 0, 1);
      const from = landed ? FLURRY_ZOOM : 1.4;
      return { whiteout: landed && combo.hitsLanded > 0 ? 0.93 * (1 - fade) : 0, dim: 0, zoom: 1 + (from - 1) * (1 - ease(p)), aura: 0 };
    }
  }
}
