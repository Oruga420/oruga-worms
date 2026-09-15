/**
 * Renderer (architecture.md section A): two stacked canvases. The world canvas is redrawn every
 * frame; the HUD canvas only when a dirty flag is set, which keeps text rasterization off the
 * 60 Hz hot path. DPR policy from game-config.dpr and judge-charly rev 2 item 31: the cap is 2,
 * the renderer steps down to 1.5 and then 1 when the rolling average frame time exceeds
 * stepDownAtMs, and steps back up only after a long continuous calm window. decideDpr is the
 * pure decision; createRenderer applies it to real or fake canvases behind CanvasLike.
 */

import { GAME_CONFIG } from '../config/game-config.ts';
import { err, ok, type Result } from '../core/result.ts';
import type { CanvasLike, Ctx2D, Size } from './canvas-types.ts';

export interface DprPolicyConfig {
  /** Never render above this DPR, whatever the device reports. */
  readonly cap: number;
  /** Descending DPR ladder; the policy walks down it under load and back up when calm. */
  readonly steps: readonly number[];
  /** Average frame work above this steps down one rung. */
  readonly stepDownAtMs: number;
  /** Average frame work below this counts as calm. */
  readonly stepUpBelowMs: number;
  /** Continuous calm required before stepping up one rung. */
  readonly calmWindowMs: number;
  /** After any change the policy holds still this long so a stale average cannot cascade. */
  readonly cooldownMs: number;
}

export const DEFAULT_DPR_POLICY: DprPolicyConfig = Object.freeze({
  cap: GAME_CONFIG.dpr.cap,
  steps: Object.freeze([2, 1.5, 1]),
  stepDownAtMs: GAME_CONFIG.dpr.stepDownAtMs,
  stepUpBelowMs: 10,
  calmWindowMs: 10_000,
  cooldownMs: 1_000,
});

export interface DprState {
  /** Index into DprPolicyConfig.steps. */
  readonly level: number;
  /** When the current calm streak started, null while not calm. */
  readonly calmSinceMs: number | null;
  /** When the level last changed. */
  readonly changedAtMs: number;
}

export const INITIAL_DPR_STATE: DprState = Object.freeze({ level: 0, calmSinceMs: null, changedAtMs: 0 });

function withLevel(level: number, nowMs: number): DprState {
  return Object.freeze({ level, calmSinceMs: null, changedAtMs: nowMs });
}

function withCalm(state: DprState, calmSinceMs: number | null): DprState {
  return state.calmSinceMs === calmSinceMs ? state : Object.freeze({ ...state, calmSinceMs });
}

/** Pure DPR ladder decision from the rolling average frame work time. */
export function decideDpr(
  state: DprState,
  averageFrameMs: number,
  nowMs: number,
  config: DprPolicyConfig = DEFAULT_DPR_POLICY,
): DprState {
  const lowest = config.steps.length - 1;
  const coolingDown = nowMs - state.changedAtMs < config.cooldownMs && state.changedAtMs !== 0;
  if (averageFrameMs > config.stepDownAtMs) {
    if (coolingDown || state.level >= lowest) return withCalm(state, null);
    return withLevel(state.level + 1, nowMs);
  }
  if (averageFrameMs >= config.stepUpBelowMs || state.level === 0) return withCalm(state, null);
  if (state.calmSinceMs === null) return withCalm(state, nowMs);
  if (coolingDown || nowMs - state.calmSinceMs < config.calmWindowMs) return state;
  return withLevel(state.level - 1, nowMs);
}

/** The DPR to render at: the device ratio, capped, then lowered to the policy rung. */
export function effectiveDpr(deviceDpr: number, state: DprState, config: DprPolicyConfig = DEFAULT_DPR_POLICY): number {
  const rung = config.steps[state.level] ?? config.steps[config.steps.length - 1] ?? 1;
  const device = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.max(0.5, Math.min(device, config.cap, rung));
}

