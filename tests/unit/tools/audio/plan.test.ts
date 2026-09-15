import { describe, expect, it } from 'vitest';
import { buildPlan, parseSfxTable, parseVoiceBanks, parseVoiceIds } from '../../../../tools/audio/build-plan.ts';
import { estimateCredits, totalCredits, validatePlan } from '../../../../tools/audio/plan.ts';

const REPORT = `
## 3. Text to Speech

| # | voice | id | why |
|---|---|---|---|
| 1 | Timmy - Anxious Nerd | mrQhZWGbb2k9qWJb5qeA | young. Primary. |
| 1 | Harry - Fierce Warrior | SOYHLrjzK2X1ezoPC6cr | rough. Primary. |

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
