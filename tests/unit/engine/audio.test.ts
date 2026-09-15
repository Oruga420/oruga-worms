import { describe, expect, it } from 'vitest';
import {
  MAX_GAIN_DB,
  SILENCE_DB,
  VOICE_DUCK_DB,
  clampPan,
  createMixer,
  dbToGain,
  gainToDb,
  pitchRate,
  resolveLoopPoints,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BufferSourceLike,
  type GainNodeLike,
  type MixerDeps,
  type StereoPannerLike,
} from '@/engine/audio.ts';

interface FakeParam extends AudioParamLike {
  readonly log: string[];
}

function fakeParam(initial: number): FakeParam {
  const log: string[] = [];
  const param: FakeParam = {
    value: initial,
    log,
    setValueAtTime: (value) => {
      param.value = value;
      log.push(`set ${value.toFixed(3)}`);
    },
    linearRampToValueAtTime: (value, time) => {
      param.value = value;
      log.push(`ramp ${value.toFixed(3)} @${time.toFixed(3)}`);
    },
    cancelScheduledValues: () => {
      log.push('cancel');
    },
  };
  return param;
}

interface FakeNode extends AudioNodeLike {
  connectedTo: FakeNode | null;
  disconnected: number;
}

function fakeNode(): FakeNode {
  const node: FakeNode = {
    connectedTo: null,
    disconnected: 0,
    connect: (destination) => {
      node.connectedTo = destination as FakeNode;
    },
    disconnect: () => {
      node.connectedTo = null;
      node.disconnected += 1;
    },
  };
  return node;
}

interface FakeGain extends FakeNode, GainNodeLike {
  readonly gain: FakeParam;
}

interface FakePanner extends FakeNode, StereoPannerLike {
  readonly pan: FakeParam;
}

interface FakeSource extends FakeNode, BufferSourceLike {
  readonly playbackRate: FakeParam;
  starts: number;
  stops: number;
}

function fakeSource(): FakeSource {
  const source: FakeSource = Object.assign(fakeNode(), {
    buffer: null as AudioBufferLike | null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    playbackRate: fakeParam(1),
    onended: null as ((event: Event) => void) | null,
    starts: 0,
    stops: 0,
    start: () => {
      source.starts += 1;
    },
    stop: () => {
      source.stops += 1;
    },
  });
  return source;
}

interface FakeContext extends AudioContextLike {
  state: string;
  currentTime: number;
  resume: () => Promise<void>;
  resumes: number;
  readonly sources: FakeSource[];
  readonly gains: FakeGain[];
  readonly panners: FakePanner[];
  readonly decoded: number[];
}

function fakeContext(): FakeContext {
  const ctx: FakeContext = {
    currentTime: 0,
    state: 'suspended',
    destination: fakeNode(),
    resumes: 0,
    sources: [],
    gains: [],
    panners: [],
    decoded: [],
    resume: async () => {
      ctx.resumes += 1;
      ctx.state = 'running';
    },
    createGain: () => {
      const gain: FakeGain = Object.assign(fakeNode(), { gain: fakeParam(1) });
      ctx.gains.push(gain);
      return gain;
    },
    createStereoPanner: () => {
      const panner: FakePanner = Object.assign(fakeNode(), { pan: fakeParam(0) });
      ctx.panners.push(panner);
      return panner;
    },
    createBufferSource: () => {
      const source = fakeSource();
      ctx.sources.push(source);
      return source;
    },
    decodeAudioData: async (data) => {
      ctx.decoded.push(data.byteLength);
      if (data.byteLength === 0) throw new Error('undecodable');
      // Byte length doubles as duration in ms so tests control the decoded duration.
      return { duration: data.byteLength / 1000 };
    },
  };
  return ctx;
}

type Json = Record<string, unknown>;

