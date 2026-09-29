import { describe, expect, it } from 'vitest';
import { INITIAL_AIM } from '@/game/aim.ts';
import { drawGame, fightRoles, holdPose, poseFor, woundLevel, type Scratch, type WormVisual } from '@/game/render.ts';
import type { WormAnim } from '@/game/fx.ts';
import { quickGame } from '@/game/setup.ts';
import { createCamera } from '@/engine/camera.ts';
import type { AtlasFrame } from '@/engine/atlas-schema.ts';
import type { Atlas } from '@/engine/atlas.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';
import type { MatchState } from '@/match/state.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { BeamBody, ComboBody } from '@/sim/types.ts';
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
