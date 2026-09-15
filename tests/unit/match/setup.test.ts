import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { buildAmmoTable, buildInitialState, validateSetup, type MatchSetup, type TeamSetup } from '@/match/setup.ts';
import { applySpawnPoints, placeWorms, spawnOptions } from '@/match/spawn.ts';

function team(name: string, colorIndex: 0 | 1 | 2 | 3, worms: readonly string[]): TeamSetup {
  return { name, colorIndex, controller: 'human', wormNames: worms };
}

function base(): MatchSetup {
  return {
    seed: 7,
    teams: [team('Reds', 0, ['R1', 'R2']), team('Blues', 1, ['B1'])],
    worldSize: { w: 1920, h: 696 },
    waterY: 640,
  };
}

describe('validateSetup', () => {
  it('accepts a normal sheet', () => {
    expect(validateSetup(base())).toBeNull();
  });

  it('rejects the wrong number of teams or worms', () => {
    expect(validateSetup({ ...base(), teams: [team('Solo', 0, ['S'])] })?.code).toBe('TEAM_COUNT');
    const nine = team('Many', 0, Array.from({ length: 9 }, (_, i) => `W${i}`));
    expect(validateSetup({ ...base(), teams: [nine, team('B', 1, ['b'])] })?.code).toBe('WORM_COUNT');
  });

  it('rejects unprintable or oversized names', () => {
    expect(validateSetup({ ...base(), teams: [team('', 0, ['a']), team('B', 1, ['b'])] })?.code).toBe('TEAM_NAME');
    expect(validateSetup({ ...base(), teams: [team('A', 0, ['x'.repeat(17)]), team('B', 1, ['b'])] })?.code).toBe('WORM_NAME');
    expect(validateSetup({ ...base(), teams: [team('A', 0, [`bad${String.fromCharCode(7)}`]), team('B', 1, ['b'])] })?.code).toBe('WORM_NAME');
  });

  it('rejects a starting team outside the sheet', () => {
    expect(validateSetup({ ...base(), startingTeamIndex: 5 })?.code).toBe('STARTING_TEAM');
  });
});

describe('buildInitialState', () => {
  it('builds the first TurnStart deterministically from the seed', () => {
    const a = buildInitialState(base());
    const b = buildInitialState(base());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.activeTeamIndex).toBe(b.value.activeTeamIndex);
      expect(a.value.wind.step).toBe(b.value.wind.step);
      expect(a.value.turn).toBe(1);
      expect(a.value.teams.map((t) => t.id)).toEqual(['team-1', 'team-2']);
      expect(a.value.teams[0]?.worms.map((w) => w.id)).toEqual(['team-1-worm-1', 'team-1-worm-2']);
    }
  });

  it('honors a pinned starting team and the ammo overrides', () => {
    const result = buildInitialState({ ...base(), startingTeamIndex: 1, teams: [team('A', 0, ['a']), { ...team('B', 1, ['b']), ammo: { banana_bomb: 2 } }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activeTeamIndex).toBe(1);
      expect(result.value.teams[1]?.worms[0]?.ammo.banana_bomb).toBe(2);
      expect(result.value.teams[0]?.worms[0]?.ammo.banana_bomb).toBe(0);
    }
  });

  it('fills the ammo table for every panel weapon', () => {
    const table = buildAmmoTable({ mortar: 1 });
    expect(table.mortar).toBe(1);
    expect(table.bazooka).toBe(-1);
    expect(table.minigun).toBe(0);
    expect(Object.keys(table)).toHaveLength(26);
  });
});

describe('spawn placement', () => {
  const flat = new Int32Array(600).fill(400);

  it('places worms on standable columns with the minimum separation', () => {
    const points = placeWorms(flat, 5, spawnOptions(640), createRng(3));
    expect(points.ok).toBe(true);
    if (points.ok) {
      const xs = points.value.map((p) => p.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i += 1) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThanOrEqual(48);
      expect(points.value.every((p) => p.y === 400)).toBe(true);
    }
  });

  it('fails when the terrain cannot hold everybody', () => {
    const tiny = new Int32Array(120).fill(400);
    const result = placeWorms(tiny, 6, spawnOptions(640), createRng(3));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['NOT_ENOUGH_ROOM', 'NO_CANDIDATES']).toContain(result.error.code);
    const flooded = placeWorms(new Int32Array(600).fill(650), 1, spawnOptions(640), createRng(3));
    expect(flooded.ok).toBe(false);
  });

  it('assigns points to worms in team order', () => {
    const state = buildInitialState(base());
    if (!state.ok) throw new Error('setup failed');
    const points = placeWorms(flat, 3, spawnOptions(640), createRng(9));
    if (!points.ok) throw new Error(points.error.message);
    const placed = applySpawnPoints(state.value, points.value);
    expect(placed.ok).toBe(true);
    if (placed.ok) {
      expect(placed.value.teams[0]?.worms[0]?.x).toBe(points.value[0]?.x);
      expect(placed.value.teams[1]?.worms[0]?.x).toBe(points.value[2]?.x);
    }
    expect(applySpawnPoints(state.value, points.value.slice(0, 2)).ok).toBe(false);
  });
});
