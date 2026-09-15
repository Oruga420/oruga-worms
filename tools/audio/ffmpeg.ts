/**
 * ffmpeg and ffprobe wrappers for the sound loop (sound-pipeline.md section 7). Every command
 * is an argument array passed to execFile with shell false; the argument builders are pure and
 * unit tested, the runners return Results. Chain per file: decode the API master to a 48 kHz
 * working file, trim one shots, pitch shift voice, normalize (two pass loudnorm with linear gain,
 * or a peak target for very short clips), then export ogg and mp3.
 */

import { execFile } from 'node:child_process';
import { err, ok, type Result } from '../../src/core/result.ts';

export interface ProbeInfo {
  readonly durationS: number;
  readonly codec: string;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface Levels {
  readonly meanDb: number;
  readonly maxDb: number;
}

export interface LoudnessMeasure {
  readonly inputI: number;
  readonly inputLra: number;
  readonly inputTp: number;
  readonly inputThresh: number;
}

export interface LoudnessTarget {
  readonly integrated: number;
  readonly truePeak: number;
  readonly lra: number;
}

export const TARGETS: Readonly<Record<'sfx' | 'ui' | 'voice' | 'music', LoudnessTarget>> = Object.freeze({
  sfx: { integrated: -16, truePeak: -1, lra: 11 },
  ui: { integrated: -16, truePeak: -1, lra: 11 },
  voice: { integrated: -18, truePeak: -1, lra: 11 },
  music: { integrated: -20, truePeak: -1, lra: 11 },
});

/** Below this duration integrated loudness is unreliable; peak normalize instead (report section 7). */
export const SHORT_CLIP_S = 1.0;
export const SHORT_CLIP_PEAK_DB = -3;

export function trimFilter(): string {
  // Head: keep 5 ms before the first sound at -45 dB. Tail: reverse, trim at -60 dB keeping 60 ms so
  // explosion rumble tails survive (the first pass at -45 dB and 30 ms cut them to a quarter), reverse
  // back. Then anti click fades.
  return [
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.005',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.06',
    'afade=t=in:d=0.02',
    'areverse',
    'afade=t=in:d=0.003',
  ].join(',');
}

export function pitchFilter(factor: number, tempo: number, rate = 48_000): string {
  return `asetrate=${rate}*${factor},aresample=${rate},atempo=${tempo}`;
}

export function loudnormMeasureFilter(target: LoudnessTarget): string {
  return `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.lra}:print_format=json`;
}

export function loudnormApplyFilter(target: LoudnessTarget, measured: LoudnessMeasure): string {
  return (
    `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.lra}` +
    `:measured_I=${measured.inputI}:measured_LRA=${measured.inputLra}:measured_TP=${measured.inputTp}:measured_thresh=${measured.inputThresh}:linear=true`
  );
}

/** Gain in dB that brings the measured peak to the target peak. */
export function peakGainDb(maxDb: number, targetDb = SHORT_CLIP_PEAK_DB): number {
  return Math.round((targetDb - maxDb) * 100) / 100;
}

export function parseVolumeDetect(stderr: string): Result<Levels, string> {
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (mean?.[1] === undefined || max?.[1] === undefined) return err('volumedetect output not found');
  return ok({ meanDb: Number.parseFloat(mean[1]), maxDb: Number.parseFloat(max[1]) });
}

export function parseLoudnorm(stderr: string): Result<LoudnessMeasure, string> {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return err('loudnorm json not found');
  try {
    const json = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const num = (key: string): number => Number.parseFloat(json[key] ?? 'NaN');
    const measure = { inputI: num('input_i'), inputLra: num('input_lra'), inputTp: num('input_tp'), inputThresh: num('input_thresh') };
    if (Object.values(measure).some((v) => !Number.isFinite(v))) return err('loudnorm json has non numeric fields');
    return ok(measure);
  } catch {
    return err('loudnorm json unparsable');
  }
}

export function parseProbe(stdout: string): Result<ProbeInfo, string> {
  try {
    const json = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string; codec_name?: string; sample_rate?: string; channels?: number }[] };
    const audio = (json.streams ?? []).find((s) => s.codec_type === 'audio');
    const duration = Number.parseFloat(json.format?.duration ?? 'NaN');
    if (audio === undefined || !Number.isFinite(duration)) return err('no audio stream or duration');
    return ok({
      durationS: duration,
      codec: audio.codec_name ?? 'unknown',
      sampleRate: Number.parseInt(audio.sample_rate ?? '0', 10),
      channels: audio.channels ?? 0,
    });
  } catch {
    return err('ffprobe output unparsable');
  }
}

