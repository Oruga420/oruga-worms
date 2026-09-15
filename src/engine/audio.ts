/**
 * Native Web Audio mixer (ultraplan rev 2 decision: "Native Web Audio mixer, about 200 lines:
 * buses sfx, voice, music, ui, pan by worm x, 8 percent pitch variance, duck music and sfx 6 dB
 * while a voice line plays"; Howler dropped). Everything the browser provides sits behind
 * AudioContextLike so the routing, the dB math and the ducking are unit tested with fakes; the
 * real AudioContext satisfies the interfaces structurally and createBrowserMixerDeps proves it
 * at compile time.
 *
 * Graph: source -> sound gain -> stereo panner -> bus gain -> master -> destination.
 * The AudioContext is created lazily in unlock(), which must run from a user gesture handler
 * (pointerdown or keydown): a context created anywhere else stays suspended.
 *
 * MUTATION NOTE: the mixer is a stateful device (nodes, caches, active voices) and mutates its
 * private maps in place; nothing it hands out is mutated afterwards.
 */

import { clamp } from '../core/math.ts';
import type { Result } from '../core/result.ts';
import { joinUrl } from '../core/validate.ts';
import {
  BUS_NAMES,
  validateAudioManifest,
  type AudioAssetInfo,
  type AudioManifestError,
  type AudioManifestInfo,
  type BusName,
} from './audio-manifest.ts';

export { BUS_NAMES } from './audio-manifest.ts';
export type { AudioAssetInfo, AudioManifestError, AudioManifestInfo, BusName } from './audio-manifest.ts';

/** Music and sfx drop this much while a voice line plays (ultraplan). */
export const VOICE_DUCK_DB = 6;
export const VOICE_DUCK_ATTACK_MS = 40;
export const VOICE_DUCK_RELEASE_MS = 250;
export const VOICE_DUCKED_BUSES: readonly BusName[] = Object.freeze(['music', 'sfx']);
export const VOLUME_RAMP_MS = 20;
/** Widest pitch variance accepted, plus or minus 50 percent. */
export const MAX_PITCH_VARIANCE = 0.5;
/** At or below this many dB the gain is exactly zero. */
export const SILENCE_DB = -80;
export const MAX_GAIN_DB = 12;

export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= SILENCE_DB) return 0;
  return Math.pow(10, Math.min(db, MAX_GAIN_DB) / 20);
}

export function gainToDb(gain: number): number {
  if (!(gain > 0)) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(gain));
}

export function clampPan(pan: number): number {
  return Number.isFinite(pan) ? clamp(pan, -1, 1) : 0;
}

export function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? clamp(volume, 0, 1) : 0;
}

export function clampPitchVariance(variance: number): number {
  return Number.isFinite(variance) ? clamp(variance, 0, MAX_PITCH_VARIANCE) : 0;
}

/** Playback rate for a variance fraction and a uniform draw in [0, 1): 1 plus or minus variance. */
export function pitchRate(variance: number, draw: number): number {
  const spread = clampPitchVariance(variance);
  const unit = Number.isFinite(draw) ? clamp(draw, 0, 1) : 0.5;
  return 1 + (unit * 2 - 1) * spread;
}

export interface LoopPoints {
  readonly loop: boolean;
  readonly startSeconds: number;
  /** 0 means "to the end of the buffer", as in Web Audio. */
  readonly endSeconds: number;
}

/** Loop points in seconds from the manifest ms fields; an inverted window keeps the loop but drops the points. */
export function resolveLoopPoints(asset: Pick<AudioAssetInfo, 'loop' | 'loopStartMs' | 'loopEndMs'>, durationSeconds: number, loopOverride?: boolean): LoopPoints {
  const loop = loopOverride ?? asset.loop;
  if (!loop) return Object.freeze({ loop: false, startSeconds: 0, endSeconds: 0 });
  const start = Math.max(0, asset.loopStartMs / 1000);
  const wanted = asset.loopEndMs > 0 ? asset.loopEndMs / 1000 : durationSeconds;
  const end = durationSeconds > 0 ? Math.min(wanted, durationSeconds) : wanted;
  if (end <= start) return Object.freeze({ loop: true, startSeconds: 0, endSeconds: 0 });
  return Object.freeze({ loop: true, startSeconds: start, endSeconds: end });
}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface StereoPannerLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  onended: ((event: Event) => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerLike;
  createBufferSource(): BufferSourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}

