/**
 * Builds tools/audio/sounds.plan.json from docs/research/sound-pipeline.md (sections 3 to 6):
 * the 56 SFX rows with their duration, gain and description (variants expanded), the 60 voice
 * lines in three banks with their voice ids and pitch treatment, and the one music loop.
 * The report is the creative source; this file only parses it, so a change to a description is
 * made in the report and the plan is rebuilt with `node tools/audio/build-plan.ts`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MusicItem, PlanItem, SfxItem, SoundPlan, VoiceItem, VoiceSettings } from './plan.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const REPORT_PATH = resolve(ROOT, 'docs', 'research', 'sound-pipeline.md');
export const PLAN_PATH = resolve(ROOT, 'tools', 'audio', 'sounds.plan.json');

// Gain may carry an explicit plus sign in the report (+2, +3): the first parse missed 4 rows because of it.
const SFX_ROW = /^\| ([a-z0-9_]+) \| ([\d.]+) \| ([+-]?\d+) \| (.+) \|$/;
const GROUP_HEADER = /^### (Weapons|Explosions|Worms|World|UI) \(\d+\)/;
const BANK_HEADER = /^### Bank (\d): (.+?) \((.+?), pitch ([\d.]+)\)/;
const VOICE_ROW = /^\| ([a-z_]+) \| (.+) \|$/;
const VOICE_CANDIDATE = /^\| \d+ \| (.+?) \| ([A-Za-z0-9]{20}) \|/;
const VARIANTS = /\((\d) variants[^)]*\)/;

const COMEDIC_SETTINGS: VoiceSettings = Object.freeze({ stability: 0.35, similarity_boost: 0.75, style: 0.45, use_speaker_boost: true, speed: 1.05 });
const SERGEANT_SETTINGS: VoiceSettings = Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true, speed: 1.0 });
const BANK_SLUGS: Readonly<Record<string, string>> = Object.freeze({ '1': 'en_comedic', '2': 'es_mx', '3': 'drill' });

export const MUSIC_ITEM: MusicItem = Object.freeze({
  kind: 'music',
  id: 'music_theme_loop',
  group: 'music',
  bus: 'music',
  prompt:
    'upbeat quirky military march for a cartoon artillery game, toy brass, marching snare, tuba bassline, glockenspiel accents, 120 BPM, steady energy, loopable, no intro, no outro, no vocals',
  lengthMs: 66_000,
  loopStartMs: 0,
  loopEndMs: 64_000,
  gainDb: -6,
});

function groupOf(header: string): SfxItem['group'] {
  return header.toLowerCase() as SfxItem['group'];
}

/** Parses the SFX tables of section 5, expanding "(N variants)" into numbered ids. */
export function parseSfxTable(markdown: string): SfxItem[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## 5. '));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## 6. '));
  const items: SfxItem[] = [];
  let group: SfxItem['group'] = 'weapons';
  for (const line of lines.slice(start, end === -1 ? undefined : end)) {
    const header = GROUP_HEADER.exec(line);
    if (header?.[1] !== undefined) {
      group = groupOf(header[1]);
      continue;
    }
    const row = SFX_ROW.exec(line);
    if (row === null || row[1] === undefined || row[2] === undefined || row[3] === undefined || row[4] === undefined) continue;
    const baseId = row[1];
    const seconds = Number.parseFloat(row[2]);
    const gainDb = Number.parseInt(row[3], 10);
    const rawDescription = row[4].trim();
    const variants = VARIANTS.exec(rawDescription);
    const count = variants?.[1] === undefined ? 1 : Number.parseInt(variants[1], 10);
    const description = rawDescription.replace(VARIANTS, '').replace(/\s+/g, ' ').trim();
    const loop = baseId.endsWith('_loop') || /seamless loop/i.test(description);
    for (let n = 1; n <= count; n += 1) {
      items.push({
        kind: 'sfx',
        id: count === 1 ? baseId : `${baseId}_${n}`,
        group,
        bus: group === 'ui' ? 'ui' : 'sfx',
        description: count === 1 ? description : `${description} (take ${n} of ${count}, a distinct variation)`,
        seconds,
        gainDb,
        loop,
      });
    }
  }
  return items;
}

/** Voice name to id from the candidates table of section 3. */
export function parseVoiceIds(markdown: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const line of markdown.split(/\r?\n/)) {
    const m = VOICE_CANDIDATE.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1].trim()] = m[2];
  }
  return out;
}

/** Parses the three banks of section 6 into voice items with per bank settings and pitch treatment. */
export function parseVoiceBanks(markdown: string): VoiceItem[] {
  const voiceIds = parseVoiceIds(markdown);
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## 6. '));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## 7. '));
  const items: VoiceItem[] = [];
  let bank: { slug: string; voiceId: string; voiceName: string; pitch: number; tempo: number; settings: VoiceSettings } | null = null;
  const counters = new Map<string, number>();
  for (const line of lines.slice(start, end === -1 ? undefined : end)) {
    const header = BANK_HEADER.exec(line);
    if (header?.[1] !== undefined && header[3] !== undefined && header[4] !== undefined) {
      const voiceName = header[3].trim();
      const slug = BANK_SLUGS[header[1]] ?? `bank_${header[1]}`;
      const pitch = Number.parseFloat(header[4]);
      const sergeant = slug === 'drill';
      bank = {
        slug,
        voiceId: voiceIds[voiceName] ?? '',
        voiceName,
        pitch,
        tempo: sergeant ? 0.95 : 0.92,
        settings: sergeant ? SERGEANT_SETTINGS : COMEDIC_SETTINGS,
      };
      continue;
    }
    if (bank === null) continue;
    const row = VOICE_ROW.exec(line);
    if (row === null || row[1] === undefined || row[2] === undefined || row[1] === 'event') continue;
    const event = row[1];
    const key = `${bank.slug}:${event}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    items.push({
      kind: 'voice',
      id: `voice_${bank.slug}_${event}_${n}`,
      group: 'voice',
      bus: 'voice',
      bank: bank.slug,
      event,
      text: row[2].trim(),
      voiceId: bank.voiceId,
      voiceName: bank.voiceName,
      pitchFactor: bank.pitch,
      tempo: bank.tempo,
      settings: bank.settings,
      gainDb: 0,
    });
  }
  return items;
}

export function buildPlan(markdown: string, generatedAt: string): SoundPlan {
  const items: PlanItem[] = [...parseSfxTable(markdown), ...parseVoiceBanks(markdown), MUSIC_ITEM];
  return { version: 1, generatedAt, source: 'docs/research/sound-pipeline.md sections 3 to 6', items };
}

function main(): void {
  const markdown = readFileSync(REPORT_PATH, 'utf8');
  const plan = buildPlan(markdown, new Date().toISOString());
  const sfx = plan.items.filter((i) => i.kind === 'sfx').length;
  const voice = plan.items.filter((i) => i.kind === 'voice').length;
  const missingVoice = plan.items.filter((i) => i.kind === 'voice' && i.voiceId === '').length;
  writeFileSync(PLAN_PATH, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`plan written: ${PLAN_PATH} (${sfx} sfx, ${voice} voice lines, ${missingVoice} without a voice id, 1 music)`);
  if (missingVoice > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main();
}
