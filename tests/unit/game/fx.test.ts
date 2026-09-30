import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { createCamera } from '@/engine/camera.ts';
import { createParticleSystem } from '@/engine/particles.ts';
import type { GameEvent } from '@/game/controller.ts';
import {
  BEAM_SHOUT_MS,
  COMBO_HUD_LINGER_MS,
  DEVOURED_MS,
  DRUM_CALL_MS,
  GEAR_CALL_MS,
  POP_MS,
  TRACER_MS,
  advanceFx,
  applyFxEvents,
  createFx,
  drawFxScreen,
  drawFxWorld,
  noteWeapon,
  numberLook,
  wormAnim,
  type FxDeps,
} from '@/game/fx.ts';
import { createGore, goreCount, type GoreBit } from '@/game/gore.ts';
import { addWorm } from '@/sim/world.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from '../sim/fixture.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

function deps(): FxDeps {
  return { gore: createGore(), particles: createParticleSystem(), rng: createRng(4), onScreen: () => true };
}

const TICK = 1000 / 60;

function damage(wormId: string, amount: number, cause: 'blast' | 'fall' | 'hit' | 'melee' = 'hit', lost = amount): GameEvent {
  return { type: 'damage', wormId, amount, lost, cause, x: 100, y: 100, dx: 1, dy: 0 };
}

describe('fx: hits', () => {
  it('a hit makes the worm flinch, bleeds, and floats its damage up', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [damage('w', 25, 'melee')], d);
    expect(wormAnim(fx, 'w')?.hurtMs).toBe(0);
    expect(fx.numbers).toHaveLength(1);
    expect(fx.numbers[0]?.amount).toBe(25);
    expect(goreCount(d.gore)).toBeGreaterThan(10);
    // A heavy blow reddens the screen's edges and throws blood on the lens.
    expect(fx.redPulse).not.toBeNull();
    expect(d.gore.lens.length).toBeGreaterThan(0);
  });

  it('hits in quick succession count up in one number, a later one starts another', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [damage('w', 5)], d);
    advanceFx(fx, 100, null, d);
    applyFxEvents(fx, [damage('w', 5)], d);
    expect(fx.numbers).toHaveLength(1);
    expect(fx.numbers[0]?.amount).toBe(10);
    advanceFx(fx, 1000, null, d);
    applyFxEvents(fx, [damage('w', 5)], d);
    expect(fx.numbers).toHaveLength(2);
  });

  it('a number still collecting a flurry stays in full view until the blows stop', () => {
    // The super's cadence: sixteen blows 85 ms apart, then the finisher 290 ms after the last.
    const fx = createFx();
    const d = deps();
    for (let hit = 0; hit < 16; hit += 1) {
      applyFxEvents(fx, [damage('w', 3, 'melee')], d);
      advanceFx(fx, 85, null, d);
    }
    advanceFx(fx, 290 - 85, null, d);
    applyFxEvents(fx, [damage('w', 27, 'melee')], d);
    expect(fx.numbers).toHaveLength(1);
    const number = fx.numbers[0];
    if (number === undefined) throw new Error('no number');
    expect(number.amount).toBe(75);
    expect(numberLook(number, fx.now).alpha).toBe(1);
    // It then reads for a while and fades out, counted from the finisher.
    advanceFx(fx, 1000, null, d);
    expect(numberLook(number, fx.now).alpha).toBe(1);
    advanceFx(fx, 600, null, d);
    expect(fx.numbers).toHaveLength(0);
  });

  it('counts only the hp a blow took: a worm beaten past 0 bleeds without a number', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [damage('w', 50, 'blast', 10)], d);
    expect(fx.numbers[0]?.amount).toBe(10);
    const fresh = createFx();
    const e = deps();
    applyFxEvents(fresh, [damage('v', 3, 'melee', 0)], e);
    expect(fresh.numbers).toHaveLength(0);
    expect(goreCount(e.gore)).toBeGreaterThan(0);
    expect(wormAnim(fresh, 'v')?.hurtMs).toBe(0);
  });

  it('a worm reduced to 0 hp bursts into chunks', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [{ type: 'gib', wormId: 'w', x: 50, y: 50, vx: 100, vy: -50, colorIndex: 2 }], d);
    const chunks: GoreBit[] = [];
    d.gore.bits.forEach((bit) => {
      if (bit.kind === 'chunk') chunks.push(bit);
    });
    expect(chunks.length).toBeGreaterThan(10);
    expect(fx.rings).toHaveLength(1);
  });
});

