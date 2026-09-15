/**
 * Every sound id a weapon def names must exist in the audio plan (tools/audio/sounds.plan.json),
 * so the registry and the sound pipeline cannot drift. The plan is read at test time on purpose:
 * the pipeline regenerates it and the registry must follow the ids that really exist.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';

interface PlanItem {
  readonly id: string;
  readonly loop: boolean;
}

function loadPlanItems(): ReadonlyMap<string, PlanItem> {
  const path = fileURLToPath(new URL('../../../tools/audio/sounds.plan.json', import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error('sounds.plan.json has no items array');
  const map = new Map<string, PlanItem>();
  for (const raw of items as readonly { id?: unknown; loop?: unknown }[]) {
    if (typeof raw.id === 'string') map.set(raw.id, { id: raw.id, loop: raw.loop === true });
  }
  return map;
}

describe('weapon sfx ids', () => {
  const plan = loadPlanItems();

  it('reads a non trivial plan', () => {
    expect(plan.size).toBeGreaterThan(50);
  });

  it('names only cues that exist in the audio plan', () => {
    const missing: string[] = [];
    for (const id of WEAPON_IDS) {
      const { fire, impact, loop, arm } = WEAPONS[id].sfx;
      for (const cue of [fire, impact, loop, arm]) {
        if (cue !== undefined && !plan.has(cue)) missing.push(`${id}: ${cue}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('uses loop cues for the loop slot', () => {
    for (const id of WEAPON_IDS) {
      const loop = WEAPONS[id].sfx.loop;
      if (loop !== undefined) expect(plan.get(loop)?.loop, `${id}: ${loop}`).toBe(true);
    }
  });

  it('gives every explosive an impact cue', () => {
    for (const id of WEAPON_IDS) {
      const def = WEAPONS[id];
      if (def.category === 'explosive') expect(def.sfx.impact, id).toBeDefined();
    }
  });
});
