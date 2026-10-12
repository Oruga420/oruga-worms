import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { createMatchDeps, type MatchConfig, type MatchDeps } from '@/match/deps.ts';
import { findWorm } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { applyRoomExchange, circleMapArea, coveragePctFromAngle, cyclicExchange, roomCost, roomPreview, roomRadiusPx } from '@/match/room.ts';
import { buildInitialState, type MatchSetup, type TeamSetup } from '@/match/setup.ts';
import type { MatchState, TeamController } from '@/match/state.ts';

const CONFIG: MatchConfig = GAME_CONFIG;
const WORLD = { w: 1920, h: 696 };

function team(name: string, colorIndex: 0 | 1, worms: readonly string[]): TeamSetup {
  return { name, colorIndex, controller: 'cpu' as TeamController, wormNames: worms };
}

function setup(): MatchSetup {
  return { seed: 1, teams: [team('Reds', 0, ['R1', 'R2']), team('Blues', 1, ['B1'])], worldSize: WORLD, waterY: 640, startingTeamIndex: 0 };
}

function start(): { state: MatchState; deps: MatchDeps } {
  const deps = createMatchDeps(1, CONFIG);
  const result = buildInitialState(setup(), CONFIG);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.value, deps };
}

/** Places every named worm at an (x, y) and hp, leaving everything else as setup built it. */
function place(state: MatchState, placements: Readonly<Record<string, { readonly x: number; readonly y: number; readonly hp: number }>>): MatchState {
  return {
    ...state,
    teams: state.teams.map((t) => ({
      ...t,
      worms: t.worms.map((w) => {
        const at = placements[w.id];
        return at === undefined ? w : { ...w, x: at.x, y: at.y, hp: at.hp };
      }),
    })),
  };
}

describe('coveragePctFromAngle', () => {
  it('maps the aim elevation range onto 1..99 percent, clamped', () => {
    expect(coveragePctFromAngle(-90)).toBe(1);
    expect(coveragePctFromAngle(90)).toBe(99);
    expect(coveragePctFromAngle(0)).toBeGreaterThanOrEqual(49);
    expect(coveragePctFromAngle(0)).toBeLessThanOrEqual(51);
    // Out of the normal aim range, or not even a number: still inside 1..99.
    expect(coveragePctFromAngle(500)).toBe(99);
    expect(coveragePctFromAngle(-500)).toBe(1);
    expect(coveragePctFromAngle(Number.NaN)).toBe(1);
  });
});

describe('roomRadiusPx', () => {
  // Independent vertical-strip integration, not the analytic implementation being checked.
  function measuredCoverage(radius: number, center: { x: number; y: number }): number {
    const strips = 4096;
    const dx = WORLD.w / strips;
    let area = 0;
    for (let i = 0; i < strips; i += 1) {
      const distance = (i + 0.5) * dx - center.x;
      if (Math.abs(distance) >= radius) continue;
      const half = Math.sqrt(radius * radius - distance * distance);
      area += Math.max(0, Math.min(WORLD.h, center.y + half) - Math.max(0, center.y - half)) * dx;
    }
    return area / (WORLD.w * WORLD.h);
  }

  it.each([{ x: 960, y: 348 }, { x: 0, y: 0 }, { x: 1900, y: 680 }, { x: 100, y: 348 }])('covers99percent of the actual map from $x,$y', (center) => {
    const radius = roomRadiusPx(99, WORLD, center);
    expect(measuredCoverage(radius, center)).toBeCloseTo(0.99, 4);
    expect(roomPreview(90, WORLD, center).radiusPx).toBe(radius);
  });

  it('computes exact quarter-circle and full-circle areas without counting off-map space', () => {
    expect(circleMapArea(100, WORLD, { x: 0, y: 0 })).toBeCloseTo(Math.PI * 10000 / 4, 6);
    expect(circleMapArea(100, WORLD, { x: 960, y: 348 })).toBeCloseTo(Math.PI * 10000, 6);
  });

  it('returns safe empty geometry for invalid inputs', () => {
    expect(roomRadiusPx(Number.NaN, WORLD)).toBe(0);
    expect(roomRadiusPx(50, { w: -1, h: 696 })).toBe(0);
    expect(circleMapArea(Infinity, WORLD, { x: 0, y: 0 })).toBe(0);
  });

  it('uses exact circle area when the whole region fits inside the map', () => {
    const r = roomRadiusPx(25, WORLD);
    const area = Math.PI * r * r;
    expect(area).toBeCloseTo(0.25 * WORLD.w * WORLD.h, 0);
  });

  it('clamps coverage to 1..99 before computing', () => {
    expect(roomRadiusPx(200, WORLD)).toBeCloseTo(roomRadiusPx(99, WORLD));
    expect(roomRadiusPx(-5, WORLD)).toBeCloseTo(roomRadiusPx(1, WORLD));
  });
});

