import { describe, expect, it } from 'vitest';
import { drawGame } from '@/game/render.ts';
import { INITIAL_AIM } from '@/game/aim.ts';
import { quickGame } from '@/game/setup.ts';
import { createCamera } from '@/engine/camera.ts';
import type { Ctx2D } from '@/engine/canvas-types.ts';
import type { MatchState } from '@/match/state.ts';
import { spawnCrate } from '@/sim/crate.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { createFakeFactory } from '../terrain/fakes.ts';

/** A Ctx2D that records how many times each drawing call was made; geometry is not asserted. */
function recordingCtx(): { ctx: Ctx2D; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const bump = (key: string): void => {
    calls[key] = (calls[key] ?? 0) + 1;
  };
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => bump('save'),
    restore: () => bump('restore'),
    setTransform: () => bump('setTransform'),
    translate: () => bump('translate'),
    rotate: () => bump('rotate'),
    scale: () => bump('scale'),
    clearRect: () => bump('clearRect'),
    fillRect: () => bump('fillRect'),
    strokeRect: () => bump('strokeRect'),
    beginPath: () => bump('beginPath'),
    closePath: () => bump('closePath'),
    moveTo: () => bump('moveTo'),
    lineTo: () => bump('lineTo'),
    arc: () => bump('arc'),
    fill: () => bump('fill'),
    stroke: () => bump('stroke'),
    fillText: () => bump('fillText'),
    drawImage: () => bump('drawImage'),
    createLinearGradient: () => {
      bump('createLinearGradient');
      return { addColorStop: () => bump('addColorStop') };
    },
  } as unknown as Ctx2D;
  return { ctx, calls };
}

const VIEWPORT = { w: 1200, h: 500 };

function world() {
  const built = quickGame(3, createFakeFactory().factory, VIEWPORT);
  if (!built.ok) throw new Error(`setup failed: ${built.error.message}`);
  return built.value;
}

function camera() {
  return createCamera({ x: VIEWPORT.w / 2, y: VIEWPORT.h / 2, bounds: VIEWPORT });
}

describe('drawGame', () => {
  it('blits the terrain and draws the worms and their tags without throwing', () => {
    const game = world();
    const { ctx, calls } = recordingCtx();
    drawGame(ctx, VIEWPORT, camera(), { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 1000 });
    expect(calls.drawImage ?? 0).toBeGreaterThan(0); // terrain tiles
    expect(calls.fill ?? 0).toBeGreaterThan(0); // worm bodies and features
    expect(calls.arc ?? 0).toBeGreaterThan(0); // ellipses and eyes
    expect(calls.fillText ?? 0).toBeGreaterThan(0); // name and health tags
  });

  it('draws the aim arm when a worm is active', () => {
    const game = world();
    const active: MatchState = { ...game.state, phase: 'Active' };
    const { ctx, calls } = recordingCtx();
    drawGame(ctx, VIEWPORT, camera(), { state: active, world: game.world, aim: { angleDeg: 45, charging: true, power: 0.6 }, timeMs: 500 });
    expect(calls.stroke ?? 0).toBeGreaterThan(0);
  });

  it('does not throw when no worm is alive', () => {
    const game = world();
    for (const body of game.world.worms) body.alive = false;
    const { ctx } = recordingCtx();
    expect(() => drawGame(ctx, VIEWPORT, camera(), { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0 })).not.toThrow();
  });

  it('draws a live sheep, which used to run its whole life invisible', () => {
    const game = world();
    const model = { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0 };
    const before = recordingCtx();
    drawGame(before.ctx, VIEWPORT, camera(), model);
    const shooter = game.world.worms.find((b) => b.alive);
    if (shooter === undefined) throw new Error('no worm');
    fire(game.world, shooter, WEAPONS.sheep, { angleDeg: 45, power: 1 });
    expect(game.world.sheep.filter((s) => s.alive)).toHaveLength(1);
    const after = recordingCtx();
    drawGame(after.ctx, VIEWPORT, camera(), model);
    // Without the weapon atlas the sheep is drawn as primitives: strictly more arcs than before.
    expect(after.calls.arc ?? 0).toBeGreaterThan(before.calls.arc ?? 0);
  });

  it('draws a falling crate with its parachute, so a drop can be seen', () => {
    const game = world();
    const model = { state: game.state, world: game.world, aim: INITIAL_AIM, timeMs: 0 };
    const before = recordingCtx();
    drawGame(before.ctx, VIEWPORT, camera(), model);
    spawnCrate(game.world, 'weapon', 600);
    const after = recordingCtx();
    drawGame(after.ctx, VIEWPORT, camera(), model);
    // A boxed body plus a canopy arc and its lines: more rectangles and arcs than the bare scene.
    expect((after.calls.fillRect ?? 0) + (after.calls.arc ?? 0)).toBeGreaterThan((before.calls.fillRect ?? 0) + (before.calls.arc ?? 0));
  });
});
