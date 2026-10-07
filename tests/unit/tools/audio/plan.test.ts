import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildPlan, parseSfxTable, parseVoiceBanks, parseVoiceIds, PLAN_PATH, superVoiceItems } from '../../../../tools/audio/build-plan.ts';
import { estimateCredits, totalCredits, validatePlan } from '../../../../tools/audio/plan.ts';

const REPORT = `
## 3. Text to Speech

| # | voice | id | why |
|---|---|---|---|
| 1 | Timmy - Anxious Nerd | mrQhZWGbb2k9qWJb5qeA | young. Primary. |
| 1 | Harry - Fierce Warrior | SOYHLrjzK2X1ezoPC6cr | rough. Primary. |
| 1 | Ricardo voice | CoAqFXxZEa3kpJmE7rDr | warm. Primary. |

## 5. SFX list (task E)

### Weapons (2)

| id | s | gain | description |
|---|---|---|---|
| wpn_bazooka_launch | 0.8 | 0 | rocket launcher firing: pop, one-shot, dry |
| wpn_grenade_bounce | 0.5 | -3 | canister bouncing: clank, one-shot (2 variants) |
| wpn_rocket_loop | 2.0 | -6 | rocket in flight: hiss, seamless loop |
| exp_large | 2.5 | +3 | large explosion: rumble, long decay, cinematic |

### UI (1)

| id | s | gain | description |
|---|---|---|---|
| ui_select_click | 0.5 | 0 | interface click: crisp, dry, one-shot |

## 6. Voice lines (task F)

### Bank 1: English comedic (Timmy - Anxious Nerd, pitch 1.30)

| event | line |
|---|---|
| turn_start | Ooh, my go! |
| turn_start | Nobody panic. |
| hurt | Ow! |

### Bank 3: Drill sergeant (Harry - Fierce Warrior, pitch 1.15)

| event | line |
|---|---|
| taunt | Direct hit! |

## 7. Post-processing
`;

describe('parseSfxTable', () => {
  it('expands variants, detects loops and routes UI to the ui bus', () => {
    const items = parseSfxTable(REPORT);
    expect(items.map((i) => i.id)).toEqual(['wpn_bazooka_launch', 'wpn_grenade_bounce_1', 'wpn_grenade_bounce_2', 'wpn_rocket_loop', 'exp_large', 'ui_select_click']);
    expect(items[0]).toMatchObject({ group: 'weapons', bus: 'sfx', seconds: 0.8, gainDb: 0, loop: false });
    expect(items[1]?.description).toContain('take 1 of 2');
    expect(items[1]?.description).not.toContain('variants');
    expect(items[3]?.loop).toBe(true);
    expect(items[4]).toMatchObject({ id: 'exp_large', gainDb: 3, group: 'weapons' });
    expect(items[5]).toMatchObject({ group: 'ui', bus: 'ui' });
  });
});

describe('parseVoiceBanks', () => {
  it('maps banks to voice ids, settings and pitch, numbering repeated events', () => {
    expect(parseVoiceIds(REPORT)['Timmy - Anxious Nerd']).toBe('mrQhZWGbb2k9qWJb5qeA');
    const items = parseVoiceBanks(REPORT);
    expect(items.map((i) => i.id)).toEqual(['voice_en_comedic_turn_start_1', 'voice_en_comedic_turn_start_2', 'voice_en_comedic_hurt_1', 'voice_drill_taunt_1']);
    expect(items[0]).toMatchObject({ voiceId: 'mrQhZWGbb2k9qWJb5qeA', pitchFactor: 1.3, tempo: 0.92, text: 'Ooh, my go!' });
    expect(items[0]?.settings.style).toBe(0.45);
    expect(items[3]).toMatchObject({ voiceId: 'SOYHLrjzK2X1ezoPC6cr', pitchFactor: 1.15, tempo: 0.95 });
    expect(items[3]?.settings.stability).toBe(0.5);
  });
});