describe('cyclicExchange', () => {
  it('gives each participant the hp of the one before it, sorted by id, wrapping round', () => {
    const out = cyclicExchange([
      { id: 'a', hp: 10 },
      { id: 'b', hp: 20 },
      { id: 'c', hp: 30 },
    ]);
    // a <- c (wraps), b <- a, c <- b.
    expect(out.get('a')).toBe(30);
    expect(out.get('b')).toBe(10);
    expect(out.get('c')).toBe(20);
  });

  it('leaves a lone participant with its own hp (wraps to itself)', () => {
    const out = cyclicExchange([{ id: 'solo', hp: 42 }]);
    expect(out.get('solo')).toBe(42);
  });
});

describe('roomCost', () => {
  it('is a share of what the caster had before the cast, never enough to take it under 1 hp', () => {
    expect(roomCost(100, 25, 100)).toBe(25);
    // The swap already left it at 10: 25% of 100 (25) would go to -15, capped at 9 (down to 1 hp).
    expect(roomCost(100, 25, 10)).toBe(9);
    // Already at 1 hp after the swap: nothing more to take.
    expect(roomCost(100, 50, 1)).toBe(0);
  });
});

describe('applyRoomExchange', () => {
  it('cycles hp among every living worm inside the region, including the caster, then charges the caster', () => {
    const { state } = start();
    const placed = place(state, {
      'team-1-worm-1': { x: 0, y: 0, hp: 80 },
      'team-1-worm-2': { x: 10, y: 0, hp: 40 },
      'team-2-worm-1': { x: 20, y: 0, hp: 20 },
    });
    const next = applyRoomExchange(placed, 'team-1-worm-1', 99);
    // Sorted by id: team-1-worm-1 < team-1-worm-2 < team-2-worm-1, each gets the one before it, wrapping.
    expect(findWorm(next, 'team-1-worm-1')?.worm.hp).toBe(20 - roomCost(80, 99, 20));
    expect(findWorm(next, 'team-1-worm-2')?.worm.hp).toBe(80);
    expect(findWorm(next, 'team-2-worm-1')?.worm.hp).toBe(40);
  });

  it('leaves a worm standing well outside the region untouched', () => {
    const { state } = start();
    const placed = place(state, {
      'team-1-worm-1': { x: 0, y: 0, hp: 50 },
      'team-1-worm-2': { x: 100000, y: 0, hp: 50 },
      'team-2-worm-1': { x: 0, y: 0, hp: 70 },
    });
    // 1 percent of a 1920x696 world is a small circle: worm 2, far away, is never in it; the caster
    // and worm 3, both at the centre, still cycle their hp between the two of them.
    const next = applyRoomExchange(placed, 'team-1-worm-1', 1);
    expect(findWorm(next, 'team-1-worm-2')?.worm.hp).toBe(50);
    expect(findWorm(next, 'team-2-worm-1')?.worm.hp).toBe(50);
  });

  it('pays nothing and changes nothing when the caster is alone in its own region', () => {
    const { state } = start();
    // Every other worm starts unplaced at (0, 0) too (match/setup.ts); move them well clear so the
    // caster really is alone in its own region, not coincidentally stacked on top of it.
    const placed = place(state, {
      'team-1-worm-1': { x: 0, y: 0, hp: 60 },
      'team-1-worm-2': { x: 100000, y: 0, hp: 100 },
      'team-2-worm-1': { x: 100000, y: 0, hp: 100 },
    });
    const next = applyRoomExchange(placed, 'team-1-worm-1', 10);
    expect(findWorm(next, 'team-1-worm-1')?.worm.hp).toBe(60);
  });

  it('rejects a nonfinite or out of range coverage, changing nothing', () => {
    const { state } = start();
    expect(applyRoomExchange(state, 'team-1-worm-1', Number.NaN)).toBe(state);
    expect(applyRoomExchange(state, 'team-1-worm-1', 0)).toBe(state);
    expect(applyRoomExchange(state, 'team-1-worm-1', 100)).toBe(state);
  });

  it('never swaps a dead (not alive) worm into the cycle', () => {
    const { state } = start();
    const placed = place(state, {
      'team-1-worm-1': { x: 0, y: 0, hp: 50 },
      'team-1-worm-2': { x: 5, y: 0, hp: 30 },
    });
    const oneDead: MatchState = { ...placed, teams: placed.teams.map((t) => ({ ...t, worms: t.worms.map((w) => (w.id === 'team-1-worm-2' ? { ...w, alive: false } : w)) })) };
    const next = applyRoomExchange(oneDead, 'team-1-worm-1', 99);
    // Only the caster remains living in range: nobody to cycle with, nothing changes.
    expect(findWorm(next, 'team-1-worm-1')?.worm.hp).toBe(50);
  });
});

describe('RoomCast through the reducer', () => {
  it('converts the raw aim angle to a coverage percent and resolves the exchange', () => {
    const { state, deps } = start();
    const placed = place(state, {
      'team-1-worm-1': { x: 0, y: 0, hp: 90 },
      'team-1-worm-2': { x: 10, y: 0, hp: 10 },
    });
    const next = reduce(placed, { type: 'RoomCast', casterId: 'team-1-worm-1', angleDeg: 90 }, deps);
    expect(findWorm(next, 'team-1-worm-1')?.worm.hp).toBe(10);
    expect(findWorm(next, 'team-1-worm-2')?.worm.hp).toBe(90);
    expect(next.log.some((entry) => entry.kind === 'room.cast')).toBe(true);
  });
});
