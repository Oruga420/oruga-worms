import { describe, expect, it } from 'vitest';
import type { CanvasLike, Ctx2D, Size } from '@/engine/canvas-types.ts';
import {
  DEFAULT_DPR_POLICY,
  INITIAL_DPR_STATE,
  backingSize,
  createRenderer,
  decideDpr,
  effectiveDpr,
  type DprState,
} from '@/engine/renderer.ts';

const policy = DEFAULT_DPR_POLICY;

function stepDown(state: DprState, nowMs: number): DprState {
  return decideDpr(state, policy.stepDownAtMs + 5, nowMs, policy);
}

describe('renderer: DPR policy', () => {
  it('starts at the cap and steps down when the average frame exceeds stepDownAtMs', () => {
    expect(policy.cap).toBe(2);
    expect(policy.stepDownAtMs).toBe(14);
    expect(effectiveDpr(3, INITIAL_DPR_STATE)).toBe(2);
    const next = stepDown(INITIAL_DPR_STATE, 5_000);
    expect(next.level).toBe(1);
    expect(effectiveDpr(3, next)).toBe(1.5);
  });

  it('holds during the cooldown so a stale average cannot cascade to the floor', () => {
    const one = stepDown(INITIAL_DPR_STATE, 5_000);
    const tooSoon = stepDown(one, 5_000 + policy.cooldownMs - 1);
    expect(tooSoon.level).toBe(1);
    const later = stepDown(one, 5_000 + policy.cooldownMs);
    expect(later.level).toBe(2);
    expect(effectiveDpr(3, later)).toBe(1);
  });

  it('never steps below the last rung', () => {
    let state = INITIAL_DPR_STATE;
    for (let i = 1; i <= 6; i += 1) state = stepDown(state, i * 10_000);
    expect(state.level).toBe(policy.steps.length - 1);
  });

  it('steps back up only after a continuous calm window', () => {
    const low = stepDown(INITIAL_DPR_STATE, 1_000);
    const calmStart = decideDpr(low, 5, 3_000, policy);
    expect(calmStart.level).toBe(1);
    expect(calmStart.calmSinceMs).toBe(3_000);
    const stillCalm = decideDpr(calmStart, 5, 3_000 + policy.calmWindowMs - 1, policy);
    expect(stillCalm.level).toBe(1);
    const recovered = decideDpr(stillCalm, 5, 3_000 + policy.calmWindowMs, policy);
    expect(recovered.level).toBe(0);
    expect(recovered.calmSinceMs).toBeNull();
  });

  it('resets the calm streak when a frame lands between the thresholds', () => {
    const low = stepDown(INITIAL_DPR_STATE, 1_000);
    const calm = decideDpr(low, 5, 3_000, policy);
    const middling = decideDpr(calm, 12, 6_000, policy);
    expect(middling.calmSinceMs).toBeNull();
    const calmAgain = decideDpr(middling, 5, 7_000, policy);
    expect(calmAgain.calmSinceMs).toBe(7_000);
  });

  it('does not track calm at the top rung', () => {
    const state = decideDpr(INITIAL_DPR_STATE, 5, 1_000, policy);
    expect(state).toBe(INITIAL_DPR_STATE);
  });

  it('caps the device ratio and tolerates bad values', () => {
    expect(effectiveDpr(1, INITIAL_DPR_STATE)).toBe(1);
    expect(effectiveDpr(1.25, INITIAL_DPR_STATE)).toBe(1.25);
    expect(effectiveDpr(Number.NaN, INITIAL_DPR_STATE)).toBe(1);
    expect(effectiveDpr(0, INITIAL_DPR_STATE)).toBe(1);
  });

  it('computes the backing store size, never below 1 x 1', () => {
    expect(backingSize({ w: 1280, h: 720 }, 1.5)).toEqual({ w: 1920, h: 1080 });
    expect(backingSize({ w: 0, h: 0 }, 2)).toEqual({ w: 1, h: 1 });
    expect(backingSize({ w: 333, h: 111 }, 2)).toEqual({ w: 666, h: 222 });
  });
});

