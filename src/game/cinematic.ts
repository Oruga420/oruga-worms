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
 *
 * A Saibaman seed gets a lighter touch: the camera leans in as the seed goes in and a little more at
 * every crack of the ground, the world dimming a shade so the green light shows, and eases back out
 * as the Saibaman leaps.
 *
 * The techniques of the anime row each get theirs (techniqueCinematic): the night falls round the
 * worm while it gathers itself, the camera closing in, then eases back to take in what it sends,
 * and the dark lifts once it has landed.
 */

import { clamp } from '../core/math.ts';
import { beamProgress } from '../sim/beam.ts';
import { stageProgress, ticksFor } from '../sim/combo.ts';
import { devourProgress } from '../sim/devour.ts';
import { hexProgress } from '../sim/hex.ts';
import type { BeamBody, ComboBody, DevourBody, HexBody, SproutBody, TechniqueBody } from '../sim/types.ts';
import { techniqueProgress } from '../sim/technique.ts';
import { sproutProgress } from '../sim/sprout.ts';
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

/** How close the camera gets on the ground as it shakes, a little closer at every crack. */
const SPROUT_ZOOM = 1.2;
const CRACK_ZOOM = 0.05;

function sproutCinematic(sprout: SproutBody): Cinematic {
  const p = sproutProgress(sprout);
  switch (sprout.stage) {
    case 'plant':
      return { whiteout: 0, dim: 0, zoom: 1 + (SPROUT_ZOOM - 1) * ease(p), aura: 0 };
    case 'grow':
      return { whiteout: 0, dim: 0.25 * ease(p), zoom: SPROUT_ZOOM + CRACK_ZOOM * sprout.cracks, aura: 0 };
    case 'recover': {
      const from = SPROUT_ZOOM + (sprout.fertile ? CRACK_ZOOM * sprout.cracks : 0);
      return { whiteout: 0, dim: 0.25 * (1 - ease(p / 0.4)) * (sprout.fertile ? 1 : 0), zoom: from - (from - 1) * ease(p), aura: 0 };
    }
  }
}

/**
 * How a technique's stages look, as dim and zoom: the gathering (how dark, how close), the delivery
 * (how dark, how close), and how close the camera is when it lands. The recovery lifts the dark
 * and eases the zoom back to 1 from the delivery's.
 */
interface TechniqueLook {
  readonly gatherDim: number;
  readonly gatherZoom: number;
  readonly deliverDim: number;
  readonly deliverZoom: number;
}

const TECHNIQUE_LOOKS: Readonly<Record<TechniqueBody['kind'], TechniqueLook>> = Object.freeze({
  // The stars of Scorpio light up in the dark, closer and closer as the needles go in.
  needle: { gatherDim: 0.5, gatherZoom: 1.2, deliverDim: 0.6, deliverZoom: 1.35 },
  // Deep space falls round the worm as the galaxies gather; the camera backs off for the throw.
  galaxy: { gatherDim: 0.78, gatherZoom: 1.25, deliverDim: 0.62, deliverZoom: 1 },
  // The lotus in a golden dusk; the wheel's strike close on its worm.
  treasure: { gatherDim: 0.5, gatherZoom: 1.15, deliverDim: 0.55, deliverZoom: 1.3 },
  hiken: { gatherDim: 0.4, gatherZoom: 1.25, deliverDim: 0.3, deliverZoom: 1 },
  // The sky darkens and the camera pulls back to take in the fall.
  meteor: { gatherDim: 0.45, gatherZoom: 0.95, deliverDim: 0.4, deliverZoom: 0.85 },
  // Still air and the swords out, the camera close; the cuts close in on the square.
  dice: { gatherDim: 0.5, gatherZoom: 1.3, deliverDim: 0.62, deliverZoom: 1.35 },
  zoltraak: { gatherDim: 0.45, gatherZoom: 1.15, deliverDim: 0.5, deliverZoom: 1 },
  // The world darkens round the worm as it gathers itself; the burst whites the screen out.
  final: { gatherDim: 0.6, gatherZoom: 1.3, deliverDim: 0.2, deliverZoom: 0.95 },
});

/** How long the Explosión Final's flash takes to fade, as a share of its recovery. */
const FINAL_FLASH_SHARE = 0.4;

/** The gathering stage of each technique; the strike of the treasure on a sealed turn delivers at once. */
function gathering(body: TechniqueBody): boolean {
  switch (body.kind) {
    case 'needle':
      return body.stage === 'point';
    case 'galaxy':
      return body.stage === 'charge';
    case 'treasure':
      return body.stage === 'cast';
    case 'hiken':
      return body.stage === 'windup';
    case 'meteor':
      return body.stage === 'call';
    case 'dice':
      return body.stage === 'draw';
    case 'zoltraak':
      return body.stage === 'form';
    case 'final':
      return body.stage === 'charge';
  }
}

export function techniqueCinematic(body: TechniqueBody): Cinematic {
  const look = TECHNIQUE_LOOKS[body.kind];
  const p = techniqueProgress(body);
  if (gathering(body)) return { whiteout: 0, dim: look.gatherDim * ease(p * 1.5), zoom: 1 + (look.gatherZoom - 1) * ease(p), aura: 0 };
  if (body.stage !== 'recover') {
    // From the gathering's look to the delivery's over the first stretch of it.
    const from = body.kind === 'treasure' && body.mode === 'strike' ? { dim: 0, zoom: 1 } : { dim: look.gatherDim, zoom: look.gatherZoom };
    const k = ease(p * 2.5);
    return { whiteout: 0, dim: from.dim + (look.deliverDim - from.dim) * k, zoom: from.zoom + (look.deliverZoom - from.zoom) * k, aura: 0 };
  }
  const whiteout = body.kind === 'final' ? 1 - ease(p / FINAL_FLASH_SHARE) : 0;
  return { whiteout, dim: look.deliverDim * (1 - ease(p / 0.6)), zoom: look.deliverZoom + (1 - look.deliverZoom) * ease(p), aura: 0 };
}

export function cinematicFor(combos: readonly ComboBody[], beams: readonly BeamBody[] = [], devours: readonly DevourBody[] = [], hexes: readonly HexBody[] = [], sprouts: readonly SproutBody[] = [], techniques: readonly TechniqueBody[] = []): Cinematic {
  const combo = combos.find((c) => c.alive);
  if (combo === undefined) {
    const beam = beams.find((b) => b.alive);
    if (beam !== undefined) return beamCinematic(beam);
    const devour = devours.find((d) => d.alive);
    if (devour !== undefined) return devourCinematic(devour);
    const hex = hexes.find((h) => h.alive);
    if (hex !== undefined) return hexCinematic(hex);
    const sprout = sprouts.find((s) => s.alive);
    if (sprout !== undefined) return sproutCinematic(sprout);
    const technique = techniques.find((t) => t.alive);
    return technique === undefined ? NO_CINEMATIC : techniqueCinematic(technique);
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