export interface MixerDeps {
  /** Called once, on the first unlock. Null when the platform has no Web Audio. */
  readonly createContext: () => AudioContextLike | null;
  readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  /** Whether the platform decodes Ogg Vorbis; false selects the mp3 file. */
  readonly supportsOgg: () => boolean;
  /** Uniform draw in [0, 1) for the pitch variance. */
  readonly random: () => number;
}

export interface PlayOptions {
  /** Overrides the asset's bus. */
  readonly bus?: BusName;
  /** Stereo position, clamped to [-1, 1]; 0 by default. */
  readonly pan?: number;
  /** Overrides the asset's pitch variance fraction. */
  readonly pitchVariance?: number;
  /** Overrides the asset's loop flag; the manifest loop points still apply. */
  readonly loop?: boolean;
  /** Overrides the asset's gain in dB. */
  readonly gainDb?: number;
}

export interface SoundHandle {
  readonly id: number;
  readonly assetId: string;
  readonly bus: BusName;
}

/** Ends a duck; the bus ramps back over releaseMs (the duck's own ramp time by default). */
export type DuckRelease = (releaseMs?: number) => void;

export type VolumeTarget = BusName | 'master';

export interface BusReport {
  readonly volume: number;
  readonly duckDb: number;
  /** The gain node's current value, volume times the duck factor. */
  readonly gain: number;
  readonly active: number;
}

export interface MixerReport {
  readonly unlocked: boolean;
  readonly master: number;
  readonly buses: Readonly<Record<BusName, BusReport>>;
  readonly active: number;
  readonly decoded: number;
  readonly cachedBytes: number;
}

export interface PreloadFailure {
  readonly id: string;
  readonly message: string;
}

export interface PreloadReport {
  readonly requested: number;
  /** Bytes fetched but not yet decoded because the context does not exist yet. */
  readonly fetched: number;
  readonly decoded: number;
  readonly failed: readonly PreloadFailure[];
}

export interface Mixer {
  /** Creates and resumes the context; call from a user gesture. True once audio can play. */
  unlock(): Promise<boolean>;
  isUnlocked(): boolean;
  /** Validates the manifest, keeps the status ok assets; baseUrl is the asset root the file paths are relative to. */
  loadManifest(json: unknown, baseUrl: string): Result<AudioManifestInfo, AudioManifestError>;
  manifest(): AudioManifestInfo | null;
  /** Fetches (and decodes once the context exists) the given ids, or every asset. */
  preload(ids?: readonly string[]): Promise<PreloadReport>;
  /** Null when locked, unknown, not decoded yet (a decode is started) or skipped by the manifest. */
  play(id: string, options?: PlayOptions): SoundHandle | null;
  stop(handle: SoundHandle): boolean;
  /** Stops every active sound, or those on one bus; returns how many. */
  stopAll(bus?: BusName): number;
  /** Lowers a bus by db over ms until the returned release runs; overlapping ducks take the deepest. */
  duck(bus: BusName, db: number, ms: number): DuckRelease;
  setVolume(target: VolumeTarget, volume: number): void;
  volume(target: VolumeTarget): number;
  report(): MixerReport;
}

interface Graph {
  readonly ctx: AudioContextLike;
  readonly master: GainNodeLike;
  readonly buses: Readonly<Record<BusName, GainNodeLike>>;
}

interface ActiveSound {
  readonly handle: SoundHandle;
  readonly source: BufferSourceLike;
  readonly gain: GainNodeLike;
  readonly panner: StereoPannerLike;
  readonly release: DuckRelease | null;
}

interface Duck {
  readonly bus: BusName;
  readonly db: number;
}

function buildGraph(ctx: AudioContextLike): Graph {
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const buses: Partial<Record<BusName, GainNodeLike>> = {};
  for (const name of BUS_NAMES) {
    const bus = ctx.createGain();
    bus.connect(master);
    buses[name] = bus;
  }
  return { ctx, master, buses: buses as Record<BusName, GainNodeLike> };
}

