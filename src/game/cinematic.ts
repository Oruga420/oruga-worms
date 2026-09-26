/**
 * The super move's camera work, read straight off the sim's live combo (pure, so it is unit
 * tested): the super freeze dims the world around the attacker and pulls the camera in, the rush
 * turns the screen white, the flurry keeps it white with a flicker on every blow while the
 * fighters show as silhouettes, the finisher flashes it fully white, and the recovery lets the
 * world come back. A whiffed rush gets the freeze and the pull in, never the white screen.
 */

import { clamp } from '../core/math.ts';
import { stageProgress, ticksFor } from '../sim/combo.ts';
import type { ComboBody } from '../sim/types.ts';

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

export function cinematicFor(combos: readonly ComboBody[]): Cinematic {
  const combo = combos.find((c) => c.alive);
  if (combo === undefined) return NO_CINEMATIC;
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