function entry(id: string, bus: string, extra: Json = {}): Json {
  return {
    id,
    bus,
    group: 'test',
    files: { ogg: `audio/${id}.ogg`, mp3: `audio/${id}.mp3` },
    durationMs: 1000,
    loop: false,
    loopStartMs: 0,
    loopEndMs: 0,
    gainDb: 0,
    pitchVariance: 0,
    status: 'ok',
    ...extra,
  };
}

const ASSETS: readonly Json[] = [
  entry('shot', 'sfx', { pitchVariance: 0.08, gainDb: -3, durationMs: 500 }),
  entry('click', 'ui'),
  entry('voice_a', 'voice'),
  entry('voice_b', 'voice'),
  entry('theme', 'music', { loop: true, loopStartMs: 0, loopEndMs: 64000, durationMs: 66038 }),
  entry('wind', 'sfx', { loop: true, loopStartMs: 500, loopEndMs: 0, durationMs: 4000 }),
  entry('silent', 'sfx', { durationMs: 0 }),
  entry('broken', 'sfx', { status: 'failed' }),
];

const MANIFEST = { version: 1, assets: ASSETS };

/** Gain nodes are created at unlock in this order: master, then the buses in BUS_NAMES order. */
const GAIN_INDEX = { master: 0, sfx: 1, voice: 2, music: 3, ui: 4 } as const;

function harness(overrides: Partial<MixerDeps> = {}) {
  const ctx = fakeContext();
  const fetched: string[] = [];
  const draws: number[] = [];
  let createCalls = 0;
  const deps: MixerDeps = {
    createContext: () => {
      createCalls += 1;
      return ctx;
    },
    fetchBytes: async (url) => {
      fetched.push(url);
      const id = url.split('/').pop()?.replace(/\.(ogg|mp3)$/, '') ?? '';
      const asset = ASSETS.find((candidate) => candidate['id'] === id);
      if (asset === undefined) throw new Error(`404 ${url}`);
      return new ArrayBuffer(asset['durationMs'] as number);
    },
    supportsOgg: () => true,
    random: () => draws.shift() ?? 0.5,
    ...overrides,
  };
  const mixer = createMixer(deps);
  return { mixer, ctx, fetched, draws, createCalls: () => createCalls };
}

async function ready(overrides: Partial<MixerDeps> = {}) {
  const h = harness(overrides);
  expect(h.mixer.loadManifest(MANIFEST, '/assets').ok).toBe(true);
  expect(await h.mixer.unlock()).toBe(true);
  await h.mixer.preload();
  return h;
}

function chain(node: FakeNode | null): FakeNode[] {
  const out: FakeNode[] = [];
  let current = node;
  while (current !== null) {
    out.push(current);
    current = current.connectedTo;
  }
  return out;
}

function lastSource(ctx: FakeContext): FakeSource {
  const source = ctx.sources[ctx.sources.length - 1];
  if (source === undefined) throw new Error('no source was created');
  return source;
}

function gainOf(ctx: FakeContext, index: number): FakeGain {
  const gain = ctx.gains[index];
  if (gain === undefined) throw new Error(`no gain node ${index}`);
  return gain;
}

