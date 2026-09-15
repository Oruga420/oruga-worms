/**
 * Pure acceptance checks for a generated clip (sound-pipeline.md section 8): duration within
 * tolerance of the request, not silent, not clipped. Voice lines are judged by seconds per
 * character (under 0.06 s per character means the audio was cut, the eleven_v3 failure mode).
 * No I/O here: the loop measures with ffmpeg and hands the numbers in.
 */

import type { Levels, ProbeInfo } from './ffmpeg.ts';
import type { PlanItem } from './plan.ts';

export interface Verdict {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

/**
 * Thresholds tuned on the first real batch (2026-09-03): ElevenLabs masters peak at 0 dBFS by
 * design and an mp3 float decode overshoots by up to about 0.3 dB, so a 0 dB peak is not clipping;
 * short clicks generated in a 0.5 s window sit mostly in silence, so their mean is low and their
 * transient can be around -20 dB while still being a perfectly usable sound after normalization.
 */
export const SILENCE_MEAN_DB = -55;
export const SILENCE_MAX_DB = -30;
export const CLIP_MAX_DB = 0.5;
export const VOICE_MIN_S_PER_CHAR = 0.045;
export const VOICE_MAX_S_PER_CHAR = 0.18;

export function durationTolerance(requestedS: number): number {
  return Math.max(0.15, requestedS * 0.2);
}

export function checkDuration(item: PlanItem, actualS: number): readonly string[] {
  if (item.kind === 'sfx') {
    const tolerance = durationTolerance(item.seconds);
    return Math.abs(actualS - item.seconds) <= tolerance ? [] : [`duration ${actualS.toFixed(2)} s is off the requested ${item.seconds} s by more than ${tolerance.toFixed(2)} s`];
  }
  if (item.kind === 'voice') {
    const perChar = actualS / Math.max(1, item.text.length);
    if (perChar < VOICE_MIN_S_PER_CHAR) return [`voice too short: ${perChar.toFixed(3)} s per character, likely cut`];
    if (perChar > VOICE_MAX_S_PER_CHAR) return [`voice too long: ${perChar.toFixed(3)} s per character`];
    return [];
  }
  const requested = item.lengthMs / 1000;
  return Math.abs(actualS - requested) <= Math.max(2, requested * 0.1) ? [] : [`music duration ${actualS.toFixed(1)} s is off the requested ${requested} s`];
}

export function checkLevels(levels: Levels): readonly string[] {
  const reasons: string[] = [];
  if (levels.meanDb <= SILENCE_MEAN_DB || levels.maxDb <= SILENCE_MAX_DB) reasons.push(`too quiet: mean ${levels.meanDb} dB, max ${levels.maxDb} dB`);
  if (levels.maxDb >= CLIP_MAX_DB) reasons.push(`clipped: max ${levels.maxDb} dB`);
  return reasons;
}

export function checkStream(info: ProbeInfo): readonly string[] {
  const reasons: string[] = [];
  if (info.sampleRate < 44_100) reasons.push(`sample rate ${info.sampleRate} below 44100`);
  if (info.channels < 1) reasons.push('no audio channel');
  return reasons;
}

export function validateClip(item: PlanItem, info: ProbeInfo, levels: Levels): Verdict {
  const reasons = [...checkStream(info), ...checkDuration(item, info.durationS), ...checkLevels(levels)];
  return { ok: reasons.length === 0, reasons };
}

/** Retry policy: attempt 1 at the plan's influence, attempt 2 higher, attempt 3 highest. Voice retries change only the seed. */
export function promptInfluenceFor(attempt: number): number {
  return [0.3, 0.6, 0.8][Math.min(2, Math.max(0, attempt - 1))] ?? 0.3;
}
