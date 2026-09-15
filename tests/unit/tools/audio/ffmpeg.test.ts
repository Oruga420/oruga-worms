import { describe, expect, it } from 'vitest';
import {
  loudnormApplyFilter,
  loudnormMeasureFilter,
  parseLoudnorm,
  parseProbe,
  parseVolumeDetect,
  peakGainDb,
  pitchFilter,
  TARGETS,
  trimFilter,
} from '../../../../tools/audio/ffmpeg.ts';

describe('ffmpeg argument builders', () => {
  it('builds the trim chain with head and tail silence removal and anti click fades', () => {
    const f = trimFilter();
    expect(f.startsWith('silenceremove=start_periods=1')).toBe(true);
    expect(f.split('areverse').length).toBe(3);
    expect(f).toContain('afade=t=in:d=0.003');
  });

  it('builds the tape style pitch shift', () => {
    expect(pitchFilter(1.3, 0.92)).toBe('asetrate=48000*1.3,aresample=48000,atempo=0.92');
  });

  it('builds the two loudnorm passes with linear gain', () => {
    expect(loudnormMeasureFilter(TARGETS.sfx)).toBe('loudnorm=I=-16:TP=-1:LRA=11:print_format=json');
    const apply = loudnormApplyFilter(TARGETS.voice, { inputI: -23.5, inputLra: 4.2, inputTp: -6.1, inputThresh: -33.8 });
    expect(apply).toContain('I=-18');
    expect(apply).toContain('measured_I=-23.5');
    expect(apply.endsWith(':linear=true')).toBe(true);
  });

  it('computes the gain to a peak target', () => {
    expect(peakGainDb(-9)).toBe(6);
    expect(peakGainDb(-1.5)).toBe(-1.5);
  });
});

describe('ffmpeg output parsers', () => {
  it('parses volumedetect', () => {
    const r = parseVolumeDetect('[Parsed_volumedetect_0 @ 0x1] mean_volume: -21.3 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -4.0 dB\n');
    expect(r.ok && r.value).toEqual({ meanDb: -21.3, maxDb: -4 });
    expect(parseVolumeDetect('nothing').ok).toBe(false);
  });

  it('parses the loudnorm json block at the end of stderr', () => {
    const stderr = 'noise\n{\n"input_i" : "-23.50",\n"input_tp" : "-6.10",\n"input_lra" : "4.20",\n"input_thresh" : "-33.80",\n"target_offset" : "0.1"\n}\n';
    const r = parseLoudnorm(stderr);
    expect(r.ok && r.value).toEqual({ inputI: -23.5, inputLra: 4.2, inputTp: -6.1, inputThresh: -33.8 });
    expect(parseLoudnorm('no json').ok).toBe(false);
  });

  it('parses ffprobe json', () => {
    const stdout = JSON.stringify({ format: { duration: '0.480000' }, streams: [{ codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 }] });
    const r = parseProbe(stdout);
    expect(r.ok && r.value).toEqual({ durationS: 0.48, codec: 'mp3', sampleRate: 44100, channels: 2 });
    expect(parseProbe('{}').ok).toBe(false);
  });
});