describe('audio: dB, pan and pitch math', () => {
  it('converts dB to gain with a silence floor and a ceiling', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 9);
    expect(dbToGain(SILENCE_DB)).toBe(0);
    expect(dbToGain(-200)).toBe(0);
    expect(dbToGain(Number.NaN)).toBe(0);
    expect(dbToGain(40)).toBeCloseTo(Math.pow(10, MAX_GAIN_DB / 20), 9);
  });

  it('converts gain back to dB and pins zero to the floor', () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(gainToDb(0)).toBe(SILENCE_DB);
    expect(gainToDb(-1)).toBe(SILENCE_DB);
    expect(gainToDb(dbToGain(-12))).toBeCloseTo(-12, 9);
  });

  it('clamps pan into [-1, 1]', () => {
    expect(clampPan(0.5)).toBe(0.5);
    expect(clampPan(5)).toBe(1);
    expect(clampPan(-3)).toBe(-1);
    expect(clampPan(Number.NaN)).toBe(0);
  });

  it('spreads the playback rate by plus or minus the variance', () => {
    expect(pitchRate(0.08, 0)).toBeCloseTo(0.92, 9);
    expect(pitchRate(0.08, 0.5)).toBeCloseTo(1, 9);
    expect(pitchRate(0.08, 1)).toBeCloseTo(1.08, 9);
    expect(pitchRate(0.9, 0)).toBeCloseTo(0.5, 9);
    expect(pitchRate(0.08, Number.NaN)).toBe(1);
    expect(pitchRate(0, 0.99)).toBe(1);
    expect(pitchRate(-1, 0)).toBe(1);
  });

  it('resolves loop points from the manifest ms fields', () => {
    expect(resolveLoopPoints({ loop: true, loopStartMs: 0, loopEndMs: 64000 }, 66.038)).toEqual({ loop: true, startSeconds: 0, endSeconds: 64 });
    expect(resolveLoopPoints({ loop: true, loopStartMs: 500, loopEndMs: 0 }, 4)).toEqual({ loop: true, startSeconds: 0.5, endSeconds: 4 });
    expect(resolveLoopPoints({ loop: true, loopStartMs: 5000, loopEndMs: 1000 }, 4)).toEqual({ loop: true, startSeconds: 0, endSeconds: 0 });
    expect(resolveLoopPoints({ loop: true, loopStartMs: 0, loopEndMs: 90000 }, 4)).toEqual({ loop: true, startSeconds: 0, endSeconds: 4 });
    expect(resolveLoopPoints({ loop: false, loopStartMs: 0, loopEndMs: 64000 }, 66)).toEqual({ loop: false, startSeconds: 0, endSeconds: 0 });
    expect(resolveLoopPoints({ loop: false, loopStartMs: 0, loopEndMs: 0 }, 2, true)).toEqual({ loop: true, startSeconds: 0, endSeconds: 2 });
    expect(resolveLoopPoints({ loop: true, loopStartMs: 0, loopEndMs: 0 }, 2, false).loop).toBe(false);
  });
});

describe('audio: unlock and graph', () => {
  it('does not touch the platform before unlock', () => {
    const h = harness();
    expect(h.createCalls()).toBe(0);
    expect(h.mixer.isUnlocked()).toBe(false);
    expect(h.mixer.report().unlocked).toBe(false);
    expect(h.mixer.play('shot')).toBeNull();
  });

  it('creates the context once, resumes it and builds master plus the four buses', async () => {
    const h = harness();
    expect(await h.mixer.unlock()).toBe(true);
    expect(h.createCalls()).toBe(1);
    expect(h.ctx.resumes).toBe(1);
    expect(h.ctx.gains).toHaveLength(5);
    for (const bus of [GAIN_INDEX.sfx, GAIN_INDEX.voice, GAIN_INDEX.music, GAIN_INDEX.ui]) {
      const route = chain(gainOf(h.ctx, bus));
      expect(route[1]).toBe(gainOf(h.ctx, GAIN_INDEX.master));
      expect(route[2]).toBe(h.ctx.destination);
    }
    expect(await h.mixer.unlock()).toBe(true);
    expect(h.createCalls()).toBe(1);
    expect(h.mixer.isUnlocked()).toBe(true);
  });

  it('stays locked without Web Audio or when resume is refused', async () => {
    const none = harness({ createContext: () => null });
    expect(await none.mixer.unlock()).toBe(false);
    const refused = harness();
    refused.ctx.resume = async () => {
      throw new Error('needs a gesture');
    };
    expect(await refused.mixer.unlock()).toBe(false);
    expect(refused.mixer.isUnlocked()).toBe(false);
  });

  it('applies volumes set before unlock when the graph is built', async () => {
    const h = harness();
    h.mixer.setVolume('music', 0.3);
    h.mixer.setVolume('master', 0.8);
    await h.mixer.unlock();
    expect(gainOf(h.ctx, GAIN_INDEX.music).gain.value).toBeCloseTo(0.3, 9);
    expect(gainOf(h.ctx, GAIN_INDEX.master).gain.value).toBeCloseTo(0.8, 9);
  });
});

