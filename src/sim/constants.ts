/**
 * Simulation tunables in world units (Worms pixels) and seconds. Source values in px per frame
 * at the original 50 fps go through units.ts; everything else is v1 tuning exposed here so the
 * dev overlay sliders (Phase 3.1) have one place to read from.
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import { pxPerSourceFrameToPxPerSecond, SIM_HZ, SOURCE_HZ } from '../config/units.ts';
import { SOURCE_GRAVITY_PX_PER_FRAME_SQ } from '../weapons/defs/shared.ts';

export const TICK_S = 1 / SIM_HZ;
/** 0.25 px per frame squared at 50 fps is 625 px per second squared. */
export const GRAVITY_PX_PER_S2 = SOURCE_GRAVITY_PX_PER_FRAME_SQ * SOURCE_HZ * SOURCE_HZ;

export const WORM_WIDTH = GAME_CONFIG.wormHitbox.w;
export const WORM_HEIGHT = GAME_CONFIG.wormHitbox.h;
export const WORM_HALF_WIDTH = Math.floor(WORM_WIDTH / 2);
/** A worm climbs slopes up to this many pixels per step and is stopped by anything taller. */
export const STEP_UP_PX = 6;
/** A worm walking off a ledge snaps down this far before it counts as falling. */
export const STEP_DOWN_PX = 2;

export const WALK_SPEED_PX_PER_S = pxPerSourceFrameToPxPerSecond(1.2);
export const JUMP_VX_PX_PER_S = pxPerSourceFrameToPxPerSecond(1.6);
export const JUMP_VY_PX_PER_S = -pxPerSourceFrameToPxPerSecond(3.6);
export const BACKFLIP_VX_PX_PER_S = -pxPerSourceFrameToPxPerSecond(0.9);
export const BACKFLIP_VY_PX_PER_S = -pxPerSourceFrameToPxPerSecond(5.2);

/** Terminal fall speed of the source (32 px per frame) in px per second. */
export const TERMINAL_FALL_PX_PER_S = pxPerSourceFrameToPxPerSecond(GAME_CONFIG.fallDamage.terminalPxPerFrame);

/** A blasted worm bounces off walls with these until it is slow enough to land. */
export const WORM_FLY_RESTITUTION = 0.35;
export const WORM_FLY_FRICTION = 0.6;
/**
 * BlastSpec.knockback is already px per second (shared.ts converts the source px per frame
 * through units.ts: bazooka 10 px per frame is 500 px per second at the center). This scale is a
 * tuning knob for Phase 3.1, 1 means the source figure as is.
 */
export const KNOCKBACK_SCALE = 1;
/** Melee knockback vectors are px per second as well. */
export const MELEE_KNOCKBACK_SCALE = 1;

/** Below this speed a body counts as still; after REST_TICKS still ticks it is at rest. */
export const REST_SPEED_PX_PER_S = 4;
export const REST_TICKS = 6;
/** Bounces slower than this stop instead of bouncing again. */
export const MIN_BOUNCE_SPEED_PX_PER_S = 20;

/** Ray march step against the mask; 1 px kills tunnelling at full power (architecture.md section C). */
export const SWEEP_STEP_PX = 1;
export const MAX_SWEEP_STEPS = 4096;

export const DROWN_SINK_PX_PER_S = 40;
export const DROWN_DEPTH_PX = 48;

export const CRATE_FALL_PX_PER_S = 60;
export const CRATE_SIZE_PX = 12;
export const MINE_RADIUS_PX = 4;
/**
 * Ground time between hops. With 0.9 s and a 300 px/s hop (0.96 s in the air) the sheep spent half
 * its life mid arc; 1.4 s with the lighter hop in animals.ts makes it run and hop over obstacles.
 */
export const SHEEP_HOP_INTERVAL_S = 1.4;
export const STRIKE_BOMB_VX_PX_PER_S = 40;

/**
 * Jetpack flight. Thrust beats gravity (625) by enough to climb briskly while the jump key is
 * held, the sideways nudge steers without turning the worm into a rocket, and the speed cap keeps
 * a frame's travel well inside the sweep so the worm never tunnels through a ceiling.
 */
export const JETPACK_THRUST_PX_PER_S2 = 1100;
export const JETPACK_SIDE_ACCEL_PX_PER_S2 = 420;
export const JETPACK_MAX_SPEED_PX_PER_S = 220;
