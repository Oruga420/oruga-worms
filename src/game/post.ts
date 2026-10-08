/**
 * What the glow pass (engine/glow.ts) draws beyond the scene: the shockwaves of the explosions and
 * the heavy blows, the colour split after a hit, and how strongly the bright parts bloom, which the
 * supers' cinematic raises. Pure: game events in, GlowUniforms out, so the look is unit tested
 * without a GPU. The waves live in world px and are projected through the camera every frame, so
 * they stay on their craters while the camera moves.
 */

import { worldToScreen, type Camera } from '../engine/camera.ts';
import type { Size } from '../engine/canvas-types.ts';
import { MAX_WAVES, type GlowUniforms, type GlowWave } from '../engine/glow.ts';
import type { Cinematic } from './cinematic.ts';
import type { GameEvent } from './controller.ts';

export interface Shockwave {
  /** World px. */
  readonly x: number;
  readonly y: number;
  readonly bornAt: number;
  readonly ms: number;
  /** How far the ring travels, world px. */
  readonly radius: number;
  /** Displacement at the crest when it starts, screen px at zoom 1. */
  readonly strength: number;
}

export interface ColourSplit {
  readonly at: number;
  readonly ms: number;
  /** Split at the screen's edge when it starts, screen px at zoom 1. */
  readonly px: number;
}

export interface PostState {
  readonly waves: Shockwave[];
  split: ColourSplit | null;
}

/** Bloom added over a plain scene; the cinematic raises it. */
export const BLOOM_BASE = 0.5;
/**
 * Luminance under which nothing blooms. The maps are pastel (a hazy horizon, pale sand, the pink
 * house), so only what is close to white shines: beams, flashes, the sun, the calls, the clouds.
 */
export const BLOOM_THRESHOLD = 0.88;
export const VIGNETTE = 0.28;
/** Waves kept in the list; the shader takes the newest MAX_WAVES. */
const WAVE_CAP = 24;

/** Reach of an explosion's wave over its blast radius, per tier. */
const TIER_REACH: Readonly<Record<'small' | 'medium' | 'big' | 'holy', number>> = Object.freeze({ small: 1.6, medium: 2.2, big: 2.8, holy: 3.4 });

export function createPost(): PostState {
  return { waves: [], split: null };
}

export function resetPost(post: PostState): void {
  post.waves.length = 0;
  post.split = null;
}

/**
 * How the glow pass runs: 'auto' (on, and dropped if the device cannot keep the frame budget with
 * it), 'on' (?gl=1: kept whatever the frame costs, for a test or a look), or 'off' (?gl=0).
 */
export type GlowMode = 'off' | 'auto' | 'on';

export function glowModeFromSearch(search: string): GlowMode {
  const value = new URLSearchParams(search).get('gl')?.trim().toLowerCase() ?? '';
  if (['0', 'off', 'false', 'no'].includes(value)) return 'off';
  if (['1', 'on', 'force', 'always'].includes(value)) return 'on';
  return 'auto';
}

/** The glow is on unless ?gl=0 (or off, false, no) asks for the plain canvas. */
export function glowEnabledFromSearch(search: string): boolean {
  return glowModeFromSearch(search) !== 'off';
}

function wave(post: PostState, x: number, y: number, now: number, ms: number, radius: number, strength: number): void {
  post.waves.push({ x, y, bornAt: now, ms, radius, strength });
  while (post.waves.length > WAVE_CAP) post.waves.shift();
}

function split(post: PostState, now: number, ms: number, px: number): void {
  // A stronger split takes over a weaker one; a weaker one never cuts a strong one short.
  if (post.split !== null && now - post.split.at < post.split.ms && post.split.px > px) return;
  post.split = { at: now, ms, px };
}

/** Reads the frame's events for what should ripple, split or shine. */
export function applyPostEvents(post: PostState, events: readonly GameEvent[], now: number): void {
  for (const event of events) {
    switch (event.type) {
      case 'explosion': {
        const radius = event.radius ?? 30;
        const tier = event.particle ?? 'medium';
        wave(post, event.x, event.y, now, 420 + radius * 4, radius * TIER_REACH[tier] + 30, 6 + radius * 0.15);
        if (tier === 'big') split(post, now, 240, 4);
        if (tier === 'holy') split(post, now, 320, 7);
        break;
      }
      case 'comboHit':
        if (event.finisher) {
          wave(post, event.x, event.y, now, 520, 220, 9);
          split(post, now, 320, 6);
        } else {
          wave(post, event.x, event.y, now, 220, 60, 3);
        }
        break;
      case 'gib':
        wave(post, event.x, event.y, now, 300, 90, 5);
        split(post, now, 240, 5);
        break;
      case 'beamFire':
        wave(post, event.x, event.y, now, 420, 160, 6);
        break;
      case 'hexEnd':
        if (event.burst) split(post, now, 300, 6);
        break;
      case 'techniqueEnd':
        if (event.landed) split(post, now, 220, 3);
        break;
      default:
        break;
    }
  }
}

/** Drops the waves and the split that have faded. */
export function advancePost(post: PostState, now: number): void {
  for (let i = post.waves.length - 1; i >= 0; i -= 1) {
    const current = post.waves[i];
    if (current !== undefined && now - current.bornAt >= current.ms) post.waves.splice(i, 1);
  }
  if (post.split !== null && now - post.split.at >= post.split.ms) post.split = null;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The pass's uniforms for this frame: waves projected to canvas px, the split and the bloom. */
export function glowUniforms(post: PostState, camera: Camera, viewport: Size, dpr: number, cine: Cinematic, now: number): GlowUniforms {
  const scale = camera.zoom * dpr;
  const waves: GlowWave[] = post.waves.slice(-MAX_WAVES).map((current) => {
    const t = clamp01((now - current.bornAt) / current.ms);
    const screen = worldToScreen(camera, viewport, { x: current.x, y: current.y });
    return {
      x: screen.x * dpr,
      y: screen.y * dpr,
      radius: current.radius * easeOut(t) * scale,
      width: (14 + current.radius * 0.22) * scale,
      strength: current.strength * (1 - t) * scale,
    };
  });
  const chroma = post.split === null ? 0 : post.split.px * (1 - clamp01((now - post.split.at) / post.split.ms)) * dpr;
  return {
    bloom: BLOOM_BASE + cine.aura * 0.5 + cine.whiteout * 0.3 + cine.dim * 0.2,
    threshold: BLOOM_THRESHOLD - cine.aura * 0.12,
    chroma,
    vignette: VIGNETTE,
    waves,
  };
}