describe('audio: manifest', () => {
  it('rejects a bad shape and keeps no manifest', () => {
    const h = harness();
    expect(h.mixer.loadManifest('nope', '/assets').ok).toBe(false);
    expect(h.mixer.loadManifest({ version: 1, assets: [{ id: 'BAD', status: 'ok' }] }, '/assets').ok).toBe(false);
    expect(h.mixer.manifest()).toBeNull();
  });

  it('keeps only status ok assets and never plays a skipped one', async () => {
    const h = await ready();
    expect(h.mixer.manifest()?.skipped).toEqual([{ id: 'broken', status: 'failed' }]);
    expect(h.mixer.play('broken')).toBeNull();
    expect(h.mixer.play('unknown')).toBeNull();
    expect(h.mixer.report().decoded).toBe(6);
  });
});

describe('audio: play routing and defaults', () => {
  it('routes to the asset bus by default and to the option bus when given', async () => {
    const h = await ready();
    const shot = h.mixer.play('shot');
    expect(shot).toMatchObject({ assetId: 'shot', bus: 'sfx' });
    expect(chain(lastSource(h.ctx))).toContain(gainOf(h.ctx, GAIN_INDEX.sfx));
    expect(chain(lastSource(h.ctx))).not.toContain(gainOf(h.ctx, GAIN_INDEX.ui));
    expect(h.mixer.play('click', { bus: 'music' })?.bus).toBe('music');
    expect(chain(lastSource(h.ctx))).toContain(gainOf(h.ctx, GAIN_INDEX.music));
    expect(lastSource(h.ctx).starts).toBe(1);
  });

  it('setVolume changes exactly the bus a sound is routed through', async () => {
    const h = await ready();
    h.mixer.play('shot');
    const route = chain(lastSource(h.ctx));
    h.mixer.setVolume('sfx', 0.5);
    expect(route.filter((node) => (node as FakeGain).gain?.value === 0.5)).toHaveLength(1);
    expect(gainOf(h.ctx, GAIN_INDEX.ui).gain.value).toBe(1);
    h.mixer.setVolume('master', 0.25);
    expect(gainOf(h.ctx, GAIN_INDEX.master).gain.value).toBe(0.25);
    h.mixer.setVolume('sfx', 2);
    expect(h.mixer.volume('sfx')).toBe(1);
    h.mixer.setVolume('ui', -1);
    expect(h.mixer.volume('ui')).toBe(0);
  });

  it('applies the manifest defaults: gain, pitch variance and loop points', async () => {
    const h = await ready();
    h.draws.push(0);
    h.mixer.play('shot');
    const shot = lastSource(h.ctx);
    expect(shot.playbackRate.value).toBeCloseTo(0.92, 9);
    expect((chain(shot)[1] as FakeGain).gain.value).toBeCloseTo(dbToGain(-3), 9);
    expect(shot.loop).toBe(false);
    h.mixer.play('theme');
    const theme = lastSource(h.ctx);
    expect(theme.loop).toBe(true);
    expect(theme.loopStart).toBe(0);
    expect(theme.loopEnd).toBe(64);
    expect(theme.playbackRate.value).toBe(1);
    h.mixer.play('wind');
    const wind = lastSource(h.ctx);
    expect(wind.loop).toBe(true);
    expect(wind.loopStart).toBe(0.5);
    expect(wind.loopEnd).toBe(4);
  });

  it('honours option overrides and clamps the pan', async () => {
    const h = await ready();
    h.draws.push(0);
    h.mixer.play('shot', { gainDb: 0, pitchVariance: 0, loop: true, pan: 5 });
    const source = lastSource(h.ctx);
    const route = chain(source);
    expect((route[1] as FakeGain).gain.value).toBe(1);
    expect(source.playbackRate.value).toBe(1);
    expect(source.loop).toBe(true);
    expect(source.loopEnd).toBe(0.5);
    expect((route[2] as FakePanner).pan.value).toBe(1);
    h.mixer.play('shot', { pan: -3 });
    expect((chain(lastSource(h.ctx))[2] as FakePanner).pan.value).toBe(-1);
  });

  it('returns null and starts a decode for an asset that is not decoded yet', async () => {
    const h = harness();
    h.mixer.loadManifest(MANIFEST, '/assets');
    await h.mixer.unlock();
    expect(h.mixer.play('shot')).toBeNull();
    expect(h.fetched).toEqual(['/assets/audio/shot.ogg']);
    await h.mixer.preload(['shot']);
    expect(h.fetched).toHaveLength(1);
    expect(h.mixer.play('shot')).not.toBeNull();
  });

  it('falls back to the mp3 when ogg is unsupported', async () => {
    const h = harness({ supportsOgg: () => false });
    h.mixer.loadManifest(MANIFEST, '/assets/');
    await h.mixer.unlock();
    await h.mixer.preload(['click']);
    expect(h.fetched).toEqual(['/assets/audio/click.mp3']);
  });
});

