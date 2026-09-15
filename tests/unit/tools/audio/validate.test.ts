import { describe, expect, it } from 'vitest';
import type { PlanItem } from '../../../../tools/audio/plan.ts';
import { checkDuration, checkLevels, durationTolerance, promptInfluenceFor, validateClip } from '../../../../tools/audio/validate.ts';

const sfx: PlanItem = { kind: 'sfx', id: 'wpn_test', group: 'weapons', bus: 'sfx', description: 'a test one-shot', seconds: 1.0, gainDb: 0, loop: false };
const voice: PlanItem = {
  kind: 'voice',
  id: 'voice_test',
  group: 'voice',
  bus: 'voice',
  bank: 'en_comedic',
  event: 'taunt',
  text: 'Did that sting? Good!',
  voiceId: 'x'.repeat(20),
  voiceName: 'Test',
  pitchFactor: 1.3,
  tempo: 0.92,
  settings: { stability: 0.35, similarity_boost: 0.75, style: 0.45, use_speaker_boost: true, speed: 1.05 },
  gainDb: 0,
};

describe('duration checks', () => {
  it('uses a tolerance of at least 150 ms or 20 percent', () => {
    expect(durationTolerance(0.5)).toBe(0.15);
    expect(durationTolerance(3)).toBeCloseTo(0.6, 6);
    expect(checkDuration(sfx, 1.1)).toEqual([]);
    expect(checkDuration(sfx, 1.5)).toHaveLength(1);
  });

  it('judges voice by seconds per character', () => {
    expect(checkDuration(voice, 1.6)).toEqual([]);
    expect(checkDuration(voice, 0.3)[0]).toContain('too short');
    expect(checkDuration(voice, 9)[0]).toContain('too long');
  });
});

describe('level checks', () => {
  it('flags silence and clipping', () => {
    expect(checkLevels({ meanDb: -20, maxDb: -3 })).toEqual([]);
    expect(checkLevels({ meanDb: -39, maxDb: -22 })).toEqual([]);
    expect(checkLevels({ meanDb: -10, maxDb: 0 })).toEqual([]);
    expect(checkLevels({ meanDb: -60, maxDb: -35 })[0]).toContain('quiet');
    expect(checkLevels({ meanDb: -10, maxDb: 1.0 })[0]).toContain('clipped');
  });

  it('combines stream, duration and level checks into one verdict', () => {
    const good = validateClip(sfx, { durationS: 1.0, codec: 'mp3', sampleRate: 44100, channels: 1 }, { meanDb: -20, maxDb: -3 });
    expect(good.ok).toBe(true);
    const bad = validateClip(sfx, { durationS: 2.0, codec: 'mp3', sampleRate: 22050, channels: 1 }, { meanDb: -60, maxDb: -35 });
    expect(bad.ok).toBe(false);
    expect(bad.reasons.length).toBe(3);
  });
});

describe('retry policy', () => {
  it('raises prompt influence per attempt and clamps', () => {
    expect(promptInfluenceFor(1)).toBe(0.3);
    expect(promptInfluenceFor(2)).toBe(0.6);
    expect(promptInfluenceFor(3)).toBe(0.8);
    expect(promptInfluenceFor(9)).toBe(0.8);
  });
});