function rampParam(ctx: AudioContextLike, param: AudioParamLike, target: number, ms: number): void {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  if (ms <= 0) {
    param.setValueAtTime(target, now);
    return;
  }
  param.linearRampToValueAtTime(target, now + ms / 1000);
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

export function createMixer(deps: MixerDeps): Mixer {
  let graph: Graph | null = null;
  let manifest: AudioManifestInfo | null = null;
  let baseUrl = '';
  const volumes: Record<VolumeTarget, number> = { master: 1, sfx: 1, voice: 1, music: 1, ui: 1 };
  const ducks = new Map<number, Duck>();
  const bytes = new Map<string, ArrayBuffer>();
  const buffers = new Map<string, AudioBufferLike>();
  const inflight = new Map<string, Promise<boolean>>();
  const lastError = new Map<string, string>();
  const active = new Map<number, ActiveSound>();
  let nextSoundId = 1;
  let nextDuckId = 1;
  let activeVoice: number | null = null;

  const duckDbOf = (bus: BusName): number => {
    let deepest = 0;
    for (const duck of ducks.values()) if (duck.bus === bus && duck.db > deepest) deepest = duck.db;
    return deepest;
  };
  const busTarget = (bus: BusName): number => volumes[bus] * dbToGain(-duckDbOf(bus));
  const applyBus = (bus: BusName, ms: number): void => {
    if (graph !== null) rampParam(graph.ctx, graph.buses[bus].gain, busTarget(bus), ms);
  };
  const applyAll = (): void => {
    if (graph === null) return;
    graph.master.gain.value = volumes.master;
    for (const bus of BUS_NAMES) graph.buses[bus].gain.value = busTarget(bus);
  };

  const finish = (id: number): void => {
    const entry = active.get(id);
    if (entry === undefined) return;
    active.delete(id);
    entry.release?.();
    entry.source.disconnect();
    entry.gain.disconnect();
    entry.panner.disconnect();
    if (activeVoice === id) activeVoice = null;
  };

  const stopEntry = (entry: ActiveSound): void => {
    try {
      entry.source.stop();
    } catch {
      // Already stopped or never started: nothing left to do but release the bookkeeping.
    }
    finish(entry.handle.id);
  };

  const duck = (bus: BusName, db: number, ms: number): DuckRelease => {
    const id = nextDuckId;
    nextDuckId += 1;
    ducks.set(id, Object.freeze({ bus, db: Math.max(0, db) }));
    applyBus(bus, ms);
    return (releaseMs = ms) => {
      if (!ducks.delete(id)) return;
      applyBus(bus, releaseMs);
    };
  };

  const duckForVoice = (): DuckRelease => {
    const releases = VOICE_DUCKED_BUSES.map((bus) => duck(bus, VOICE_DUCK_DB, VOICE_DUCK_ATTACK_MS));
    return (releaseMs = VOICE_DUCK_RELEASE_MS) => {
      for (const release of releases) release(releaseMs);
    };
  };

  const urlOf = (asset: AudioAssetInfo): string => joinUrl(baseUrl, deps.supportsOgg() ? asset.files.ogg : asset.files.mp3);

  /** Resolves true when the asset is decoded; false when it is only fetched (no context yet) or failed. */
  const ensure = (asset: AudioAssetInfo): Promise<boolean> => {
    if (buffers.has(asset.id)) return Promise.resolve(true);
    const running = inflight.get(asset.id);
    if (running !== undefined) return running;
    const task = (async (): Promise<boolean> => {
      try {
        let data = bytes.get(asset.id);
        if (data === undefined) {
          data = await deps.fetchBytes(urlOf(asset));
          bytes.set(asset.id, data);
        }
        if (graph === null) return false;
        // decodeAudioData takes ownership of the buffer, so the byte cache drops it first.
        bytes.delete(asset.id);
        buffers.set(asset.id, await graph.ctx.decodeAudioData(data));
        lastError.delete(asset.id);
        return true;
      } catch (thrown: unknown) {
        lastError.set(asset.id, messageOf(thrown));
        return false;
      } finally {
        inflight.delete(asset.id);
      }
    })();
    inflight.set(asset.id, task);
    return task;
  };

  const decodeCached = (): void => {
    if (manifest === null) return;
    for (const id of [...bytes.keys()]) {
      const asset = manifest.assets[id];
      if (asset !== undefined) void ensure(asset);
    }
  };

  const isUnlocked = (): boolean => graph !== null && graph.ctx.state === 'running';

  const play = (id: string, options: PlayOptions = {}): SoundHandle | null => {
    if (graph === null || manifest === null) return null;
    const asset = manifest.assets[id];
    if (asset === undefined) return null;
    const buffer = buffers.get(id);
    if (buffer === undefined) {
      void ensure(asset);
      return null;
    }
    const bus = options.bus ?? asset.bus;
    if (bus === 'voice' && activeVoice !== null) {
      const current = active.get(activeVoice);
      if (current !== undefined) stopEntry(current);
    }
    const { ctx } = graph;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const points = resolveLoopPoints(asset, buffer.duration, options.loop);
    source.loop = points.loop;
    source.loopStart = points.startSeconds;
    source.loopEnd = points.endSeconds;
    source.playbackRate.value = pitchRate(options.pitchVariance ?? asset.pitchVariance, deps.random());
    const gain = ctx.createGain();
    gain.gain.value = dbToGain(options.gainDb ?? asset.gainDb);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampPan(options.pan ?? 0);
    source.connect(gain);
    gain.connect(panner);
    panner.connect(graph.buses[bus]);

    const handle: SoundHandle = Object.freeze({ id: nextSoundId, assetId: id, bus });
    nextSoundId += 1;
    const release = bus === 'voice' ? duckForVoice() : null;
    active.set(handle.id, { handle, source, gain, panner, release });
    if (bus === 'voice') activeVoice = handle.id;
    source.onended = () => finish(handle.id);
    source.start(0);
    return handle;
  };

  return {
    unlock: async () => {
      if (graph === null) {
        const ctx = deps.createContext();
        if (ctx === null) return false;
        graph = buildGraph(ctx);
        applyAll();
      }
      if (graph.ctx.state !== 'running') {
        try {
          await graph.ctx.resume();
        } catch {
          return false;
        }
      }
      const unlocked = isUnlocked();
      if (unlocked) decodeCached();
      return unlocked;
    },
    isUnlocked,
    loadManifest: (json, nextBaseUrl) => {
      const result = validateAudioManifest(json);
      if (result.ok) {
        manifest = result.value;
        baseUrl = nextBaseUrl;
      }
      return result;
    },
    manifest: () => manifest,
    preload: async (ids) => {
      const wanted = ids ?? (manifest === null ? [] : Object.keys(manifest.assets));
      const failed: PreloadFailure[] = [];
      let fetched = 0;
      let decoded = 0;
      await Promise.all(
        wanted.map(async (id) => {
          const asset = manifest?.assets[id];
          if (asset === undefined) {
            failed.push(Object.freeze({ id, message: 'unknown or skipped asset' }));
            return;
          }
          await ensure(asset);
          if (buffers.has(id)) decoded += 1;
          else if (bytes.has(id)) fetched += 1;
          else failed.push(Object.freeze({ id, message: lastError.get(id) ?? 'unknown failure' }));
        }),
      );
      return Object.freeze({ requested: wanted.length, fetched, decoded, failed: Object.freeze(failed) });
    },
    play,
    stop: (handle) => {
      const entry = active.get(handle.id);
      if (entry === undefined) return false;
      stopEntry(entry);
      return true;
    },
    stopAll: (bus) => {
      const targets = [...active.values()].filter((entry) => bus === undefined || entry.handle.bus === bus);
      for (const entry of targets) stopEntry(entry);
      return targets.length;
    },
    duck,
    setVolume: (target, volume) => {
      volumes[target] = clampVolume(volume);
      if (graph === null) return;
      if (target === 'master') rampParam(graph.ctx, graph.master.gain, volumes.master, VOLUME_RAMP_MS);
      else applyBus(target, VOLUME_RAMP_MS);
    },
    volume: (target) => volumes[target],
    report: () => {
      const buses: Partial<Record<BusName, BusReport>> = {};
      for (const bus of BUS_NAMES) {
        let count = 0;
        for (const entry of active.values()) if (entry.handle.bus === bus) count += 1;
        buses[bus] = Object.freeze({
          volume: volumes[bus],
          duckDb: duckDbOf(bus),
          gain: graph === null ? busTarget(bus) : graph.buses[bus].gain.value,
          active: count,
        });
      }
      return Object.freeze({
        unlocked: isUnlocked(),
        master: volumes.master,
        buses: Object.freeze(buses as Record<BusName, BusReport>),
        active: active.size,
        decoded: buffers.size,
        cachedBytes: bytes.size,
      });
    },
  };
}

/** Browser wiring; only touches window, document and fetch when called. */
export function createBrowserMixerDeps(): MixerDeps {
  return {
    createContext: () => (typeof AudioContext === 'undefined' ? null : new AudioContext()),
    fetchBytes: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    supportsOgg: () => document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"') !== '',
    random: () => Math.random(),
  };
}
