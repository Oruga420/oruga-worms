import { describe, expect, it } from 'vitest';
import { CHILD_WEAPON_IDS, PANEL_SLOT_COUNT, PANEL_WEAPON_IDS, WATER_BEHAVIORS } from '@/weapons/types.ts';

const UTILITY_IDS = ['parachute', 'jetpack', 'teleport', 'girder', 'skip_go'] as const;

describe('weapon ids', () => {
  it('has 26 panel slots: 21 combat weapons plus 5 utilities', () => {
    expect(PANEL_SLOT_COUNT).toBe(26);
    expect(PANEL_WEAPON_IDS).toHaveLength(26);
    const utilities = PANEL_WEAPON_IDS.filter((id) => (UTILITY_IDS as readonly string[]).includes(id));
    expect(utilities).toHaveLength(5);
    expect(PANEL_WEAPON_IDS.length - utilities.length).toBe(21);
  });

  it('keeps every id unique and never lets a child id into the panel', () => {
    const panel = new Set<string>(PANEL_WEAPON_IDS);
    expect(panel.size).toBe(PANEL_WEAPON_IDS.length);
    const children = new Set<string>(CHILD_WEAPON_IDS);
    expect(children.size).toBe(CHILD_WEAPON_IDS.length);
    for (const child of children) expect(panel.has(child)).toBe(false);
  });

  it('uses ids that are valid asset ids (lowercase, digits, underscores)', () => {
    for (const id of [...PANEL_WEAPON_IDS, ...CHILD_WEAPON_IDS]) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('defines the three water behaviours', () => {
    expect(WATER_BEHAVIORS).toEqual(['splash', 'skim', 'pass']);
  });
});