function run(command: string, args: readonly string[]): Promise<Result<{ stdout: string; stderr: string }, string>> {
  return new Promise((resolve) => {
    execFile(command, [...args], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve(err(`${command} failed: ${error.message.split('\n')[0] ?? 'error'} ${String(stderr).slice(-300).replace(/\s+/g, ' ')}`));
        return;
      }
      resolve(ok({ stdout: String(stdout), stderr: String(stderr) }));
    });
  });
}

export async function probe(file: string): Promise<Result<ProbeInfo, string>> {
  const result = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-print_format', 'json', file]);
  return result.ok ? parseProbe(result.value.stdout) : result;
}

export async function measureLevels(file: string): Promise<Result<Levels, string>> {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  return result.ok ? parseVolumeDetect(result.value.stderr) : result;
}

export async function measureLoudness(file: string, target: LoudnessTarget): Promise<Result<LoudnessMeasure, string>> {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', loudnormMeasureFilter(target), '-f', 'null', '-']);
  return result.ok ? parseLoudnorm(result.value.stderr) : result;
}

export interface ProcessOptions {
  readonly trim: boolean;
  readonly pitch?: { readonly factor: number; readonly tempo: number };
  readonly target: LoudnessTarget;
  readonly mono: boolean;
}

/** Decodes the master to a 48 kHz working wav applying trim and pitch, without normalization. */
export async function decodeAndShape(input: string, workingWav: string, options: ProcessOptions): Promise<Result<void, string>> {
  const filters: string[] = [];
  if (options.trim) filters.push(trimFilter());
  if (options.pitch !== undefined) filters.push(pitchFilter(options.pitch.factor, options.pitch.tempo));
  const args = ['-y', '-hide_banner', '-nostats', '-i', input, '-ar', '48000', ...(options.mono ? ['-ac', '1'] : []), ...(filters.length > 0 ? ['-af', filters.join(',')] : []), '-c:a', 'pcm_f32le', workingWav];
  const result = await run('ffmpeg', args);
  return result.ok ? ok(undefined) : result;
}

/** Normalizes the working wav in place semantics: writes normalizedWav. Short clips get a peak target, others two pass loudnorm. */
export async function normalize(workingWav: string, normalizedWav: string, durationS: number, target: LoudnessTarget): Promise<Result<{ mode: 'peak' | 'loudnorm'; detail: string }, string>> {
  if (durationS < SHORT_CLIP_S) {
    const levels = await measureLevels(workingWav);
    if (!levels.ok) return levels;
    const gain = peakGainDb(levels.value.maxDb);
    const result = await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', workingWav, '-af', `volume=${gain}dB`, '-c:a', 'pcm_f32le', normalizedWav]);
    return result.ok ? ok({ mode: 'peak', detail: `gain ${gain} dB from peak ${levels.value.maxDb} dB` }) : result;
  }
  const measured = await measureLoudness(workingWav, target);
  if (!measured.ok) return measured;
  const result = await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', workingWav, '-af', loudnormApplyFilter(target, measured.value), '-ar', '48000', '-c:a', 'pcm_f32le', normalizedWav]);
  return result.ok ? ok({ mode: 'loudnorm', detail: `input I ${measured.value.inputI} LUFS, TP ${measured.value.inputTp} dBTP` }) : result;
}

/** ogg (libvorbis q5) primary and mp3 (lame q4) fallback, both 44.1 kHz. */
export async function exportDual(normalizedWav: string, oggPath: string, mp3Path: string): Promise<Result<void, string>> {
  const ogg = await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', normalizedWav, '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '5', oggPath]);
  if (!ogg.ok) return ogg;
  const mp3 = await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', normalizedWav, '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '4', mp3Path]);
  return mp3.ok ? ok(undefined) : mp3;
}
