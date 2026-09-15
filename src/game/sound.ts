/**
 * Sound director (Phase 2 audio wiring): maps the controller's game events and the match phase
 * transitions onto mixer play calls. The sim already names its own cues (wpn_bazooka_launch,
 * wpn_grenade_bounce_1, ...), so those play by id; explosions pick a boom by radius; each new
 * turn plays a voice line from the active team's bank, and damage, victory and defeat play the
 * matching bank line, ducking the music while a voice speaks. Pure over a small mixer interface
 * plus an rng, so the mapping is unit tested with a fake.
 */

import type { MatchState } from '../match/state.ts';
import { activeTeamOf, activeWormOf } from '../match/ledger.ts';
import type { GameEvent } from './controller.ts';

export type VoiceBank = 'en_comedic' | 'es_mx' | 'drill';

/** Team color index to a voice bank, so the two default teams sound different. */
export function bankForTeam(colorIndex: number): VoiceBank {
  return (['en_comedic', 'drill', 'es_mx', 'en_comedic'] as const)[colorIndex % 4] ?? 'en_comedic';
}

/** Boom cue by blast radius (the big weapons carry a bigger crater). */
export function boomFor(radiusPx: number): string {
  if (radiusPx >= 120) return 'exp_large';
  if (radiusPx >= 70) return 'exp_medium_1';
  return 'exp_small_1';
}

export interface PlayLike {
  play(id: string, options?: { readonly pan?: number; readonly bus?: string; readonly loop?: boolean }): unknown;
  duck(bus: string, db: number, ms: number): unknown;
}

export interface SoundDirectorDeps {
  readonly mixer: PlayLike;
  /** Ids present in the loaded manifest; a cue not here is skipped silently. */
  readonly has: (id: string) => boolean;
  readonly random: () => number;
  /** World x to a stereo pan in [-1, 1], from the camera. */
  readonly panAt: (x: number) => number;
}

export interface SoundDirector {
  /** Play the concrete cues the sim emitted this tick. */
  handleEvents(events: readonly GameEvent[]): void;
  /** React to a phase or turn change since the last state. */
  observe(previous: MatchState | null, next: MatchState): void;
  /** Start the looping music bed once (needs the AudioContext already unlocked). */
  startMusic(): void;
}

/** The one music track the audio pipeline ships; it loops on its own manifest loop points. */
export const MUSIC_LOOP_ID = 'music_theme_loop';

const VOICE_DUCK_DB = 6;
const VOICE_DUCK_MS = 900;

/** Picks a numbered variant of voice_<bank>_<event>_N that exists, or null. */
export function pickVoiceLine(has: (id: string) => boolean, bank: VoiceBank, event: string, random: () => number): string | null {
  const candidates: string[] = [];
  for (let n = 1; n <= 3; n += 1) {
    const id = `voice_${bank}_${event}_${n}`;
    if (has(id)) candidates.push(id);
  }
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return candidates[index] ?? null;
}

export function createSoundDirector(deps: SoundDirectorDeps): SoundDirector {
  let musicStarted = false;
  const playVoice = (bank: VoiceBank, event: string): void => {
    const id = pickVoiceLine(deps.has, bank, event, deps.random);
    if (id === null) return;
    deps.mixer.duck('music', VOICE_DUCK_DB, VOICE_DUCK_MS);
    deps.mixer.play(id, { bus: 'voice' });
  };

  return {
    startMusic() {
      if (musicStarted || !deps.has(MUSIC_LOOP_ID)) return;
      musicStarted = true;
      deps.mixer.play(MUSIC_LOOP_ID, { bus: 'music', loop: true });
    },
    handleEvents(events) {
      for (const event of events) {
        if (event.type === 'sound') {
          if (event.id !== undefined && deps.has(event.id)) deps.mixer.play(event.id, { pan: deps.panAt(event.x) });
        } else if (event.type === 'explosion') {
          const id = boomFor(event.radius ?? 40);
          if (deps.has(id)) deps.mixer.play(id, { pan: deps.panAt(event.x) });
        }
      }
    },
    observe(previous, next) {
      const prevPhase = previous?.phase ?? null;
      if (next.phase === 'TurnStart' && prevPhase !== 'TurnStart') {
        const team = activeTeamOf(next);
        if (team !== undefined) playVoice(bankForTeam(team.colorIndex), 'turn_start');
      }
      if (next.phase === 'MatchEnd' && prevPhase !== 'MatchEnd') {
        const alive = next.teams.filter((t) => t.worms.some((w) => w.alive));
        const winner = alive[0];
        for (const team of next.teams) playVoice(bankForTeam(team.colorIndex), winner !== undefined && team.id === winner.id ? 'victory' : 'defeat');
      }
      // A worm of the active team taking a hit this transition: play a hurt line.
      if (previous !== null && next.phase === 'Resolving') {
        const active = activeWormOf(next);
        if (active !== undefined) {
          const before = findHp(previous, active.id);
          const after = findHp(next, active.id);
          if (after < before) {
            const team = activeTeamOf(next);
            if (team !== undefined) playVoice(bankForTeam(team.colorIndex), 'hurt');
          }
        }
      }
    },
  };
}

function findHp(state: MatchState, wormId: string): number {
  for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
  return 0;
}
