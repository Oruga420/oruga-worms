import { describe, expect, it } from 'vitest';
import { INITIAL_AIM } from '@/game/aim.ts';
import { devourRoles, drawGame, fightRoles, holdPose, poseFor, woundLevel, type Scratch, type WormVisual } from '@/game/render.ts';
import type { WormAnim } from '@/game/fx.ts';
import { quickGame } from '@/game/setup.ts';
import { createCamera } from '@/engine/camera.ts';
import type { AtlasFrame } from '@/engine/atlas-schema.ts';
import type { Atlas } from '@/engine/atlas.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';
import type { MatchState } from '@/match/state.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { BeamBody, ComboBody, DevourBody } from '@/sim/types.ts';
import type { Ctx2D } from '@/engine/canvas-types.ts';
import { drumTicks } from '@/sim/devour.ts';
import { addWorm } from '@/sim/world.ts';
import { createFakeFactory } from '../terrain/fakes.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const WORM: WormVisual = { x: 100, y: 100, vx: 0, vy: 0, facing: 1, color: '#f00', name: 'W', hp: 100, active: false, motion: 'idle', alive: true, colorIndex: 0 };

function anim(overrides: Partial<WormAnim> = {}): WormAnim {
  return { hurtMs: Infinity, hurtAmount: 0, firedMs: Infinity, firedWeapon: null, swingMs: Infinity, landedMs: Infinity, landSpeed: 0, switchedMs: Infinity, tumble: 0, ...overrides };
}

function combo(stage: ComboBody['stage'], stageTicks: number, hitsLanded = 0): ComboBody {
  return {
    id: 1,
    weaponId: 'ryuko_ranbu',
    attackerId: 'a',
    ownerTeamId: 't',
    victimId: 'v',
    spec: WEAPONS.ryuko_ranbu.combo!,
    stage,
    stageTicks,
    fromX: 0,
    fromY: 0,
    toX: 10,
    toY: 0,
    restX: 10,
    restY: 0,
    holdX: 24,
    holdY: 0,
    facing: 1,
    hitsLanded,
    alive: true,
  };
}

