import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_DEFAULT } from '@/config/constants.ts';
import { AIR, BEDROCK, BORDER_BEDROCK_PX, SOLID, get } from '@/terrain/mask.ts';
import { DEFAULT_SCENARIO, SCENARIOS, SCENARIO_IDS, bareScenery, isScenarioId, parseScenarioParam, type ScenarioId } from '@/terrain/scenarios.ts';
import { buildCastle } from '@/terrain/scenarios/castle.ts';
import { HOUSE_PINK, SIGN_TEXT, buildKameHouse } from '@/terrain/scenarios/kame-house.ts';
import { PORTHOLE, buildSpaceship } from '@/terrain/scenarios/spaceship.ts';
import { discSpans, fillEllipse, fillMerlons, fillPolygon, fillRect, fillSuperellipse, rectSpans, solidSpansIn, topEdgeSpansIn } from '@/terrain/scenarios/shapes.ts';
import { createMask, countSolid } from '@/terrain/mask.ts';
import { createScenario } from '@/terrain/terrain.ts';
import { DEFAULT_SPAWN_RULES, validateLevel } from '@/terrain/validate.ts';
import { initialWaterY } from '@/terrain/water.ts';
import { createFakeFactory } from './fakes.ts';

const { w: W, h: H } = WORLD_SIZE_DEFAULT;
const WATER = initialWaterY(H);
const BUILT: readonly ScenarioId[] = ['spaceship', 'castle', 'kame_house'];

describe('scenario ids', () => {
  it('lists the island first and the three built maps, and parses ?map= loosely', () => {
    expect(SCENARIO_IDS).toEqual(['island', 'spaceship', 'castle', 'kame_house']);
    expect(DEFAULT_SCENARIO).toBe('island');
    expect(isScenarioId('castle')).toBe(true);
    expect(isScenarioId('moon')).toBe(false);
    expect(parseScenarioParam('?map=castle')).toBe('castle');
    expect(parseScenarioParam('?seed=3&map=Kame-House')).toBe('kame_house');
    expect(parseScenarioParam('?map=moon')).toBeNull();
    expect(parseScenarioParam('')).toBeNull();
  });

  it('gives every scenario a name, a theme, a sky of four stops and, for the built ones, a builder', () => {
    for (const id of SCENARIO_IDS) {
      const scenario = SCENARIOS[id];
      expect(scenario.id).toBe(id);
      expect(scenario.name.length).toBeGreaterThan(0);
      expect(scenario.sky.gradient).toHaveLength(4);
      expect(scenario.build === null).toBe(id === 'island');
    }
    expect(bareScenery('castle')).toEqual({ id: 'castle', sky: SCENARIOS.castle.sky, props: [] });
  });
});

describe('shape fills', () => {
  it('clip to the mask and write the value asked for', () => {
    const mask = createMask(40, 30);
    fillRect(mask, -5, -5, 4, 4);
    expect(get(mask, 0, 0)).toBe(SOLID);
    expect(get(mask, 4, 4)).toBe(SOLID);
    expect(get(mask, 5, 5)).toBe(AIR);
    fillRect(mask, 0, 0, 2, 2, AIR);
    expect(get(mask, 1, 1)).toBe(AIR);
    fillEllipse(mask, 20, 15, 8, 4);
    expect(get(mask, 20, 15)).toBe(SOLID);
    expect(get(mask, 27, 15)).toBe(SOLID);
    expect(get(mask, 20, 10)).toBe(AIR);
    fillEllipse(mask, 20, 25, 6, 6, SOLID, 22, 23);
    expect(get(mask, 20, 22)).toBe(SOLID);
    expect(get(mask, 20, 24)).toBe(AIR);
    fillSuperellipse(mask, 32, 8, 6, 4, 4);
    expect(get(mask, 37, 11)).toBe(SOLID);
    fillPolygon(mask, [{ x: 2, y: 20 }, { x: 10, y: 28 }, { x: 2, y: 28 }]);
    expect(get(mask, 3, 27)).toBe(SOLID);
    expect(get(mask, 9, 21)).toBe(AIR);
  });

  it('stand merlons along a wall and report the spans a painter needs', () => {
    const mask = createMask(60, 20);
    fillRect(mask, 0, 10, 59, 19);
    fillMerlons(mask, 0, 59, 10, 4, 3, 6);
    expect(get(mask, 1, 8)).toBe(SOLID);
    expect(get(mask, 6, 8)).toBe(AIR);
    expect(get(mask, 10, 8)).toBe(SOLID);
    expect(rectSpans(2, 3, 4, 4)).toEqual([
      { y: 3, x0: 2, x1: 4 },
      { y: 4, x0: 2, x1: 4 },
    ]);
    expect(discSpans(10, 10, 1)).toEqual([
      { y: 9, x0: 10, x1: 10 },
      { y: 10, x0: 9, x1: 11 },
      { y: 11, x0: 10, x1: 10 },
    ]);
    const solid = solidSpansIn(mask, 0, 8, 12, 8);
    expect(solid).toEqual([
      { y: 8, x0: 0, x1: 3 },
      { y: 8, x0: 10, x1: 12 },
    ]);
    const tops = topEdgeSpansIn(mask, 0, 0, 0, 19, 2);
    expect(tops).toEqual([
      { y: 7, x0: 0, x1: 0 },
      { y: 8, x0: 0, x1: 0 },
    ]);
  });
});

