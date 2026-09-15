/**
 * Units: the single source of truth for the time base and the camera scale
 * (ultraplan.html, "Simulation units and tuning" and "Design rules from the bug hunt").
 *
 * WORLD units are Worms Armageddon pixels. No spatial constant is ever converted: the 9 x 16
 * worm hitbox, a 97 px crater and the 48 px mine trigger radius are used exactly as documented.
 *
 * TIME is where conversion happens. The canonical numbers are given in pixels per Worms logic
 * frame; the logic frame rate of the original is community knowledge (50 fps, unverified on any
 * fetched page) and lives here as one constant with one test. The simulation runs at 60 Hz, so
 * every per frame constant passes through these helpers. Nothing is hand converted elsewhere.
 */

/** Simulation ticks per second. */
export const SIM_HZ = 60;

/** Logic frames per second of the source material (Worms Armageddon, community figure). */
export const SOURCE_HZ = 50;

/** Multiply a per source frame quantity by this to get the per tick quantity. */
export const FRAME_SCALE = SOURCE_HZ / SIM_HZ;

/** Milliseconds of simulated time per tick. */
export const TICK_MS = 1000 / SIM_HZ;

/**
 * Accumulator cap: at most this many ticks run per animation frame. The leftover time is
 * discarded after the cap so fuses never drift from the wall clock after a stall.
 */
export const MAX_SUBSTEPS = 5;

/** Speed in px per source frame to px per simulation tick. */
export function pxPerSourceFrameToPxPerTick(pxPerFrame: number): number {
  return pxPerFrame * FRAME_SCALE;
}

/** Speed in px per source frame to px per second (independent of the tick rate). */
export function pxPerSourceFrameToPxPerSecond(pxPerFrame: number): number {
  return pxPerFrame * SOURCE_HZ;
}

/** Acceleration in px per source frame squared to px per tick squared (gravity, wind force). */
export function pxPerSourceFrameSqToPxPerTickSq(pxPerFrameSq: number): number {
  return pxPerFrameSq * FRAME_SCALE * FRAME_SCALE;
}

/** Speed in px per simulation tick back to px per source frame, to compare against the source tables. */
export function pxPerTickToPxPerSourceFrame(pxPerTick: number): number {
  return pxPerTick / FRAME_SCALE;
}

/** A duration counted in source logic frames to simulation ticks. */
export function sourceFramesToTicks(frames: number): number {
  return frames * (SIM_HZ / SOURCE_HZ);
}

/** Milliseconds to whole simulation ticks, rounded to nearest, so a 3000 ms fuse is exactly 180 ticks. */
export function msToTicks(ms: number): number {
  return Math.round((ms * SIM_HZ) / 1000);
}

/** Simulation ticks to milliseconds. */
export function ticksToMs(ticks: number): number {
  return ticks * TICK_MS;
}

/** Camera zoom, world px to screen px. Mouse wheel adjustable between the bounds. */
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 3;
export const ZOOM_DEFAULT = 2.5;

/** Sprites are authored at this multiple of world resolution: a 16 px worm is a 48 px figure in a 96 px frame. */
export const SPRITE_SCALE = 3;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}
