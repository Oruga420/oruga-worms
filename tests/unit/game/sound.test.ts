import { describe, expect, it } from 'vitest';
import { bankForTeam, boomFor, createSoundDirector, pickVoiceLine, type PlayLike } from '@/game/sound.ts';
import type { GameEvent } from '@/game/controller.ts';
import { buildInitialState, type MatchSetup } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';

interface Played {
  readonly id: string;
  readonly pan?: number;
  readonly bus?: string;
}

function fakeMixer(): { mixer: PlayLike; played: Played[]; ducks: number } {
  const played: Played[] = [];
  const record = { ducks: 0 };
  const mixer: PlayLike = {
    play: (id, options) => {
      played.push({ id, ...(options ?? {}) });
      return {};
    },
    duck: () => {
      record.ducks += 1;
      return () => undefined;
    },
  };
  return { mixer, played, get ducks() { return record.ducks; } };
}

const ALL = (): boolean => true;

function setup(): MatchSetup {
  return {
    seed: 1,
    worldSize: { w: 400, h: 300 },
    waterY: 280,
    startingTeamIndex: 0,
    teams: [
      { name: 'Reds', colorIndex: 0, controller: 'human', wormNames: ['r1'] },
      { name: 'Blues', colorIndex: 1, controller: 'cpu', wormNames: ['b1'] },
    ],
  };
}

function baseState(): MatchState {
  const result = buildInitialState(setup());
  if (!result.ok) throw new Error('setup failed');
  return result.value;
}

describe('boomFor and bankForTeam', () => {
  it('picks a boom by radius', () => {
    expect(boomFor(150)).toBe('exp_large');
    expect(boomFor(97)).toBe('exp_medium_1');
    expect(boomFor(40)).toBe('exp_small_1');
  });

  it('gives each color a bank', () => {
    expect(bankForTeam(0)).toBe('en_comedic');
    expect(bankForTeam(1)).toBe('drill');
    expect(bankForTeam(2)).toBe('es_mx');
  });
});

describe('pickVoiceLine', () => {
  it('picks an existing numbered variant deterministically', () => {
    const has = (id: string): boolean => id === 'voice_drill_hurt_1' || id === 'voice_drill_hurt_2';
    expect(pickVoiceLine(has, 'drill', 'hurt', () => 0)).toBe('voice_drill_hurt_1');
    expect(pickVoiceLine(has, 'drill', 'hurt', () => 0.99)).toBe('voice_drill_hurt_2');
    expect(pickVoiceLine(has, 'drill', 'missing', () => 0)).toBeNull();
  });
});

describe('handleEvents', () => {
  it('plays sim sound cues by id and pans by x', () => {
    const { mixer, played } = fakeMixer();
    const director = createSoundDirector({ mixer, has: ALL, random: () => 0, panAt: (x) => (x > 200 ? 1 : -1) });
    const events: GameEvent[] = [
      { type: 'sound', id: 'wpn_bazooka_launch', x: 300, y: 0 },
      { type: 'explosion', x: 100, y: 0, radius: 97 },
    ];
    director.handleEvents(events);
    expect(played[0]).toEqual({ id: 'wpn_bazooka_launch', pan: 1 });
    expect(played[1]).toEqual({ id: 'exp_medium_1', pan: -1 });
  });

  it('skips a cue that is not in the manifest', () => {
    const { mixer, played } = fakeMixer();
    const director = createSoundDirector({ mixer, has: (id) => id !== 'wpn_bazooka_launch', random: () => 0, panAt: () => 0 });
    director.handleEvents([{ type: 'sound', id: 'wpn_bazooka_launch', x: 0, y: 0 }]);
    expect(played).toHaveLength(0);
  });
});

describe('startMusic', () => {
  it('starts the music loop once on the music bus', () => {
    const { mixer, played } = fakeMixer();
    const director = createSoundDirector({ mixer, has: ALL, random: () => 0, panAt: () => 0 });
    director.startMusic();
    director.startMusic();
    const music = played.filter((p) => p.id === 'music_theme_loop');
    expect(music).toHaveLength(1);
    expect(music[0]?.bus).toBe('music');
  });

  it('does nothing when the manifest has no music track', () => {
    const { mixer, played } = fakeMixer();
    const director = createSoundDirector({ mixer, has: (id) => id !== 'music_theme_loop', random: () => 0, panAt: () => 0 });
    director.startMusic();
    expect(played).toHaveLength(0);
  });
});

describe('observe', () => {
  it('plays a turn start voice line on entering a new turn and ducks the music', () => {
    const store = fakeMixer();
    const director = createSoundDirector({ mixer: store.mixer, has: ALL, random: () => 0, panAt: () => 0 });
    director.observe(null, baseState());
    const voice = store.played.find((p) => p.bus === 'voice');
    expect(voice?.id).toMatch(/^voice_en_comedic_turn_start_/);
    expect(store.ducks).toBeGreaterThan(0);
  });

  it('does not replay the turn start line on the same phase', () => {
    const store = fakeMixer();
    const director = createSoundDirector({ mixer: store.mixer, has: ALL, random: () => 0, panAt: () => 0 });
    const state = baseState();
    director.observe(null, state);
    const after = store.played.length;
    director.observe(state, state);
    expect(store.played.length).toBe(after);
  });
});