describe('superVoiceItems', () => {
  const CANDIDATES = '| 1 | Timmy - Anxious Nerd | mrQhZWGbb2k9qWJb5qeA |\n| 2 | Ricardo voice | CoAqFXxZEa3kpJmE7rDr |\n| 3 | Harry - Fierce Warrior | SOYHLrjzK2X1ezoPC6cr |';

  it('voices the Kamehameha and the scream for a friend lost in the fierce warrior voice, as its own bank', () => {
    const items = superVoiceItems(CANDIDATES);
    expect(items.map((i) => i.id).slice(0, 5)).toEqual(['voice_super_kamehameha_chant', 'voice_super_kamehameha_ha', 'voice_super_freezer_krilin', 'voice_super_freezer_laugh', 'voice_super_saibaman_kekeke']);
    for (const item of items) {
      expect(item.bank).toBe('super');
      expect(item.bus).toBe('voice');
    }
    for (const item of items.slice(0, 3)) expect(item.voiceId).toBe('SOYHLrjzK2X1ezoPC6cr');
    expect(items[0]?.text).toMatch(/^Kaa+\.\.\. mee+\.\.\. haa+\.\.\. mee+\.\.\.$/);
    expect(items[1]?.text).toMatch(/^HAA+!+$/);
    expect(items[2]?.text).toMatch(/^KRILII+N!+$/);
  });

  it('gives the emperor his own sneering laugh, in the nerd voice pitched up', () => {
    const laugh = superVoiceItems(CANDIDATES)[3];
    expect(laugh?.voiceId).toBe('mrQhZWGbb2k9qWJb5qeA');
    expect(laugh?.pitchFactor).toBeGreaterThan(1.1);
    expect(laugh?.text).toMatch(/^O(ho)+\.\.\. o(ho)+!$/);
  });

  it('cackles for the Saibaman in the same nerd, pitched up higher still', () => {
    const cackle = superVoiceItems(CANDIDATES)[4];
    expect(cackle?.voiceId).toBe('mrQhZWGbb2k9qWJb5qeA');
    expect(cackle?.pitchFactor).toBeGreaterThan(superVoiceItems(CANDIDATES)[3]?.pitchFactor ?? 0);
    expect(cackle?.text).toMatch(/^Ke(ke)+! Ke(ke)+!$/);
  });

  it('shouts the anime techniques in the Mexican voice, as the Latin American dubs do, and Frieren names her spell quietly', () => {
    const items = superVoiceItems(CANDIDATES).slice(5);
    expect(items.map((i) => i.id)).toEqual([
      'voice_super_scarlet_needle',
      'voice_super_antares',
      'voice_super_galaxian',
      'voice_super_tenbu_horin',
      'voice_super_hiken',
      'voice_super_meteor',
      'voice_super_santoryu',
      'voice_super_zoltraak',
      'voice_super_final_explosion',
    ]);
    for (const item of items.slice(0, 7)) expect(item.voiceId).toBe('CoAqFXxZEa3kpJmE7rDr');
    expect(items[0]?.text).toBe('¡Aguja Escarlata!');
    expect(items[1]?.text).toMatch(/^¡ANTARE+S!$/);
    expect(items[2]?.text).toBe('¡Explosión de Galaxias!');
    expect(items[3]?.text).toMatch(/^Tesoro del Cielo/);
    // The calm ones are steadier and drier than the shouts.
    expect(items[3]?.settings.stability).toBeGreaterThan(items[0]?.settings.stability ?? 1);
    expect(items[3]?.settings.style).toBeLessThan(items[0]?.settings.style ?? 0);
    expect(items[7]).toMatchObject({ voiceId: 'mrQhZWGbb2k9qWJb5qeA', text: 'Zoltraak.' });
    expect(items[7]?.settings).toEqual(items[3]?.settings);
    expect(items[8]).toMatchObject({ voiceId: 'CoAqFXxZEa3kpJmE7rDr', text: 'Adiós... Trunks.' });
    expect(items[8]?.settings).toEqual(items[3]?.settings);
  });

  it('is in the plan, before the music', () => {
    const plan = buildPlan(`${REPORT}\n| 3 | Harry - Fierce Warrior | SOYHLrjzK2X1ezoPC6cr |\n`, 'now');
    const ids = plan.items.map((i) => i.id);
    expect(ids.indexOf('voice_super_final_explosion')).toBe(ids.length - 2);
    expect(ids.indexOf('voice_super_zoltraak')).toBe(ids.length - 3);
    expect(ids.indexOf('voice_super_scarlet_needle')).toBe(ids.length - 10);
    expect(ids.indexOf('voice_super_saibaman_kekeke')).toBe(ids.length - 11);
    expect(ids.indexOf('voice_super_freezer_laugh')).toBe(ids.length - 12);
    expect(ids.indexOf('voice_super_kamehameha_ha')).toBe(ids.length - 14);
    expect(validatePlan(plan).ok).toBe(true);
  });

  it('matches the committed plan, line for line', () => {
    const committed = JSON.parse(readFileSync(PLAN_PATH, 'utf8')) as { items: { id: string }[] };
    for (const item of superVoiceItems(CANDIDATES)) expect(committed.items.find((i) => i.id === item.id)).toEqual(item);
  });
});

describe('buildPlan and validatePlan', () => {
  it('builds a valid plan with the music item and prices it', () => {
    const plan = buildPlan(REPORT, '2026-09-03T00:00:00Z');
    const valid = validatePlan(plan);
    expect(valid.ok).toBe(true);
    expect(plan.items.at(-1)?.kind).toBe('music');
    const bazooka = plan.items[0];
    expect(bazooka !== undefined && estimateCredits(bazooka)).toBe(32);
    expect(totalCredits(plan.items)).toBeGreaterThan(1000);
  });

  it('rejects duplicates and bad values', () => {
    const plan = buildPlan(REPORT, 'now');
    const dup = { ...plan, items: [...plan.items, plan.items[0]] };
    expect(validatePlan(dup).ok).toBe(false);
    const bad = { ...plan, items: [{ ...plan.items[0], seconds: 0.1 }] };
    expect(validatePlan(bad).ok).toBe(false);
    expect(validatePlan({ version: 2, items: [] }).ok).toBe(false);
  });
});