describe('poses', () => {
  it('stands, walks and breathes with no cues at all', () => {
    expect(poseFor({ worm: WORM, timeMs: 0 }).frame).toMatch(/^idle_/);
    expect(poseFor({ worm: { ...WORM, vx: 60, motion: 'walking' }, timeMs: 0 }).frame).toMatch(/^walk_/);
  });

  it('flinches, flashes white then red, when hurt', () => {
    const fresh = poseFor({ worm: WORM, anim: anim({ hurtMs: 10 }), timeMs: 0 });
    expect(fresh.frame).toBe('hurt');
    expect(fresh.tint).toBe('#ffffff');
    const later = poseFor({ worm: WORM, anim: anim({ hurtMs: 200 }), timeMs: 0 });
    expect(later.tint).toBe('#ff2020');
    expect(poseFor({ worm: WORM, anim: anim({ hurtMs: 1000 }), timeMs: 0 }).frame).not.toBe('hurt');
  });

  it('tumbles when thrown and spins a full turn over a backflip', () => {
    const thrown = { ...WORM, motion: 'flying' as const, vx: 300, vy: -200 };
    const a = poseFor({ worm: thrown, anim: anim({ tumble: 0.4 }), timeMs: 0 });
    // The turn fx integrated, never the page clock: the same tumble at any time reads the same.
    const b = poseFor({ worm: thrown, anim: anim({ tumble: 0.4 }), timeMs: 120_000 });
    expect(a.frame).toBe('knocked');
    expect(a.rotation).toBe(0.4);
    expect(b.rotation).toBe(0.4);
    const takeoff = poseFor({ worm: { ...WORM, motion: 'jumping', vx: -45, vy: -260 }, timeMs: 0 });
    const top = poseFor({ worm: { ...WORM, motion: 'jumping', vx: -45, vy: 0 }, timeMs: 0 });
    expect(takeoff.frame).toBe('backflip');
    expect(Math.abs(top.rotation)).toBeCloseTo(Math.PI, 6);
  });

  it('squashes on a landing, kicks back on a shot, and holds the weapon it aims', () => {
    const landing = poseFor({ worm: WORM, anim: anim({ landedMs: 20, landSpeed: 500 }), timeMs: 0 });
    expect(landing.frame).toBe('jump_land');
    expect(landing.stretchX).toBeGreaterThan(1);
    expect(landing.stretchY).toBeLessThan(1);
    const recoil = poseFor({ worm: WORM, anim: anim({ firedMs: 30, firedWeapon: 'shotgun' }), timeMs: 0 });
    expect(recoil.frame).toBe('fire_recoil');
    expect(poseFor({ worm: WORM, anim: anim({ firedMs: 30, firedWeapon: 'grenade' }), timeMs: 0 }).frame).toBe('hold_throw');
    expect(poseFor({ worm: WORM, aiming: 'bazooka', timeMs: 0 }).frame).toBe('hold_launcher');
  });

  it('maps every weapon family to a hold pose', () => {
    expect(holdPose('bazooka')).toBe('hold_launcher');
    expect(holdPose('uzi')).toBe('hold_gun');
    expect(holdPose('longbow')).toBe('hold_gun');
    expect(holdPose('grenade')).toBe('hold_throw');
    expect(holdPose('dynamite')).toBe('hold_throw');
    expect(holdPose('baseball_bat')).toBe('hold_melee');
    expect(holdPose('ryuko_ranbu')).toBe('hold_melee');
    expect(holdPose('teleport')).toBe('idle_a');
  });

  it('celebrates a win', () => {
    const frames = new Set([0, 170, 340, 510].map((t) => poseFor({ worm: WORM, victory: true, timeMs: t }).frame));
    expect(frames.has('victory')).toBe(true);
  });

  it('fights: a power pose in the freeze, a new pose on every blow, the victim reeling', () => {
    const roles = fightRoles([combo('startup', 5)]);
    expect(roles.get('a')?.role).toBe('attacker');
    expect(roles.get('v')?.role).toBe('victim');
    expect(poseFor({ worm: WORM, fight: roles.get('a'), timeMs: 0 }).frame).toBe('taunt');
    const blowA = poseFor({ worm: WORM, fight: { role: 'attacker', combo: combo('flurry', 1, 1) }, timeMs: 0 });
    const blowB = poseFor({ worm: WORM, fight: { role: 'attacker', combo: combo('flurry', 6, 2) }, timeMs: 0 });
    expect(blowA.frame).not.toBe(blowB.frame);
    expect(blowA.offsetX).toBeGreaterThan(0);
    const reeling = poseFor({ worm: WORM, fight: { role: 'victim', combo: combo('flurry', 1, 1) }, timeMs: 0 });
    expect(reeling.tintAlpha).toBeGreaterThan(0);
    expect(reeling.rotation).not.toBe(0);
    // Past the finisher the victim is thrown: no longer held, no longer in the fight.
    expect(fightRoles([combo('recover', 3)]).has('v')).toBe(false);
  });

  it('wears more blood the less health it has', () => {
    expect(woundLevel(100)).toBe(0);
    expect(woundLevel(50)).toBeGreaterThan(0);
    expect(woundLevel(5)).toBeGreaterThan(woundLevel(50));
    expect(woundLevel(0)).toBe(1);
  });
});

/** A one frame fake atlas: every frame id resolves to the same 96 px cell. */
function fakeSprites(): { atlas: Atlas; image: ImageSource } {
  const frame: AtlasFrame = { frame: { x: 0, y: 0, w: 96, h: 96 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 96, h: 96 }, sourceSize: { w: 96, h: 96 } };
  const atlas = { frame: () => frame, pivotOf: () => ({ x: 0.5, y: 0.875 }), animation: () => undefined } as unknown as Atlas;
  return { atlas, image: {} as ImageSource };
}

function scene() {
  const built = quickGame(3, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!built.ok) throw new Error(built.error.message);
  return built.value;
}

