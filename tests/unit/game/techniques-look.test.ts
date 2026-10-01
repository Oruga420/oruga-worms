import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { createCamera } from '@/engine/camera.ts';
import { createParticleSystem } from '@/engine/particles.ts';
import { ANTARES_STAR, constellationAlpha, nailCharge, sinceSting, starAt } from '@/game/antares.ts';
import { techniqueFocus } from '@/game/camera-target.ts';
import { cinematicFor, techniqueCinematic } from '@/game/cinematic.ts';
import type { GameEvent } from '@/game/controller.ts';
import { advanceFx, applyFxEvents, createFx, drawFxScreen, drawFxWorld, type FxDeps } from '@/game/fx.ts';
import { burstBloom, cosmosOpen } from '@/game/galaxian.ts';
import { createGore } from '@/game/gore.ts';
import { armFire, drawBack } from '@/game/hiken.ts';
import { gravityPull, swordUp } from '@/game/meteor.ts';
import { superPrice } from '@/game/price.ts';
import { drawGame, poseFor, techniqueRoles, type WormVisual } from '@/game/render.ts';
import { cutFlash, cutLine } from '@/game/santoryu.ts';
import { quickGame } from '@/game/setup.ts';
import { SENSES } from '@/game/technique-fx.ts';
import { lotusBloom, wheelState } from '@/game/tenbu.ts';
import { beamLight, circleLook } from '@/game/zoltraak.ts';
import { activeWormOf } from '@/match/ledger.ts';
import { galaxyAt } from '@/sim/techniques/galaxy.ts';
import { spawnTreasureStrike } from '@/sim/techniques/treasure.ts';
import type { DiceBody, GalaxyBody, HikenBody, MeteorBody, NeedleBody, TechniqueBody, TreasureBody, ZoltraakBody } from '@/sim/types.ts';
import { addWorm, findWorm, stepWorld, type SimWorld } from '@/sim/world.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';
import { flatWorld } from '../sim/fixture.ts';
import { createFakeFactory } from '../terrain/fakes.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

/**
 * The look of the anime row's techniques: the timing helpers each scene is drawn from, the poses,
 * the camera and the cinematic, the effects and the names called, and every scene drawn mid flight
 * without a hitch.
 */

function arena(): { world: SimWorld; hero: ReturnType<typeof addWorm>; enemy: ReturnType<typeof addWorm> } {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480 });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  const enemy = addWorm(world, { id: 'enemy', teamId: 'b', x: 420, y: 349 });
  return { world, hero, enemy };
}

function cast<T extends TechniqueBody>(world: SimWorld, hero: ReturnType<typeof addWorm>, weapon: WeaponId, aim: { angleDeg?: number; targetPoint?: { x: number; y: number } } = {}): T {
  fire(world, hero, WEAPONS[weapon], { angleDeg: aim.angleDeg ?? 0, power: 1, ...(aim.targetPoint === undefined ? {} : { targetPoint: aim.targetPoint }) });
  const body = world.techniques[0];
  if (body === undefined) throw new Error(`no technique for ${weapon}`);
  return body as T;
}

function step(world: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) stepWorld(world);
}