/** Backing store size for a CSS size at a DPR, never below 1 x 1. */
export function backingSize(css: Size, dpr: number): Size {
  return Object.freeze({ w: Math.max(1, Math.floor(css.w * dpr)), h: Math.max(1, Math.floor(css.h * dpr)) });
}

export interface RendererDeps {
  readonly world: CanvasLike;
  readonly hud: CanvasLike;
  /** window.devicePixelRatio in the browser. */
  readonly devicePixelRatio: () => number;
  /** CSS size of the stage the canvases fill. */
  readonly cssSize: () => Size;
}

export interface RendererOptions {
  readonly policy?: DprPolicyConfig;
  /** Disables image smoothing so 3x sprites stay crisp through the zoom. */
  readonly pixelArt?: boolean;
}

export type DrawFn = (ctx: Ctx2D, viewport: Size) => void;

export interface RenderResult {
  readonly hudDrawn: boolean;
}

export interface Renderer {
  /** Re reads the CSS size and DPR and refits both canvases. */
  resize(): void;
  dpr(): number;
  viewport(): Size;
  dprState(): DprState;
  /** Feeds the policy; returns true when the DPR rung changed (and the canvases were refit). */
  updateDpr(averageFrameMs: number, nowMs: number): boolean;
  markHudDirty(): void;
  /** Draws the world every call and the HUD only when dirty. */
  render(drawWorld: DrawFn, drawHud: DrawFn): RenderResult;
}

export interface RendererError {
  readonly code: 'no_context';
  readonly canvas: 'world' | 'hud';
  readonly message: string;
}

interface Layer {
  readonly canvas: CanvasLike;
  readonly ctx: Ctx2D;
}

function acquire(canvas: CanvasLike, name: 'world' | 'hud'): Result<Layer, RendererError> {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return err(Object.freeze({ code: 'no_context' as const, canvas: name, message: `canvas #${name} has no 2d context` }));
  }
  return ok({ canvas, ctx });
}

function fitLayer(layer: Layer, css: Size, dpr: number, pixelArt: boolean): void {
  const size = backingSize(css, dpr);
  if (layer.canvas.width !== size.w || layer.canvas.height !== size.h) {
    layer.canvas.width = size.w;
    layer.canvas.height = size.h;
  }
  // Setting width or height resets the context, so the transform is re applied every fit.
  layer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layer.ctx.imageSmoothingEnabled = !pixelArt;
}

export function createRenderer(deps: RendererDeps, options: RendererOptions = {}): Result<Renderer, RendererError> {
  const world = acquire(deps.world, 'world');
  if (!world.ok) return world;
  const hud = acquire(deps.hud, 'hud');
  if (!hud.ok) return hud;
  const policy = options.policy ?? DEFAULT_DPR_POLICY;
  const pixelArt = options.pixelArt ?? true;

  // Renderer state, mutated on resize and per frame (hot path).
  let state: DprState = INITIAL_DPR_STATE;
  let css: Size = deps.cssSize();
  let dpr = effectiveDpr(deps.devicePixelRatio(), state, policy);
  let hudDirty = true;

  const fit = (): void => {
    css = deps.cssSize();
    dpr = effectiveDpr(deps.devicePixelRatio(), state, policy);
    fitLayer(world.value, css, dpr, pixelArt);
    fitLayer(hud.value, css, dpr, pixelArt);
    hudDirty = true;
  };
  fit();

  return ok({
    resize: fit,
    dpr: () => dpr,
    viewport: () => css,
    dprState: () => state,
    updateDpr: (averageFrameMs, nowMs) => {
      const next = decideDpr(state, averageFrameMs, nowMs, policy);
      const changed = next.level !== state.level;
      state = next;
      if (changed) fit();
      return changed;
    },
    markHudDirty: () => {
      hudDirty = true;
    },
    render: (drawWorld, drawHud) => {
      drawWorld(world.value.ctx, css);
      if (!hudDirty) return Object.freeze({ hudDrawn: false });
      hudDirty = false;
      hud.value.ctx.clearRect(0, 0, css.w, css.h);
      drawHud(hud.value.ctx, css);
      return Object.freeze({ hudDrawn: true });
    },
  });
}