describe('audio: stop and cleanup', () => {
  it('stop stops the source, drops it from the active set and is idempotent', async () => {
    const h = await ready();
    const handle = h.mixer.play('shot');
    expect(handle).not.toBeNull();
    if (handle === null) return;
    expect(h.mixer.report().active).toBe(1);
    expect(h.mixer.stop(handle)).toBe(true);
    expect(lastSource(h.ctx).stops).toBe(1);
    expect(lastSource(h.ctx).disconnected).toBe(1);
    expect(h.mixer.report().active).toBe(0);
    expect(h.mixer.stop(handle)).toBe(false);
  });

  it('stopAll stops one bus or everything', async () => {
    const h = await ready();
    h.mixer.play('shot');
    h.mixer.play('click');
    h.mixer.play('theme');
    expect(h.mixer.stopAll('sfx')).toBe(1);
    expect(h.mixer.report().active).toBe(2);
    expect(h.mixer.stopAll()).toBe(2);
    expect(h.mixer.report().active).toBe(0);
  });

  it('onended releases the bookkeeping', async () => {
    const h = await ready();
    h.mixer.play('shot');
    const source = lastSource(h.ctx);
    source.onended?.(new Event('ended'));
    expect(h.mixer.report().active).toBe(0);
    expect(source.disconnected).toBe(1);
    expect(h.mixer.report().buses.sfx.active).toBe(0);
  });
});

describe('audio: ducking', () => {
  it('lowers the bus by the dB amount and the release restores it', async () => {
    const h = await ready();
    const music = gainOf(h.ctx, GAIN_INDEX.music);
    const release = h.mixer.duck('music', 6, 40);
    expect(music.gain.value).toBeCloseTo(dbToGain(-6), 9);
    expect(h.mixer.report().buses.music.duckDb).toBe(6);
    expect(music.gain.log).toContain('cancel');
    expect(music.gain.log.some((line) => line.startsWith('ramp') && line.endsWith('@0.040'))).toBe(true);
    release();
    expect(music.gain.value).toBe(1);
    expect(h.mixer.report().buses.music.duckDb).toBe(0);
    release();
    expect(music.gain.value).toBe(1);
  });

  it('overlapping ducks keep the deepest and volume changes respect the duck', async () => {
    const h = await ready();
    const music = gainOf(h.ctx, GAIN_INDEX.music);
    const shallow = h.mixer.duck('music', 6, 0);
    const deep = h.mixer.duck('music', 12, 0);
    expect(music.gain.value).toBeCloseTo(dbToGain(-12), 9);
    deep();
    expect(music.gain.value).toBeCloseTo(dbToGain(-6), 9);
    h.mixer.setVolume('music', 0.5);
    expect(music.gain.value).toBeCloseTo(0.5 * dbToGain(-6), 9);
    shallow();
    expect(music.gain.value).toBeCloseTo(0.5, 9);
  });
});