describe('technique looks: the timing helpers', () => {
  it('Antares: the nail reddens through the point, the stars come in, and the heart sits above the middle', () => {
    const { world, hero } = arena();
    const body = cast<NeedleBody>(world, hero, 'antares');
    expect(nailCharge(body)).toBe(0);
    step(world, 40);
    expect(nailCharge(body)).toBeGreaterThan(0.3);
    expect(constellationAlpha(body)).toBeGreaterThan(0);
    while (body.stage === 'point') stepWorld(world);
    step(world, 2);
    expect(sinceSting(body)).toBeLessThan(10);
    const heart = starAt(-1, 100, 100);
    expect(heart.y).toBeLessThan(100);
    expect(ANTARES_STAR.x).toBe(0);
  });

  it('the Galaxian Explosion: the cosmos opens through the charge and the bloom follows the burst', () => {
    const { world, hero } = arena();
    const body = cast<GalaxyBody>(world, hero, 'galaxian');
    step(world, 60);
    expect(cosmosOpen(body)).toBeGreaterThan(0.5);
    expect(burstBloom(body)).toBeNull();
    while (body.stage !== 'recover' && body.alive) stepWorld(world);
    stepWorld(world);
    expect(burstBloom(body)).not.toBeNull();
  });

  it('the Tesoro del Cielo: the lotus blooms, the wheel comes down in the cast and swells in a strike', () => {
    const { world, hero, enemy } = arena();
    const body = cast<TreasureBody>(world, hero, 'tenbu_horin');
    expect(wheelState(body)).toBeNull();
    step(world, 60);
    expect(lotusBloom(body)).toBeGreaterThan(0.9);
    const coming = wheelState(body);
    expect(coming?.drop ?? 1).toBeGreaterThan(0);
    step(world, 400);
    const spec = WEAPONS.tenbu_horin.technique!;
    if (spec.kind !== 'treasure') throw new Error('not the treasure');
    const strike = spawnTreasureStrike(world, { weaponId: 'tenbu_horin', casterId: 'hero', casterTeamId: 'a', target: enemy, spec, hit: 1, fatal: false });
    step(world, 10);
    const early = wheelState(strike)?.scale ?? 0;
    step(world, 50);
    expect(wheelState(strike)?.scale ?? 0).toBeGreaterThan(early);
  });

  it('the Hiken, Fujitora and the Santoryu: the arm burns, the sword rises, the cuts grid the square and flash as they land', () => {
    const hiken = arena();
    const fist = cast<HikenBody>(hiken.world, hiken.hero, 'hiken');
    step(hiken.world, 40);
    expect(armFire(fist)).toBeGreaterThan(0.5);
    expect(drawBack(fist)).toBeGreaterThan(0.5);
    const meteor = arena();
    const rock = cast<MeteorBody>(meteor.world, meteor.hero, 'meteor', { targetPoint: { x: 600, y: 349 } });
    step(meteor.world, 40);
    expect(gravityPull(rock)).toBeGreaterThan(0.5);
    expect(swordUp(rock)).toBeGreaterThan(0.9);
    const dice = arena();
    const cut = cast<DiceBody>(dice.world, dice.hero, 'santoryu', { angleDeg: 10 });
    const level = cutLine(cut, 1, 6);
    const upright = cutLine(cut, 2, 6);
    expect(Math.abs(level.x1 - level.x0)).toBe(cut.side);
    expect(Math.abs(upright.y1 - upright.y0)).toBe(cut.side);
    for (const line of [level, upright]) {
      for (const [x, y] of [[line.x0, line.y0], [line.x1, line.y1]] as const) {
        expect(x).toBeGreaterThanOrEqual(cut.squareX - 1);
        expect(x).toBeLessThanOrEqual(cut.squareX + cut.side + 1);
        expect(y).toBeGreaterThanOrEqual(cut.squareY - 1);
        expect(y).toBeLessThanOrEqual(cut.squareY + cut.side + 1);
      }
    }
    while (!cut.cut && cut.alive) stepWorld(dice.world);
    stepWorld(dice.world);
    expect(cutFlash(cut)).not.toBeNull();
  });

  it('Zoltraak: a circle opens once its time comes, and its beam is brightest the tick it fires', () => {
    const { world, hero } = arena();
    const body = cast<ZoltraakBody>(world, hero, 'zoltraak');
    expect(circleLook(body, 0).open).toBe(0);
    step(world, 45);
    expect(circleLook(body, 0).open).toBeGreaterThan(0.9);
    while (body.stage !== 'fire') stepWorld(world);
    stepWorld(world);
    expect(beamLight(body, 0)).toBeGreaterThan(0.9);
  });

  it('names every price the panel and the aim show', () => {
    expect(superPrice(WEAPONS.antares)).toEqual({ badge: '-50%♥', label: 'COSTS HALF YOUR HP' });
    expect(superPrice(WEAPONS.galaxian)).toEqual({ badge: '-50♥', label: 'COSTS 50 HP' });
    expect(superPrice(WEAPONS.tenbu_horin)).toEqual({ badge: '-15♥×3', label: 'COSTS 15 HP A STRIKE' });
    expect(superPrice(WEAPONS.hiken)).toBeNull();
  });
});

