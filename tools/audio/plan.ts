/**
 * The sound plan: what to generate, with what, and what it should cost. Built once from
 * docs/research/sound-pipeline.md by build-plan.ts into tools/audio/sounds.plan.json and read by
 * generate.ts. Pure types and validation; no network, no filesystem beyond the loader.
 */

import { readFileSync } from 'node:fs';
import { err, ok, type Result } from '../../src/core/result.ts';

export type Bus = 'sfx' | 'voice' | 'music' | 'ui';

export interface VoiceSettings {
  readonly stability: number;
  readonly similarity_boost: number;
  readonly style: number;
  readonly use_speaker_boost: boolean;
  readonly speed: number;
}

export interface SfxItem {
  readonly kind: 'sfx';
  readonly id: string;
  readonly group: 'weapons' | 'explosions' | 'worms' | 'world' | 'ui';
  readonly bus: 'sfx' | 'ui';
  readonly description: string;
  readonly seconds: number;
  readonly gainDb: number;
  readonly loop: boolean;
}

export interface VoiceItem {
  readonly kind: 'voice';
  readonly id: string;
  readonly group: 'voice';
  readonly bus: 'voice';
  readonly bank: string;
  readonly event: string;
  readonly text: string;
  readonly voiceId: string;
  readonly voiceName: string;
  readonly pitchFactor: number;
  readonly tempo: number;
  readonly settings: VoiceSettings;
  readonly gainDb: number;
}

export interface MusicItem {
  readonly kind: 'music';
  readonly id: string;
  readonly group: 'music';
  readonly bus: 'music';
  readonly prompt: string;
  readonly lengthMs: number;
  readonly loopStartMs: number;
  readonly loopEndMs: number;
  readonly gainDb: number;
}

export type PlanItem = SfxItem | VoiceItem | MusicItem;

export interface SoundPlan {
  readonly version: 1;
  readonly generatedAt: string;
  readonly source: string;
  readonly items: readonly PlanItem[];
}

/** ElevenLabs list prices (sound-pipeline.md sections 2 to 4): SFX 40 per second, TTS 1 per character, music 15 per second. */
export const CREDITS = Object.freeze({ sfxPerSecond: 40, ttsPerChar: 1, musicPerSecond: 15 });

export function estimateCredits(item: PlanItem): number {
  if (item.kind === 'sfx') return Math.ceil(item.seconds * CREDITS.sfxPerSecond);
  if (item.kind === 'voice') return item.text.length * CREDITS.ttsPerChar;
  return Math.ceil((item.lengthMs / 1000) * CREDITS.musicPerSecond);
}

export function totalCredits(items: readonly PlanItem[]): number {
  return items.reduce((sum, item) => sum + estimateCredits(item), 0);
}

const ID_PATTERN = /^[a-z0-9_]{3,80}$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateItem(raw: unknown, index: number): Result<PlanItem, string> {
  if (!isRecord(raw)) return err(`item ${index} is not an object`);
  const id = raw['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return err(`item ${index} has an invalid id`);
  const kind = raw['kind'];
  if (kind === 'sfx') {
    const seconds = raw['seconds'];
    if (typeof seconds !== 'number' || seconds < 0.5 || seconds > 30) return err(`${id}: seconds must be 0.5 to 30`);
    if (typeof raw['description'] !== 'string' || raw['description'].length < 8) return err(`${id}: description missing`);
    return ok(raw as unknown as SfxItem);
  }
  if (kind === 'voice') {
    if (typeof raw['text'] !== 'string' || raw['text'].length === 0 || raw['text'].length > 300) return err(`${id}: text missing or too long`);
    if (typeof raw['voiceId'] !== 'string' || raw['voiceId'].length < 10) return err(`${id}: voiceId missing`);
    return ok(raw as unknown as VoiceItem);
  }
  if (kind === 'music') {
    const length = raw['lengthMs'];
    if (typeof length !== 'number' || length < 3000 || length > 600_000) return err(`${id}: lengthMs must be 3000 to 600000`);
    if (typeof raw['prompt'] !== 'string' || raw['prompt'].length < 10) return err(`${id}: prompt missing`);
    return ok(raw as unknown as MusicItem);
  }
  return err(`item ${index} has an unknown kind`);
}

export function validatePlan(raw: unknown): Result<SoundPlan, string> {
  if (!isRecord(raw)) return err('plan is not an object');
  if (raw['version'] !== 1) return err('plan version must be 1');
  if (!Array.isArray(raw['items']) || raw['items'].length === 0) return err('plan has no items');
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw['items'].entries()) {
    const valid = validateItem(item, index);
    if (!valid.ok) return valid;
    if (seen.has(valid.value.id)) return err(`duplicate id ${valid.value.id}`);
    seen.add(valid.value.id);
    items.push(valid.value);
  }
  return ok({
    version: 1,
    generatedAt: typeof raw['generatedAt'] === 'string' ? raw['generatedAt'] : '',
    source: typeof raw['source'] === 'string' ? raw['source'] : '',
    items,
  });
}

export function loadPlan(path: string): Result<SoundPlan, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    return err(`cannot read plan ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return validatePlan(JSON.parse(text) as unknown);
  } catch {
    return err(`plan ${path} is not valid JSON`);
  }
}