describe('fx: weapons', () => {
  it('a gun shot flashes at the muzzle and flips a casing out', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [{ type: 'fired', wormId: 'w', weapon: 'shotgun', x: 100, y: 100, angleDeg: 10, facing: 1 }], d);
    expect(fx.flashes.some((f) => f.kind === 'muzzle')).toBe(true);
    let casings = 0;
    d.gore.bits.forEach((bit) => {
      if (bit.shape === 'casing' && bit.kind === 'chunk') casings += 1;
    });
    expect(casings).toBe(1);
    expect(wormAnim(fx, 'w')?.firedWeapon).toBe('shotgun');
  });

  it('tracers fade out on their own clock', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [{ type: 'tracer', x: 0, y: 0, x1: 100, y1: 0, hit: 'land' }], d);
    expect(fx.tracers).toHaveLength(1);
    advanceFx(fx, TRACER_MS + TICK, null, d);
    expect(fx.tracers).toHaveLength(0);
  });

  it('a real blast gets a flash and a shock ring, a bullet puff does not', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [{ type: 'explosion', x: 0, y: 0, radius: 6, particle: 'small', shake: 0 }], d);
    expect(fx.rings).toHaveLength(0);
    applyFxEvents(fx, [{ type: 'explosion', x: 0, y: 0, radius: 48, particle: 'medium', shake: 4 }], d);
    expect(fx.rings).toHaveLength(1);
    expect(fx.flashes.some((f) => f.kind === 'blast')).toBe(true);
  });

  it('a weapon switch pops the new weapon', () => {
    const fx = createFx();
    noteWeapon(fx, 'w', 'bazooka');
    expect(wormAnim(fx, 'w')?.switchedMs).toBe(Infinity);
    noteWeapon(fx, 'w', 'shotgun');
    expect(wormAnim(fx, 'w')?.switchedMs).toBe(0);
  });

  it('a thrown worm turns only by what it spun each tick, however late in the match', () => {
    const fx = createFx();
    fx.now = 120_000;
    const d = deps();
    const world = flatWorld({ width: 600, height: 400, floorY: 300 });
    const worm = addWorm(world, { id: 'w', teamId: 'a', x: 100, y: 200 });
    worm.motion = 'flying';
    let last = 0;
    for (let i = 0; i < 90; i += 1) {
      // Slowing and turning over the arc: the speed changes on every tick.
      worm.vx = 448 - i * 5;
      worm.vy = -448 + i * 11;
      advanceFx(fx, TICK, { world, hpOf: () => 100, maxHp: 100 }, d);
      const tumble = wormAnim(fx, 'w')?.tumble ?? 0;
      expect(Math.abs(tumble - last)).toBeLessThanOrEqual((18 * TICK) / 1000 + 1e-9);
      last = tumble;
    }
    expect(last).toBeGreaterThan(1);
    // Down again: upright.
    worm.motion = 'idle';
    advanceFx(fx, TICK, { world, hpOf: () => 100, maxHp: 100 }, d);
    expect(wormAnim(fx, 'w')?.tumble).toBe(0);
  });

  it('rockets trail smoke and a badly hurt worm drips', () => {
    const fx = createFx();
    const d = deps();
    const world = flatWorld({ width: 600, height: 400, floorY: 300 });
    const worm = addWorm(world, { id: 'w', teamId: 'a', x: 100, y: 299 });
    fire(world, worm, WEAPONS.bazooka, { angleDeg: 45, power: 1 });
    advanceFx(fx, TICK, { world, hpOf: () => 100, maxHp: 100 }, d);
    expect(d.particles.count()).toBeGreaterThan(0);
    const bleeding = createFx();
    const b = deps();
    for (let i = 0; i < 240; i += 1) advanceFx(bleeding, TICK, { world, hpOf: () => 5, maxHp: 100 }, b);
    let drops = 0;
    b.gore.bits.forEach((bit) => {
      if (bit.kind === 'drop') drops += 1;
    });
    expect(drops).toBeGreaterThan(0);
  });
});