describe('technique looks: poses, camera and cinematic', () => {
  const visual = (x: number, y: number): WormVisual => ({ x, y, vx: 0, vy: 0, facing: 1, color: '#fff', name: 'w', hp: 100, active: false, motion: 'idle', alive: true, colorIndex: 0 });

  it('gives Antares\' worms their parts: the pointer points, the stung one writhes', () => {
    const { world, hero } = arena();
    cast<NeedleBody>(world, hero, 'antares');
    while (world.techniques[0]?.stage === 'point') stepWorld(world);
    stepWorld(world);
    const roles = techniqueRoles(world.techniques);
    expect(roles.get('hero')?.role).toBe('attacker');
    expect(roles.get('enemy')?.role).toBe('victim');
    expect(poseFor({ worm: visual(300, 349), technique: roles.get('hero'), timeMs: 0 }).frame).toBe('hold_gun');
    expect(['hurt', 'knocked']).toContain(poseFor({ worm: visual(420, 349), technique: roles.get('enemy'), timeMs: 0 }).frame);
  });

  it('frames the galaxy in flight and darkens the world while the stars gather', () => {
    const { world, hero } = arena();
    const body = cast<GalaxyBody>(world, hero, 'galaxian');
    step(world, 60);
    const gathering = techniqueCinematic(body);
    expect(gathering.dim).toBeGreaterThan(0.4);
    expect(gathering.zoom).toBeGreaterThan(1);
    expect(cinematicFor([], [], [], [], [], world.techniques)).toEqual(gathering);
    while (body.stage === 'charge') stepWorld(world);
    stepWorld(world);
    const at = galaxyAt(body);
    expect(at).not.toBeNull();
    expect(techniqueFocus(body, world.worms)).toEqual(at);
    while (body.alive) stepWorld(world);
    const done = techniqueCinematic(body);
    expect(done.zoom).toBeCloseTo(1, 1);
  });

  it('frames the meteor as it falls', () => {
    const { world, hero } = arena();
    const rock = cast<MeteorBody>(world, hero, 'meteor', { targetPoint: { x: 600, y: 349 } });
    while (rock.stage === 'call') stepWorld(world);
    step(world, 5);
    expect(techniqueFocus(rock, world.worms)).toEqual({ x: rock.x, y: rock.y });
  });
});

function deps(): FxDeps {
  return { gore: createGore(), particles: createParticleSystem(), rng: createRng(4), onScreen: () => true };
}