describe('drawGame: animation layers', () => {
  it('composites wounds and hit flashes on the scratch surface for a hurt worm', () => {
    const game = scene();
    const hurt: MatchState = { ...game.state, teams: game.state.teams.map((team) => ({ ...team, worms: team.worms.map((worm) => ({ ...worm, hp: 20 })) })) };
    const sets = new Map([[0, fakeSprites()], [1, fakeSprites()]]);
    const scratchCtx = createRecordingContext();
    const scratch: Scratch = { canvas: {} as ImageSource, ctx: scratchCtx, size: 128 };
    const ctx = createRecordingContext();
    drawGame(ctx, { w: 1200, h: 500 }, createCamera({ x: 600, y: 250 }), { state: hurt, world: game.world, aim: INITIAL_AIM, timeMs: 0, sprites: sets, scratch, anim: () => anim({ hurtMs: 30 }) });
    const ops = scratchCtx.calls.map((c) => c.name);
    expect(ops).toContain('drawImage');
    expect(ops).toContain('arc');
    expect(ops).toContain('fillRect');
  });

  it('counts a grenade fuse down above it', () => {
    const game = scene();
    const model = { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0 };
    const shooter = game.world.worms[0];
    if (shooter === undefined) throw new Error('no worm');
    fire(game.world, shooter, WEAPONS.grenade, { angleDeg: 45, power: 0.5, fuseMs: 3000 });
    const ctx = createRecordingContext();
    drawGame(ctx, { w: 1200, h: 500 }, createCamera({ x: 600, y: 250 }), model);
    expect(ctx.calls.some((c) => c.name === 'fillText' && c.args[0] === '3')).toBe(true);
  });

  it('whites the screen out and keeps the fighters of a live super move on it', () => {
    const game = scene();
    const attacker = game.world.worms[0];
    const victim = game.world.worms.find((w) => w.teamId !== attacker?.teamId);
    if (attacker === undefined || victim === undefined) throw new Error('bodies missing');
    victim.x = attacker.x + 30;
    victim.y = attacker.y;
    fire(game.world, attacker, WEAPONS.ryuko_ranbu, { angleDeg: 0, power: 1 });
    const live = game.world.combos[0];
    if (live === undefined) throw new Error('no combo');
    live.stage = 'flurry';
    live.stageTicks = 1;
    const plain = createRecordingContext();
    drawGame(plain, { w: 1200, h: 500 }, createCamera({ x: 600, y: 250 }), { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0 });
    const white = createRecordingContext();
    drawGame(white, { w: 1200, h: 500 }, createCamera({ x: 600, y: 250 }), { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0, whiteout: 1 });
    expect(white.calls.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(plain.calls.filter((c) => c.name === 'fillRect').length);
    // Both fighters drawn twice: once in colour, once as silhouettes on the white.
    expect(white.calls.filter((c) => c.name === 'fill').length).toBeGreaterThan(plain.calls.filter((c) => c.name === 'fill').length);
  });
});

describe('kamehameha', () => {
  function beamBody(stage: BeamBody['stage'], stageTicks: number, length = 0): BeamBody {
    return { id: 9, weaponId: 'kamehameha', attackerId: 'a', ownerTeamId: 't', spec: WEAPONS.kamehameha.beam!, stage, stageTicks, x0: 106, y0: 90, dx: 1, dy: 0, holdX: 100, holdY: 100, facing: 1, length, maxLength: 640, carved: 0, hit: [], alive: true };
  }

  it('draws back while it charges and recoils once the beam is out', () => {
    expect(poseFor({ worm: WORM, beam: beamBody('charge', 40), timeMs: 0 }).frame).toBe('hold_throw');
    const firing = poseFor({ worm: WORM, beam: beamBody('fire', 3, 200), timeMs: 0 });
    expect(firing.frame).toBe('fire_recoil');
    // Thrust back against the way it faces.
    expect(firing.offsetX).toBeLessThan(0);
  });

  it('draws the ball of ki while charging and the beam once it is out', () => {
    const game = scene();
    const shooter = game.world.worms[0];
    if (shooter === undefined) throw new Error('no worm');
    fire(game.world, shooter, WEAPONS.kamehameha, { angleDeg: 0, power: 1 });
    const live = game.world.beams[0];
    if (live === undefined) throw new Error('no beam');
    const draw = (): ReturnType<typeof createRecordingContext> => {
      const ctx = createRecordingContext();
      drawGame(ctx, { w: 1200, h: 500 }, createCamera({ x: 600, y: 250 }), { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0, dim: 0.4, aura: 1 });
      return ctx;
    };
    const charging = draw();
    expect(charging.calls.some((c) => c.name === 'arc')).toBe(true);
    live.stage = 'fire';
    live.length = 300;
    const firing = draw();
    // The beam's bands: more filled paths than while it only charged.
    expect(firing.calls.filter((c) => c.name === 'fill').length).toBeGreaterThan(charging.calls.filter((c) => c.name === 'fill').length);
  });
});

describe('gear 5', () => {
  const SPEC = WEAPONS.gear_five.devour!;
  const ticks = (ms: number): number => Math.max(1, Math.round((ms * 60) / 1000));
  function devourBody(stage: DevourBody['stage'], stageTicks: number, extra: Partial<DevourBody> = {}): DevourBody {
    return { id: 7, weaponId: 'gear_five', attackerId: 'a', ownerTeamId: 't', victimId: 'v', spec: SPEC, stage, stageTicks, holdX: 100, holdY: 100, facing: 1, shoulderX: 104, shoulderY: 91, reachX: 200, reachY: 92, grabX: 200, grabY: 100, mouthX: 111, mouthY: 93, chomps: 0, swallowed: false, burped: false, alive: true, ...extra };
  }
  const eater = (d: DevourBody) => ({ role: 'eater' as const, devour: d });
  const prey = (d: DevourBody) => ({ role: 'prey' as const, devour: d });

  /** Every colour the drawing filled with, in order, from a recording context that notes fillStyle on each fill. */
  function fills(draw: (ctx: Ctx2D) => void): string[] {
    const ctx = createRecordingContext();
    const out: string[] = [];
    const spy = new Proxy(ctx, {
      get(target, name) {
        if (name === 'fill') return () => out.push(String(target.fillStyle));
        const value: unknown = Reflect.get(target, name);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
      set(target, name, value) {
        return Reflect.set(target, name, value);
      },
    }) as Ctx2D;
    draw(spy);
    return out;
  }

  it('knows who is eating whom, and lets the meal go once it is swallowed', () => {
    const live = devourBody('chew', 3);
    expect(devourRoles([live]).get('a')?.role).toBe('eater');
    expect(devourRoles([live]).get('v')?.role).toBe('prey');
    expect(devourRoles([{ ...live, swallowed: true }]).has('v')).toBe(false);
    expect(devourRoles([{ ...live, alive: false }]).size).toBe(0);
  });

  it('turns the eater white and bounces it on the drums, then throws its arm out', () => {
    const early = poseFor({ worm: WORM, devour: eater(devourBody('awaken', 1)), timeMs: 0 });
    const late = poseFor({ worm: WORM, devour: eater(devourBody('awaken', ticks(SPEC.awakenMs) - 1)), timeMs: 0 });
    expect(late.tint).toBe('#ffffff');
    expect(late.tintAlpha).toBeGreaterThan(early.tintAlpha);
    const onDrum = poseFor({ worm: WORM, devour: eater(devourBody('awaken', drumTicks(SPEC)[0]!)), timeMs: 0 });
    expect(onDrum.stretchY).toBeLessThan(0.85);
    const stretching = poseFor({ worm: WORM, devour: eater(devourBody('stretch', 3)), timeMs: 0 });
    expect(stretching.frame).toBe('hold_melee');
    expect(stretching.tintAlpha).toBeGreaterThan(0.9);
  });

  it('makes the meal tremble, tumble in shrinking, and lie across the mouth flashing red on a bite', () => {
    expect(poseFor({ worm: WORM, devour: prey(devourBody('awaken', 10)), timeMs: 0 }).frame).toBe('hurt');
    const reeled = poseFor({ worm: WORM, devour: prey(devourBody('reel', ticks(SPEC.reelMs) - 2)), timeMs: 0 });
    expect(reeled.frame).toBe('knocked');
    expect(reeled.rotation).not.toBe(0);
    expect(reeled.stretchY).toBeLessThan(0.8);
    const bitten = poseFor({ worm: { ...WORM, x: 111, y: 93 }, devour: prey(devourBody('chew', 1)), timeMs: 0 });
    expect(bitten.tint).toBe('#ff1a1a');
    expect(bitten.tintAlpha).toBeGreaterThan(0.5);
    expect(bitten.stretchY).toBeLessThan(0.75);
    // Drawn in the mouth, ahead of the eater's face and up at head height.
    expect(111 + bitten.offsetX).toBeGreaterThan(100);
    expect(93 + bitten.offsetY).toBeLessThan(100);
  });

  it('draws the halo, then the arm, then the giant head with the hat as the meal goes on', () => {
    const game = scene();
    const eaterBody = game.world.worms[0];
    if (eaterBody === undefined) throw new Error('no worm');
    const victim = game.world.worms.find((w) => w.teamId !== eaterBody.teamId);
    if (victim === undefined) throw new Error('no enemy');
    victim.x = eaterBody.x + 60;
    victim.y = eaterBody.y;
    const mask = game.world.terrain.mask;
    for (let x = Math.round(eaterBody.x) - 2; x <= Math.round(victim.x) + 2; x += 1) for (let y = Math.round(eaterBody.y) - 30; y < Math.round(eaterBody.y) - 1; y += 1) mask.data[y * mask.width + x] = 0;
    fire(game.world, eaterBody, WEAPONS.gear_five, { angleDeg: 0, power: 1 });
    const live = game.world.devours[0];
    if (live === undefined || live.victimId !== victim.id) throw new Error('no devour on the victim');
    const draw = (): string[] => fills((ctx) => drawGame(ctx, { w: 1200, h: 500 }, createCamera({ x: eaterBody.x, y: eaterBody.y }), { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0, dim: 0.3 }));
    live.stageTicks = ticks(SPEC.awakenMs) - 5;
    const awakening = draw();
    expect(awakening).toContain('#fff8d6');
    expect(awakening).not.toContain('#4a0010');
    live.stage = 'stretch';
    live.stageTicks = 10;
    const stretching = draw();
    expect(stretching.filter((c) => c === '#fbfbff').length).toBeGreaterThan(awakening.filter((c) => c === '#fbfbff').length + 10);
    expect(stretching).toContain('#f2c14e');
    live.stage = 'chew';
    live.stageTicks = 8;
    const chewing = draw();
    expect(chewing).toContain('#4a0010');
    expect(chewing).toContain('#f2c14e');
    expect(chewing).toContain('#e0607a');
  });

  it('shows the lock on the nearest enemy in reach while Gear 5 is picked', () => {
    const game = scene();
    const active = game.world.worms[0];
    if (active === undefined) throw new Error('no worm');
    addWorm(game.world, { id: 'near', teamId: 'nobody', x: active.x + 30, y: active.y });
    const ctx = createRecordingContext();
    const state: MatchState = { ...game.state, phase: 'Active' };
    drawGame(ctx, { w: 1200, h: 500 }, createCamera({ x: active.x, y: active.y }), { state, world: game.world, aim: INITIAL_AIM, timeMs: 0, weapon: 'gear_five', aimAssist: true });
    // The dashed reach circle is drawn in arcs of the lock range.
    const reach = WEAPONS.gear_five.devour!.rangePx;
    expect(ctx.calls.some((c) => c.name === 'arc' && Math.abs(Number(c.args[2]) - reach * 2.5) < 1)).toBe(true);
  });
});