describe('fx: the super move', () => {
  it('names the move, counts the blows, calls the knockout and clears after the linger', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [{ type: 'comboStart', comboId: 9, weapon: 'ryuko_ranbu', attackerId: 'a', victimId: 'v', x: 0, y: 0 }], d);
    expect(fx.combo?.hits).toBe(0);
    expect(fx.screenFlash?.color).toBe('#ffffff');
    for (let hit = 1; hit <= 16; hit += 1) {
      applyFxEvents(fx, [{ type: 'comboHit', comboId: 9, attackerId: 'a', victimId: 'v', hit, finisher: false, ko: false, x: 0, y: 0, dx: 1, dy: 0 }], d);
    }
    expect(fx.combo?.hits).toBe(16);
    applyFxEvents(fx, [{ type: 'comboHit', comboId: 9, attackerId: 'a', victimId: 'v', hit: 17, finisher: true, ko: true, x: 0, y: 0, dx: 1, dy: -1 }], d);
    expect(fx.combo?.ko).toBe(true);
    expect(d.gore.lens.length).toBeGreaterThan(0);
    applyFxEvents(fx, [{ type: 'comboEnd', comboId: 9, attackerId: 'a', victimId: 'v', hits: 16, x: 0, y: 0 }], d);
    expect(fx.combo?.endedAt).not.toBeNull();
    advanceFx(fx, COMBO_HUD_LINGER_MS + 1000, null, d);
    expect(fx.combo).toBeNull();
  });

  it('ignores the beats of a combo it never saw start', () => {
    const fx = createFx();
    applyFxEvents(fx, [{ type: 'comboHit', comboId: 3, attackerId: 'a', victimId: 'v', hit: 1, finisher: false, ko: false, x: 0, y: 0, dx: 1, dy: 0 }], deps());
    expect(fx.combo).toBeNull();
  });
});

describe('fx: drawing', () => {
  it('draws the world effects and the screen overlays without throwing', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(
      fx,
      [
        { type: 'comboStart', comboId: 1, weapon: 'ryuko_ranbu', attackerId: 'a', victimId: 'v', x: 0, y: 0 },
        { type: 'comboHit', comboId: 1, attackerId: 'a', victimId: 'v', hit: 3, finisher: false, ko: false, x: 0, y: 0, dx: 1, dy: 0 },
        { type: 'tracer', x: 0, y: 0, x1: 40, y1: 0, hit: 'worm' },
        { type: 'swing', wormId: 'a', weapon: 'fire_punch', x: 0, y: 0, facing: 1 },
        { type: 'drown', wormId: 'd', x: 0, y: 0, facing: -1, colorIndex: 1 },
        damage('v', 30, 'melee'),
      ],
      d,
    );
    const ctx = createRecordingContext();
    const camera = createCamera({ x: 0, y: 0 });
    drawFxWorld(ctx, fx, camera, { w: 800, h: 600 });
    drawFxWorld(ctx, fx, camera, { w: 800, h: 600 }, undefined, 1);
    drawFxScreen(ctx, fx, { w: 800, h: 600 });
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('RYUKO RANBU');
    expect(texts).toContain('3');
    expect(texts).toContain('-30');
  });

  it('on a phone the hit counter sits under the clock, clear of the touch pad at the lower left', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(
      fx,
      [
        { type: 'comboStart', comboId: 1, weapon: 'ryuko_ranbu', attackerId: 'a', victimId: 'v', x: 0, y: 0 },
        { type: 'comboHit', comboId: 1, attackerId: 'a', victimId: 'v', hit: 7, finisher: false, ko: false, x: 0, y: 0, dx: 1, dy: 0 },
      ],
      d,
    );
    const counterAt = (touch: boolean, viewport: { w: number; h: number }): { x: number; y: number } => {
      const ctx = createRecordingContext();
      drawFxScreen(ctx, fx, viewport, { touch });
      const drawn = ctx.calls.filter((c) => c.name === 'fillText' && c.args[0] === '7').at(-1);
      return { x: Number(drawn?.args[1]), y: Number(drawn?.args[2]) };
    };
    // Desktop keeps it at the left edge, halfway down.
    expect(counterAt(false, { w: 1280, h: 720 })).toMatchObject({ x: 1280 * 0.07, y: 720 * 0.42 });
    // Landscape and portrait phones: above the pad (which starts ~40% down in landscape) and right of the team bars.
    for (const viewport of [{ w: 844, h: 390 }, { w: 390, h: 844 }]) {
      const at = counterAt(true, viewport);
      expect(at.y).toBeLessThan(viewport.h * 0.25);
      expect(at.x).toBeGreaterThan(Math.min(180, viewport.w * 0.2));
    }
  });
});