describe('technique looks: effects and names', () => {
  const start = (kind: 'needle' | 'treasure' | 'dice', strike?: number): GameEvent => ({ type: 'techniqueStart', techniqueId: 1, kind, weapon: 'x', attackerId: 'a', victimId: 'v', x: 100, y: 100, facing: 1, colorIndex: 0, ...(strike === undefined ? {} : { strike }) });

  it('calls each technique\'s name, one at a time, and numbers a strike of the treasure', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start('needle')], d);
    expect(fx.calls.map((c) => c.text)).toEqual(['¡AGUJA ESCARLATA!']);
    applyFxEvents(fx, [{ type: 'techniqueBeat', techniqueId: 1, kind: 'needle', attackerId: 'a', victimId: 'v', beat: 'antares', n: 0, x: 100, y: 100, facing: 1, colorIndex: 0 }], d);
    expect(fx.calls.map((c) => c.text)).toEqual(['¡ANTARES!']);
    applyFxEvents(fx, [start('treasure', 2)], d);
    expect(fx.calls[0]).toMatchObject({ text: 'TESORO DEL CIELO', sub: 'GOLPE 2' });
    applyFxEvents(fx, [{ type: 'techniqueBeat', techniqueId: 1, kind: 'treasure', attackerId: 'a', victimId: 'v', beat: 'sense', n: 1, x: 100, y: 100, facing: 1, colorIndex: 0 }], d);
    expect(fx.pops.some((p) => p.text === `−${SENSES[0]}`)).toBe(true);
    for (let i = 0; i < 200; i += 1) advanceFx(fx, 1000 / 60, null, d);
    expect(fx.calls).toEqual([]);
  });

  it('throws the Santoryu\'s cubes, which fall onto the land, lie still and are gone', () => {
    const fx = createFx();
    const d = deps();
    const world = flatWorld({ floorY: 200, waterY: 280 });
    const cells = [{ x: 100, y: 150, size: 12, surface: true }, { x: 112, y: 150, size: 12, surface: false }];
    applyFxEvents(fx, [{ type: 'techniqueBeat', techniqueId: 1, kind: 'dice', attackerId: 'a', victimId: null, beat: 'cut', n: 0, x: 110, y: 156, facing: 1, colorIndex: 0, cells }], d);
    expect(fx.cubes).toHaveLength(2);
    const scene = { world, hpOf: () => 100, maxHp: 100 };
    for (let i = 0; i < 90; i += 1) advanceFx(fx, 1000 / 60, scene, d);
    for (const cube of fx.cubes) expect(cube.y).toBeLessThan(200 + 6);
    expect(fx.cubes.some((c) => c.resting)).toBe(true);
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 200, y: 150, bounds: { w: 400, h: 300 } }), { w: 800, h: 600 });
    expect(ctx.calls.some((c) => c.name === 'fillRect')).toBe(true);
    for (let i = 0; i < 300; i += 1) advanceFx(fx, 1000 / 60, scene, d);
    expect(fx.cubes).toEqual([]);
  });

  it('draws the names over the screen', () => {
    const fx = createFx();
    applyFxEvents(fx, [start('dice')], deps());
    const ctx = createRecordingContext();
    drawFxScreen(ctx, fx, { w: 1280, h: 720 });
    expect(ctx.calls.some((c) => c.name === 'fillText' && c.args[0] === 'SANTORYU')).toBe(true);
    expect(ctx.calls.some((c) => c.name === 'fillText' && c.args[0] === 'RORONOA ZORO')).toBe(true);
  });
});

describe('technique looks: every scene draws', () => {
  const ids = ['antares', 'galaxian', 'tenbu_horin', 'hiken', 'meteor', 'santoryu', 'zoltraak'] as const;

  for (const id of ids) {
    it(`draws ${id} from start to end without a hitch`, () => {
      const game = quickGame(5, createFakeFactory().factory, { w: 1200, h: 500 });
      if (!game.ok) throw new Error(game.error.message);
      const { state, world } = game.value;
      const active = activeWormOf(state);
      const body = active === undefined ? undefined : findWorm(world, active.id);
      const enemy = world.worms.find((w) => w.teamId !== body?.teamId);
      if (body === undefined || enemy === undefined) throw new Error('no worms');
      enemy.x = body.x + body.facing * 70;
      enemy.y = body.y;
      fire(world, body, WEAPONS[id], { angleDeg: 0, power: 1, targetPoint: { x: enemy.x, y: enemy.y } });
      const camera = createCamera({ x: body.x, y: body.y, bounds: { w: 1200, h: 500 } });
      let draws = 0;
      for (let tick = 0; tick < 600 && world.techniques.length > 0; tick += 1) {
        stepWorld(world);
        if (tick % 15 !== 0) continue;
        const ctx = createRecordingContext();
        expect(() => drawGame(ctx, { w: 1200, h: 500 }, camera, { state: { ...state, phase: 'Firing' }, world, aim: { angleDeg: 0, charging: false, power: 0 }, timeMs: tick * 16, dim: 0.5 })).not.toThrow();
        expect(ctx.calls.length).toBeGreaterThan(0);
        draws += 1;
      }
      expect(draws).toBeGreaterThan(3);
    });
  }
});
