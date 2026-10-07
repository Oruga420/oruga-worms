import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_DEFAULT } from '@/config/constants.ts';
import { createCamera } from '@/engine/camera.ts';
import { INITIAL_AIM } from '@/game/aim.ts';
import { drawGame } from '@/game/render.ts';
import { ISLAND_SCENERY, drawProps, drawSkyTheme, drawWaterTheme, sceneryOf } from '@/game/scenery.ts';
import { buildGame } from '@/game/setup.ts';
import { SCENARIOS, bareScenery, type SceneryProp, type SceneryPropKind } from '@/terrain/scenarios.ts';
import { SIGN_TEXT } from '@/terrain/scenarios/kame-house.ts';
import { DEFAULT_TEAM_SETUP, toMatchSetup, type TeamSetupState } from '@/ui/screens/team-setup.ts';
import { createFakeFactory } from '../terrain/fakes.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const VIEWPORT = { w: 1280, h: 720 };
const camera = () => createCamera({ x: WORLD_SIZE_DEFAULT.w / 2, y: WORLD_SIZE_DEFAULT.h / 2, bounds: WORLD_SIZE_DEFAULT });
const names = (ctx: ReturnType<typeof createRecordingContext>): string[] => ctx.calls.map((c) => c.name);
const count = (ctx: ReturnType<typeof createRecordingContext>, name: string): number => names(ctx).filter((n) => n === name).length;

function game(scenario: TeamSetupState['scenario']) {
  const built = buildGame({ setup: toMatchSetup({ ...DEFAULT_TEAM_SETUP, scenario }, 2, WORLD_SIZE_DEFAULT), createContext: createFakeFactory().factory });
  if (!built.ok) throw new Error(built.error.message);
  return built.value;
}

describe('sceneryOf', () => {
  it('hands a terrain without a scenery the island, and a built one its own', () => {
    expect(sceneryOf({})).toBe(ISLAND_SCENERY);
    expect(ISLAND_SCENERY).toEqual(bareScenery('island'));
    expect(sceneryOf(game('castle').terrain).id).toBe('castle');
  });
});

describe('drawSkyTheme', () => {
  it('paints the island sky with one gradient, the sun, clouds and two ridges', () => {
    const ctx = createRecordingContext();
    drawSkyTheme(ctx, VIEWPORT, camera(), SCENARIOS.island.sky, 300, 1000);
    expect(count(ctx, 'fillRect')).toBe(1);
    expect(count(ctx, 'arc')).toBeGreaterThan(7);
    expect(count(ctx, 'fill')).toBeGreaterThan(20);
  });

  it('paints the spaceship sky with stars and the ringed planet, no clouds or ridges', () => {
    const ctx = createRecordingContext();
    drawSkyTheme(ctx, VIEWPORT, camera(), SCENARIOS.spaceship.sky, 300, 1000);
    // The gradient, then a small rect per star, then the planet's bands and shade.
    expect(count(ctx, 'fillRect')).toBeGreaterThan(110);
    expect(count(ctx, 'stroke')).toBe(2);
    expect(count(ctx, 'scale')).toBe(2);
  });

  it('paints the castle dusk with stars, the moon, pink clouds and dark ridges, and the Kame House sky without ridges', () => {
    const castle = createRecordingContext();
    drawSkyTheme(castle, VIEWPORT, camera(), SCENARIOS.castle.sky, 300, 1000);
    const kame = createRecordingContext();
    drawSkyTheme(kame, VIEWPORT, camera(), SCENARIOS.kame_house.sky, 300, 1000);
    expect(count(castle, 'fillRect')).toBeGreaterThan(100);
    expect(count(kame, 'fillRect')).toBe(1);
    // Two ridges are two closed fills more than none.
    expect(count(castle, 'closePath')).toBe(count(kame, 'closePath') + 2);
  });
});