describe('built scenarios', () => {
  it.each(BUILT)('%s builds a bedrock ringed mask that passes the island rules for every seed from 1 to 6', (id) => {
    const build = SCENARIOS[id].build;
    if (build === null) throw new Error('not built');
    for (let seed = 1; seed <= 6; seed += 1) {
      const { mask, props } = build({ width: W, height: H, seed, waterY: WATER });
      expect(mask.width).toBe(W);
      expect(get(mask, 0, 0)).toBe(BEDROCK);
      expect(get(mask, W - 1, H - 1)).toBe(BEDROCK);
      expect(get(mask, BORDER_BEDROCK_PX, 10)).toBe(AIR);
      const verdict = validateLevel(mask, WATER, DEFAULT_SPAWN_RULES);
      expect(verdict.ok, verdict.ok ? '' : `${id} seed ${seed}: ${verdict.error.message}`).toBe(true);
      if (verdict.ok) expect(verdict.value.spawns.length).toBeGreaterThanOrEqual(DEFAULT_SPAWN_RULES.minSpawns);
      for (const prop of props) {
        expect(prop.x).toBeGreaterThan(0);
        expect(prop.x).toBeLessThan(W);
        expect(prop.y).toBeGreaterThan(0);
        expect(prop.y).toBeLessThan(H);
      }
    }
  });

  it('the spaceship hangs over the void with its deck mid screen, and nothing under its keel but the pod', () => {
    const { mask, props } = buildSpaceship({ width: W, height: H, seed: 1, waterY: WATER });
    // Air across the bottom rows above the bedrock, where the island would have land.
    expect(get(mask, W / 2, H - 4)).toBe(AIR);
    expect(get(mask, W / 2, Math.round(H * 0.52))).toBe(SOLID);
    expect(props.filter((p) => p.kind === 'engine')).toHaveLength(3);
    expect(props.some((p) => p.kind === 'dish')).toBe(true);
    expect(props.filter((p) => p.kind === 'beacon')).toHaveLength(2);
  });

  it('the castle stands on a hill with a keep taller than its walls and a sealed gatehouse, flags on the towers', () => {
    const { mask, props } = buildCastle({ width: W, height: H, seed: 2, waterY: WATER });
    const cx = Math.round(W / 2);
    const topOf = (x: number): number => {
      for (let y = BORDER_BEDROCK_PX; y < H; y += 1) if (get(mask, x, y) !== AIR) return y;
      return -1;
    };
    const keepTop = topOf(cx + 20);
    const wallTop = topOf(cx - 200);
    const towerTop = topOf(cx - 310);
    expect(keepTop).toBeGreaterThan(0);
    expect(keepTop).toBeLessThan(wallTop);
    expect(towerTop).toBeLessThan(keepTop);
    // The gatehouse: air inside the keep's foot.
    let sealed = 0;
    for (let y = keepTop; y < H; y += 1) if (get(mask, cx, y) === AIR) sealed += 1;
    expect(sealed).toBeGreaterThanOrEqual(60);
    expect(props.filter((p) => p.kind === 'flag')).toHaveLength(3);
  });

  it('Kame House is hollow, stands on a flat beach with palms either side, and carries its sign', () => {
    const { mask, props } = buildKameHouse({ width: W, height: H, seed: 3, waterY: WATER });
    const beach = Math.round(H * 0.805);
    const houseX = Math.round(W / 2 + 80 + 80);
    // Sand under the beach line, air above it.
    expect(get(mask, W / 2 - 200, beach + 6)).toBe(SOLID);
    expect(get(mask, W / 2 - 200, beach - 14)).toBe(AIR);
    // The house: wall above the beach, the room inside it air, the dome over it.
    expect(get(mask, houseX - 70, beach - 40)).toBe(SOLID);
    expect(get(mask, houseX, beach - 40)).toBe(AIR);
    expect(get(mask, houseX, beach - 100)).toBe(SOLID);
    expect(props.filter((p) => p.kind === 'palm')).toHaveLength(3);
    const sign = props.find((p) => p.kind === 'sign');
    expect(sign?.text).toBe(SIGN_TEXT);
    expect(countSolid(mask)).toBeGreaterThan(0);
  });
});

describe('createScenario', () => {
  it.each(SCENARIO_IDS)('%s: builds, paints and bundles a terrain carrying its scenery', (id) => {
    const fake = createFakeFactory();
    const result = createScenario(id, { width: W, height: H, seed: 5 }, fake.factory);
    expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    if (!result.ok) return;
    const { terrain, report, attempts } = result.value;
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(report.spawns.length).toBeGreaterThanOrEqual(DEFAULT_SPAWN_RULES.minSpawns);
    expect(terrain.scenery?.id).toBe(id);
    expect(terrain.scenery?.sky).toBe(SCENARIOS[id].sky);
    expect(terrain.theme).toBe(SCENARIOS[id].theme);
    expect(terrain.source).toBe(id === 'island' ? 'procedural' : 'built');
    expect(terrain.water.y).toBe(WATER);
    expect(Object.isFrozen(terrain)).toBe(true);
    // A built scenario's details are painted over the theme: its colours reach the tiles.
    const styles = new Set(fake.created.flatMap((ctx) => ctx.rects.map((r) => r.style)));
    if (id === 'spaceship') expect(styles.has(PORTHOLE)).toBe(true);
    if (id === 'kame_house') expect(styles.has(HOUSE_PINK)).toBe(true);
    if (id === 'island') expect(terrain.scenery?.props).toEqual([]);
    else expect(terrain.scenery?.props.length).toBeGreaterThan(0);
  });

  it('reports the rejection when a built map cannot pass in the attempts given', () => {
    // A map too small for eight spawns: every attempt fails and the last rejection says why.
    const result = createScenario('kame_house', { width: 200, height: 120, seed: 1, maxAttempts: 2 }, createFakeFactory().factory);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('exhausted');
    expect(result.error.attempts).toBe(2);
    expect(result.error.lastSeed).toBe(2);
    expect(result.error.message).toContain('Kame House');
  });
});