describe('fx: the beam', () => {
  const start: GameEvent = { type: 'beamStart', beamId: 4, weapon: 'kamehameha', attackerId: 'a', x: 0, y: 0, dx: 1, dy: 0 };
  const release: GameEvent = { type: 'beamFire', beamId: 4, attackerId: 'a', x: 0, y: 0, dx: 1, dy: 0 };
  const end: GameEvent = { type: 'beamEnd', beamId: 4, attackerId: 'a', hits: 1 };
  const said = (fx: ReturnType<typeof createFx>): string[] => {
    const ctx = createRecordingContext();
    drawFxScreen(ctx, fx, { w: 1280, h: 720 });
    return ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  };

  it('chants a syllable a quarter of the charge, then shouts with a flash as it fires', () => {
    const fx = createFx();
    const d = deps();
    const charge = WEAPONS.kamehameha.beam!.chargeMs;
    applyFxEvents(fx, [start], d);
    expect(said(fx)).toContain('KA...');
    advanceFx(fx, charge * 0.26, null, d);
    expect(said(fx)).toContain('KA... ME...');
    advanceFx(fx, charge * 0.5, null, d);
    expect(said(fx)).toContain('KA... ME... HA... ME...');
    applyFxEvents(fx, [release], d);
    expect(fx.screenFlash).not.toBeNull();
    expect(d.particles.count()).toBeGreaterThan(0);
    expect(said(fx)).toContain('HA!!!');
    expect(said(fx).some((t) => t.startsWith('KA'))).toBe(false);
    advanceFx(fx, BEAM_SHOUT_MS + 10, null, d);
    expect(said(fx)).not.toContain('HA!!!');
    applyFxEvents(fx, [end], d);
    advanceFx(fx, 20, null, d);
    expect(fx.beam).toBeNull();
  });

  it('a beam cut off mid charge says nothing more', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start, end], d);
    expect(said(fx).some((t) => t.startsWith('KA') || t === 'HA!!!')).toBe(false);
  });
});