interface FakeCanvas extends CanvasLike {
  readonly calls: string[];
  readonly ctx: Ctx2D | null;
}

function fakeCanvas(withContext = true): FakeCanvas {
  const calls: string[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}(${args.map(String).join(',')})`);
  };
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: record('save'),
    restore: record('restore'),
    setTransform: record('setTransform'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
    createLinearGradient: () => ({ addColorStop: record('addColorStop') }) as unknown as CanvasGradient,
  } as Ctx2D;
  return {
    width: 300,
    height: 150,
    calls,
    ctx: withContext ? ctx : null,
    getContext: () => (withContext ? ctx : null),
  };
}

function setup(css: Size = { w: 800, h: 600 }, deviceDpr = 2) {
  const world = fakeCanvas();
  const hud = fakeCanvas();
  let size = css;
  let ratio = deviceDpr;
  const result = createRenderer({
    world,
    hud,
    devicePixelRatio: () => ratio,
    cssSize: () => size,
  });
  if (!result.ok) throw new Error(result.error.message);
  return {
    renderer: result.value,
    world,
    hud,
    setCss: (next: Size) => {
      size = next;
    },
    setRatio: (next: number) => {
      ratio = next;
    },
  };
}

describe('renderer: canvases', () => {
  it('fails with a Result when a canvas has no 2d context', () => {
    const result = createRenderer({
      world: fakeCanvas(false),
      hud: fakeCanvas(),
      devicePixelRatio: () => 1,
      cssSize: () => ({ w: 10, h: 10 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'no_context', canvas: 'world' });
  });

  it('fits both canvases to the CSS size times the capped DPR', () => {
    const { renderer, world, hud } = setup({ w: 800, h: 600 }, 3);
    expect(renderer.dpr()).toBe(2);
    expect(world.width).toBe(1600);
    expect(world.height).toBe(1200);
    expect(hud.width).toBe(1600);
    expect(world.calls).toContain('setTransform(2,0,0,2,0,0)');
    expect(world.ctx?.imageSmoothingEnabled).toBe(false);
  });

  it('redraws the world every frame and the HUD only when dirty', () => {
    const { renderer } = setup();
    let worldDraws = 0;
    let hudDraws = 0;
    const drawWorld = () => {
      worldDraws += 1;
    };
    const drawHud = () => {
      hudDraws += 1;
    };
    expect(renderer.render(drawWorld, drawHud).hudDrawn).toBe(true);
    expect(renderer.render(drawWorld, drawHud).hudDrawn).toBe(false);
    expect(renderer.render(drawWorld, drawHud).hudDrawn).toBe(false);
    renderer.markHudDirty();
    expect(renderer.render(drawWorld, drawHud).hudDrawn).toBe(true);
    expect(worldDraws).toBe(4);
    expect(hudDraws).toBe(2);
  });

  it('clears the HUD before redrawing it and passes the CSS viewport', () => {
    const { renderer, hud } = setup({ w: 640, h: 360 });
    let seen: Size | null = null;
    renderer.render(
      () => {},
      (_ctx, viewport) => {
        seen = viewport;
      },
    );
    expect(seen).toEqual({ w: 640, h: 360 });
    expect(hud.calls).toContain('clearRect(0,0,640,360)');
  });

  it('resize refits and marks the HUD dirty', () => {
    const { renderer, world, setCss } = setup();
    renderer.render(() => {}, () => {});
    setCss({ w: 1000, h: 500 });
    renderer.resize();
    expect(world.width).toBe(2000);
    expect(renderer.viewport()).toEqual({ w: 1000, h: 500 });
    expect(renderer.render(() => {}, () => {}).hudDrawn).toBe(true);
  });

  it('updateDpr steps down under load and refits', () => {
    const { renderer, world } = setup();
    expect(renderer.updateDpr(5, 1_000)).toBe(false);
    expect(renderer.updateDpr(20, 2_000)).toBe(true);
    expect(renderer.dpr()).toBe(1.5);
    expect(world.width).toBe(1200);
    expect(renderer.dprState().level).toBe(1);
  });
});