describe('drawWaterTheme', () => {
  it('fills the water with its gradient and strokes the foam, and draws nothing when the surface is off screen', () => {
    // A free camera, so the surface sits a known 100 px under the middle of the screen.
    const free = createCamera({ x: 960, y: 348 });
    const ctx = createRecordingContext();
    drawWaterTheme(ctx, VIEWPORT, free, SCENARIOS.kame_house.sky.water, free.y + 100, 500);
    expect(count(ctx, 'fill')).toBe(1);
    expect(count(ctx, 'stroke')).toBe(1);
    expect(count(ctx, 'lineTo')).toBeGreaterThan(VIEWPORT.w / 6);
    const none = createRecordingContext();
    drawWaterTheme(none, VIEWPORT, free, SCENARIOS.kame_house.sky.water, free.y + 2000, 500);
    expect(none.calls).toHaveLength(0);
  });
});

describe('drawProps', () => {
  const kinds: readonly SceneryPropKind[] = ['palm', 'flag', 'engine', 'beacon', 'dish', 'sign'];

  it('draws every kind of prop under the camera transform, and skips the ones far off screen', () => {
    const cam = camera();
    for (const kind of kinds) {
      const near: SceneryProp = { kind, x: cam.x, y: cam.y, text: 'HI', seed: 3 };
      const ctx = createRecordingContext();
      drawProps(ctx, VIEWPORT, cam, [near], 1234);
      expect(names(ctx)[0]).toBe('save');
      expect(names(ctx)[names(ctx).length - 1]).toBe('restore');
      expect(count(ctx, 'fill') + count(ctx, 'fillRect') + count(ctx, 'stroke') + count(ctx, 'fillText')).toBeGreaterThan(0);
      const far = createRecordingContext();
      drawProps(far, VIEWPORT, cam, [{ ...near, x: cam.x + VIEWPORT.w * 3 }], 1234);
      expect(count(far, 'fill') + count(far, 'fillRect') + count(far, 'stroke') + count(far, 'fillText')).toBe(0);
    }
    const empty = createRecordingContext();
    drawProps(empty, VIEWPORT, cam, [], 0);
    expect(empty.calls).toHaveLength(0);
  });

  it('writes the sign text and moves with the clock: a flag at two times is drawn through different points', () => {
    const cam = camera();
    const sign = createRecordingContext();
    drawProps(sign, VIEWPORT, cam, [{ kind: 'sign', x: cam.x, y: cam.y, w: 96, h: 18, text: SIGN_TEXT }], 0);
    expect(sign.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toEqual([SIGN_TEXT]);
    const a = createRecordingContext();
    const b = createRecordingContext();
    drawProps(a, VIEWPORT, cam, [{ kind: 'flag', x: cam.x, y: cam.y, h: 40 }], 0);
    drawProps(b, VIEWPORT, cam, [{ kind: 'flag', x: cam.x, y: cam.y, h: 40 }], 300);
    const lines = (ctx: ReturnType<typeof createRecordingContext>) => ctx.calls.filter((c) => c.name === 'lineTo').map((c) => c.args.join(','));
    expect(lines(a)).toHaveLength(lines(b).length);
    expect(lines(a)).not.toEqual(lines(b));
  });
});

describe('drawGame with a built scenario', () => {
  it('draws Kame House with its sign and palms, and the spaceship with its engines, on top of the land', () => {
    const kame = game('kame_house');
    const ctx = createRecordingContext();
    drawGame(ctx, VIEWPORT, camera(), { state: kame.state, world: kame.world, aim: INITIAL_AIM, timeMs: 1000 });
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain(SIGN_TEXT);
    expect(count(ctx, 'drawImage')).toBeGreaterThan(0);
    const ship = game('spaceship');
    const plain = createRecordingContext();
    drawGame(plain, VIEWPORT, camera(), { state: ship.state, world: ship.world, aim: INITIAL_AIM, timeMs: 1000 });
    expect(count(plain, 'drawImage')).toBeGreaterThan(0);
    expect(count(plain, 'closePath')).toBeGreaterThan(9);
  });
});
