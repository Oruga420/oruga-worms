import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPlan, PLAN_PATH, powerSfxItems } from '../../../../tools/audio/build-plan.ts';
import { totalCredits, validatePlan, type SoundPlan } from '../../../../tools/audio/plan.ts';

const IDS = ['wpn_time_stop', 'wpn_force_field', 'wpn_adamantium_claws', 'wpn_room', 'wpn_immortality'];

describe('five original power sound effects', () => {
  it('defines five short original, nonvoice one shots with a 400-credit first-pass estimate', () => {
    const items = powerSfxItems();
    expect(items.map((item) => item.id)).toEqual(IDS);
    for (const item of items) {
      expect(item).toMatchObject({ kind: 'sfx', group: 'weapons', bus: 'sfx', seconds: 2, loop: false });
      expect(item.description).toContain('no voices');
    }
    expect(totalCredits(items)).toBe(400);
  });

  it('survives rebuilding the base plan without changing its last music entry', () => {
    const rebuilt = buildPlan('', 'test');
    expect(rebuilt.items.filter((item) => IDS.includes(item.id))).toEqual(powerSfxItems());
    expect(rebuilt.items.at(-1)?.kind).toBe('music');
  });

  it('matches the on-disk plan exactly and keeps every ID unique', () => {
    const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8')) as SoundPlan;
    expect(validatePlan(plan).ok).toBe(true);
    for (const item of powerSfxItems()) expect(plan.items.find((entry) => entry.id === item.id)).toEqual(item);
  });
});
