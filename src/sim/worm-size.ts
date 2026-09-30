/**
 * A worm's size: a full worm is 1, a Saibaman sprouted from a seed (sim/sprout.ts) is half of one,
 * in height and in width. Whatever reads the hitbox (walking under a ceiling, a blast, a bullet, a
 * punch or a beam finding its mark, a crate picked up, a mine tripped) asks here instead of reading
 * the full size constants, so a small worm really is a smaller target and fits smaller holes.
 */

import { WORM_HALF_WIDTH, WORM_HEIGHT } from './constants.ts';

/** Anything with a size: a body, or a point standing in for one (1 when absent). */
export interface Sized {
  readonly size?: number;
}

/** Hitbox height, world px. */
export function wormHeight(worm: Sized): number {
  return WORM_HEIGHT * (worm.size ?? 1);
}

/** Half the hitbox width in whole pixels, at least 1: the walking code scans the footprint pixel by pixel. */
export function wormHalfWidth(worm: Sized): number {
  return Math.max(1, Math.round(WORM_HALF_WIDTH * (worm.size ?? 1)));
}

/** The middle of the body, world px: where a blast measures from and where a gun aims. */
export function wormMiddleY(worm: Sized & { readonly y: number }): number {
  return worm.y - wormHeight(worm) / 2;
}
