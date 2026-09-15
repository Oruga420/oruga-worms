/**
 * Aim and charge state for the active worm (the human's, driven by input; the CPU sets it
 * directly from a decision). Aim angle is elevation -90..90; charge builds while fire is held and
 * releases the shot. Immutable, small, and unit tested so the HUD and the fire path share one
 * source of truth.
 */

import { clamp } from '../core/math.ts';

export const AIM_MIN_DEG = -90;
export const AIM_MAX_DEG = 90;
export const AIM_RATE_DEG_PER_S = 60;
/** Full charge in seconds of holding fire. */
export const CHARGE_TIME_S = 1.2;

export interface AimState {
  readonly angleDeg: number;
  readonly charging: boolean;
  /** 0..1 of full power. */
  readonly power: number;
}

export const INITIAL_AIM: AimState = Object.freeze({ angleDeg: 45, charging: false, power: 0 });

export function aimBy(state: AimState, delta: -1 | 0 | 1, dtSeconds: number): AimState {
  if (delta === 0) return state;
  const angleDeg = clamp(state.angleDeg + delta * AIM_RATE_DEG_PER_S * dtSeconds, AIM_MIN_DEG, AIM_MAX_DEG);
  return { ...state, angleDeg };
}

/** Advances the charge while fire is held; a rising power ramps to 1 over CHARGE_TIME_S. */
export function tickCharge(state: AimState, fireHeld: boolean, dtSeconds: number): AimState {
  if (!fireHeld) return state.charging ? { ...state, charging: false } : state;
  const power = clamp(state.power + dtSeconds / CHARGE_TIME_S, 0, 1);
  return { ...state, charging: true, power };
}

export interface ReleaseResult {
  readonly state: AimState;
  /** Power at release, at least a floor so a tap still fires. */
  readonly power: number;
}

export function release(state: AimState): ReleaseResult {
  const power = Math.max(0.1, state.power);
  return { state: { ...state, charging: false, power: 0 }, power };
}

export function setAngle(state: AimState, angleDeg: number): AimState {
  return { ...state, angleDeg: clamp(angleDeg, AIM_MIN_DEG, AIM_MAX_DEG) };
}
