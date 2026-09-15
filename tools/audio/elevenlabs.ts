/**
 * Thin ElevenLabs client for the sound loop (sound-pipeline.md sections 2 to 4). Three
 * generation endpoints and the subscription read used as the budget gate. The key is passed in
 * and only ever placed in the xi-api-key header. Every failure is a Result with the HTTP status
 * and the API's error text (safe to log, it never echoes the key). One retry on 429 or 5xx.
 */

import { err, ok, type Result } from '../../src/core/result.ts';
import type { VoiceSettings } from './plan.ts';

export const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';
export const OUTPUT_FORMAT = 'mp3_44100_192';
export const SFX_MODEL = 'eleven_text_to_sound_v2';
export const TTS_MODEL = 'eleven_multilingual_v2';
export const MUSIC_MODEL = 'music_v2';

export interface Subscription {
  readonly tier: string;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
}

export interface ElevenClient {
  sfx(text: string, seconds: number, promptInfluence: number, loop: boolean): Promise<Result<Buffer, string>>;
  tts(voiceId: string, text: string, settings: VoiceSettings, seed?: number): Promise<Result<Buffer, string>>;
  music(prompt: string, lengthMs: number): Promise<Result<Buffer, string>>;
  subscription(): Promise<Result<Subscription, string>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function sfxBody(text: string, seconds: number, promptInfluence: number, loop: boolean): Record<string, unknown> {
  return {
    text,
    duration_seconds: Math.min(30, Math.max(0.5, seconds)),
    prompt_influence: Math.min(1, Math.max(0, promptInfluence)),
    model_id: SFX_MODEL,
    ...(loop ? { loop: true } : {}),
  };
}

export function ttsBody(text: string, settings: VoiceSettings, seed?: number): Record<string, unknown> {
  return {
    text,
    model_id: TTS_MODEL,
    voice_settings: { ...settings },
    ...(seed === undefined ? {} : { seed }),
  };
}

export function musicBody(prompt: string, lengthMs: number): Record<string, unknown> {
  return { prompt, music_length_ms: Math.min(600_000, Math.max(3000, Math.round(lengthMs))), model_id: MUSIC_MODEL, force_instrumental: true };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  return `http ${response.status}: ${text.slice(0, 300).replace(/\s+/g, ' ')}`;
}

export function createElevenClient(apiKey: string, fetchImpl: FetchLike = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): ElevenClient {
  const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

  async function postAudio(path: string, body: Record<string, unknown>): Promise<Result<Buffer, string>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(`${ELEVEN_BASE}${path}?output_format=${OUTPUT_FORMAT}`, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (error: unknown) {
        return err(`network: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (response.ok) return ok(Buffer.from(await response.arrayBuffer()));
      const retryable = response.status === 429 || response.status >= 500;
      const message = await readError(response);
      if (!retryable || attempt === 1) return err(message);
      const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '3', 10);
      await sleep(Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 3) * 1000);
    }
    return err('unreachable');
  }

  return {
    sfx: (text, seconds, promptInfluence, loop) => postAudio('/sound-generation', sfxBody(text, seconds, promptInfluence, loop)),
    tts: (voiceId, text, settings, seed) => postAudio(`/text-to-speech/${encodeURIComponent(voiceId)}`, ttsBody(text, settings, seed)),
    music: (prompt, lengthMs) => postAudio('/music', musicBody(prompt, lengthMs)),
    async subscription() {
      let response: Response;
      try {
        response = await fetchImpl(`${ELEVEN_BASE}/user/subscription`, { headers: { 'xi-api-key': apiKey } });
      } catch (error: unknown) {
        return err(`network: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) return err(await readError(response));
      const json = (await response.json()) as { tier?: string; character_count?: number; character_limit?: number };
      const used = json.character_count ?? 0;
      const limit = json.character_limit ?? 0;
      return ok({ tier: json.tier ?? 'unknown', used, limit, remaining: Math.max(0, limit - used) });
    },
  };
}