describe('fx: gear 5', () => {
  const chunksOf = (d: FxDeps): GoreBit[] => {
    const out: GoreBit[] = [];
    d.gore.bits.forEach((bit) => {
      if (bit.kind === 'chunk') out.push(bit);
    });
    return out;
  };
  const start: GameEvent = { type: 'devourStart', devourId: 9, weapon: 'gear_five', attackerId: 'a', victimId: 'v', x: 0, y: 0 };
  const beat = (kind: 'drum' | 'awake' | 'stretch' | 'grab' | 'snap' | 'chomp' | 'gulp' | 'burp', n = 0): GameEvent => ({
    type: 'devourBeat',
    devourId: 9,
    attackerId: 'a',
    victimId: kind === 'snap' ? null : 'v',
    beat: kind,
    n,
    x: 100,
    y: 100,
    facing: 1,
    colorIndex: 1,
  });
  const said = (fx: ReturnType<typeof createFx>, touch = false): string[] => {
    const ctx = createRecordingContext();
    drawFxScreen(ctx, fx, touch ? { w: 844, h: 390 } : { w: 1280, h: 720 }, { touch });
    return ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  };
  const written = (fx: ReturnType<typeof createFx>): string[] => {
    const ctx = createRecordingContext();
    drawFxWorld(ctx, fx, createCamera({ x: 100, y: 100 }), { w: 640, h: 360 });
    return ctx.calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  };

  it('beats a DON! and a ring of steam on every drum, then calls its name with a flash as it awakens', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start, beat('drum', 1)], d);
    expect(said(fx)).toContain('DON!');
    expect(fx.rings).toHaveLength(1);
    expect(d.particles.count()).toBeGreaterThan(0);
    advanceFx(fx, DRUM_CALL_MS + 10, null, d);
    expect(said(fx)).not.toContain('DON!');
    applyFxEvents(fx, [beat('awake')], d);
    expect(fx.screenFlash).not.toBeNull();
    expect(said(fx)).toEqual(expect.arrayContaining(['GEAR 5!', 'SUN GOD NIKA']));
    advanceFx(fx, GEAR_CALL_MS + 10, null, d);
    expect(said(fx)).not.toContain('GEAR 5!');
  });

  it('writes CHOMP! into the world and tears a scrap off on every bite, then GULP! and DEVOURED!', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start, beat('awake'), beat('grab'), beat('chomp', 1)], d);
    expect(written(fx)).toContain('CHOMP!');
    expect(chunksOf(d).length).toBeGreaterThan(0);
    applyFxEvents(fx, [beat('gulp')], d);
    expect(written(fx)).toContain('GULP!');
    expect(said(fx)).toContain('DEVOURED!');
    // The swallow's call replaces the name at once.
    expect(said(fx)).not.toContain('GEAR 5!');
    expect(d.gore.lens.length).toBeGreaterThan(0);
    advanceFx(fx, POP_MS + 10, null, d);
    expect(written(fx)).not.toContain('CHOMP!');
    advanceFx(fx, DEVOURED_MS, null, d);
    expect(said(fx)).not.toContain('DEVOURED!');
  });

  it('burps the remains back up: the bandana, bones and an eye', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start, beat('gulp'), beat('burp')], d);
    expect(written(fx)).toContain('BURP!');
    const shapes = new Set(chunksOf(d).map((b) => b.shape));
    expect(shapes).toEqual(new Set(['bandana', 'bone', 'eye', 'flesh']));
  });

  it('keeps the calls clear of the phone buttons along the top', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start, beat('awake')], d);
    const ctx = createRecordingContext();
    drawFxScreen(ctx, fx, { w: 844, h: 390 }, { touch: true });
    const name = ctx.calls.find((c) => c.name === 'fillText' && c.args[0] === 'GEAR 5!');
    expect(Number(name?.args[2])).toBeGreaterThan(390 * 0.3);
  });

  it('says MISS when the arm grabbed at the air, and lets the show go after', () => {
    const fx = createFx();
    const d = deps();
    applyFxEvents(fx, [start, beat('awake'), beat('snap')], d);
    expect(said(fx)).not.toContain('GEAR 5!');
    applyFxEvents(fx, [{ type: 'devourEnd', devourId: 9, attackerId: 'a', victimId: null, eaten: false }], d);
    expect(said(fx)).toContain('MISS');
    advanceFx(fx, COMBO_HUD_LINGER_MS + 20, null, d);
    expect(fx.devour).toBeNull();
    expect(said(fx)).not.toContain('MISS');
  });

  it('floats the laugh off the worm once it has eaten', () => {
    const fx = createFx();
    const d = deps();
    const world = flatWorld({ width: 600, height: 300, floorY: 200, waterY: 280 });
    const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 200, y: 199 });
    addWorm(world, { id: 'meal', teamId: 'b', x: 260, y: 199 });
    fire(world, hero, WEAPONS.gear_five, { angleDeg: 0, power: 1 });
    const devour = world.devours[0]!;
    devour.stage = 'recover';
    devour.swallowed = true;
    devour.burped = true;
    devour.stageTicks = 1;
    advanceFx(fx, TICK, { world, hpOf: () => 100, maxHp: 100 }, d);
    expect(fx.pops.map((p) => p.text)).toContain('HAHAHA!');
  });
});