describe('audio: voice lines', () => {
  it('plays one voice at a time, replacing the running line', async () => {
    const h = await ready();
    const first = h.mixer.play('voice_a');
    const firstSource = lastSource(h.ctx);
    const second = h.mixer.play('voice_b');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(firstSource.stops).toBe(1);
    expect(h.mixer.report().buses.voice.active).toBe(1);
    if (first !== null) expect(h.mixer.stop(first)).toBe(false);
  });

  it('ducks music and sfx by 6 dB while a voice plays and restores them when it ends', async () => {
    const h = await ready();
    expect(VOICE_DUCK_DB).toBe(6);
    h.mixer.play('voice_a');
    const expected = dbToGain(-VOICE_DUCK_DB);
    expect(gainOf(h.ctx, GAIN_INDEX.music).gain.value).toBeCloseTo(expected, 9);
    expect(gainOf(h.ctx, GAIN_INDEX.sfx).gain.value).toBeCloseTo(expected, 9);
    expect(gainOf(h.ctx, GAIN_INDEX.ui).gain.value).toBe(1);
    expect(gainOf(h.ctx, GAIN_INDEX.voice).gain.value).toBe(1);
    lastSource(h.ctx).onended?.(new Event('ended'));
    expect(gainOf(h.ctx, GAIN_INDEX.music).gain.value).toBe(1);
    expect(gainOf(h.ctx, GAIN_INDEX.sfx).gain.value).toBe(1);
    expect(h.mixer.report().buses.music.duckDb).toBe(0);
  });

  it('keeps the duck while a replacement line takes over and releases it on stop', async () => {
    const h = await ready();
    h.mixer.play('voice_a');
    const second = h.mixer.play('voice_b');
    expect(gainOf(h.ctx, GAIN_INDEX.music).gain.value).toBeCloseTo(dbToGain(-VOICE_DUCK_DB), 9);
    if (second !== null) h.mixer.stop(second);
    expect(gainOf(h.ctx, GAIN_INDEX.music).gain.value).toBe(1);
  });
});

describe('audio: preload and caches', () => {
  it('fetches before unlock, decodes after, and reports unknown ids', async () => {
    const h = harness();
    h.mixer.loadManifest(MANIFEST, '/assets');
    const early = await h.mixer.preload(['shot', 'nope', 'broken']);
    expect(early).toMatchObject({ requested: 3, fetched: 1, decoded: 0 });
    expect(early.failed.map((failure) => failure.id)).toEqual(['nope', 'broken']);
    expect(h.mixer.report().cachedBytes).toBe(1);
    expect(h.ctx.decoded).toEqual([]);
    await h.mixer.unlock();
    const late = await h.mixer.preload(['shot']);
    expect(late).toMatchObject({ requested: 1, fetched: 0, decoded: 1, failed: [] });
    expect(h.fetched).toHaveLength(1);
    expect(h.mixer.report()).toMatchObject({ decoded: 1, cachedBytes: 0 });
  });

  it('reports fetch and decode failures without throwing', async () => {
    const h = await ready({
      fetchBytes: async (url) => {
        if (url.includes('click')) throw new Error('boom');
        return new ArrayBuffer(url.includes('silent') ? 0 : 100);
      },
    });
    const report = await h.mixer.preload(['click', 'silent', 'shot']);
    expect(report.decoded).toBe(1);
    expect(report.failed).toEqual([
      { id: 'click', message: 'boom' },
      { id: 'silent', message: 'undecodable' },
    ]);
    expect(h.mixer.play('silent')).toBeNull();
  });

  it('report exposes the mixer state', async () => {
    const h = await ready();
    h.mixer.play('shot');
    const report = h.mixer.report();
    expect(report.unlocked).toBe(true);
    expect(report.master).toBe(1);
    expect(report.active).toBe(1);
    expect(report.buses.sfx).toEqual({ volume: 1, duckDb: 0, gain: 1, active: 1 });
    expect(Object.isFrozen(report)).toBe(true);
  });
});
