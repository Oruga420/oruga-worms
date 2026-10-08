import { describe, expect, it } from 'vitest';
import { createCamera } from '@/engine/camera.ts';
import { MAX_WAVES } from '@/engine/glow.ts';
import { NO_CINEMATIC } from '@/game/cinematic.ts';
import type { GameEvent } from '@/game/controller.ts';
import { BLOOM_BASE, BLOOM_THRESHOLD, VIGNETTE, advancePost, applyPostEvents, createPost, glowEnabledFromSearch, glowModeFromSearch, glowUniforms, resetPost } from '@/game/post.ts';

const VIEWPORT = { w: 1280, h: 720 };
const camera = () => createCamera({ x: 640, y: 360 });
const explosion = (x: number, y: number, radius: number, particle?: 'small' | 'medium' | 'big' | 'holy'): GameEvent =>
  particle === undefined ? { type: 'explosion', x, y, radius } : { type: 'explosion', x, y, radius, particle };

describe('post: the url switch', () => {
  it('is on by default and off with ?gl=0, off, false or no', () => {
    expect(glowEnabledFromSearch('')).toBe(true);
    expect(glowEnabledFromSearch('?seed=1')).toBe(true);
    expect(glowEnabledFromSearch('?gl=1')).toBe(true);
    expect(glowEnabledFromSearch('?gl=0')).toBe(false);
    expect(glowEnabledFromSearch('?seed=1&gl=off')).toBe(false);
    expect(glowEnabledFromSearch('?gl=FALSE')).toBe(false);
    expect(glowEnabledFromSearch('?gl=no')).toBe(false);
    // Auto unless asked: ?gl=1 keeps the pass whatever the frame costs, ?gl=0 never opens it.
    expect(glowModeFromSearch('')).toBe('auto');
    expect(glowModeFromSearch('?gl=2')).toBe('auto');
    expect(glowModeFromSearch('?gl=1')).toBe('on');
    expect(glowModeFromSearch('?gl=ON')).toBe('on');
    expect(glowModeFromSearch('?gl=0')).toBe('off');
  });
});

describe('post: events into waves and splits', () => {
  it('ripples every explosion, further and harder with the blast, and splits the colours only for the big tiers', () => {
    const post = createPost();
    applyPostEvents(post, [explosion(100, 100, 20, 'small'), explosion(300, 100, 40, 'big')], 1000);
    expect(post.waves).toHaveLength(2);
    const [small, big] = post.waves;
    expect(small?.radius).toBeLessThan(big?.radius ?? 0);
    expect(small?.strength).toBeLessThan(big?.strength ?? 0);
    expect(small?.ms).toBeLessThan(big?.ms ?? 0);
    expect(post.split?.px).toBe(4);
    applyPostEvents(post, [explosion(500, 100, 60, 'holy')], 1100);
    expect(post.split?.px).toBe(7);
    // A weaker split never cuts a stronger one short.
    applyPostEvents(post, [explosion(500, 100, 60, 'big')], 1150);
    expect(post.split?.px).toBe(7);
    expect(post.split?.at).toBe(1100);
  });

  it('ripples a finisher, a burst worm and a beam, and a plain blow only a little', () => {
    const post = createPost();
    applyPostEvents(
      post,
      [
        { type: 'comboHit', comboId: 1, attackerId: 'a', victimId: 'b', hit: 2, finisher: false, ko: false, x: 10, y: 10, dx: 1, dy: 0 },
        { type: 'comboHit', comboId: 1, attackerId: 'a', victimId: 'b', hit: 9, finisher: true, ko: true, x: 10, y: 10, dx: 1, dy: 0 },
        { type: 'gib', wormId: 'b', x: 20, y: 20, vx: 0, vy: 0, colorIndex: 1 },
        { type: 'beamFire', beamId: 1, attackerId: 'a', x: 30, y: 30, dx: 1, dy: 0 },
        { type: 'landed', wormId: 'a', x: 0, y: 0, speed: 10 },
      ],
      500,
    );
    expect(post.waves.map((wave) => wave.radius)).toEqual([60, 220, 90, 160]);
    expect(post.split?.px).toBe(6);
  });

  it('keeps the list bounded and clears it on reset', () => {
    const post = createPost();
    for (let i = 0; i < 40; i += 1) applyPostEvents(post, [explosion(i, 0, 10)], i);
    expect(post.waves.length).toBeLessThanOrEqual(24);
    resetPost(post);
    expect(post.waves).toHaveLength(0);
    expect(post.split).toBeNull();
  });

  it('drops a wave once its time is up, and the split with it', () => {
    const post = createPost();
    applyPostEvents(post, [explosion(0, 0, 20, 'holy')], 0);
    const ms = post.waves[0]?.ms ?? 0;
    advancePost(post, 300);
    expect(post.waves).toHaveLength(1);
    expect(post.split).not.toBeNull();
    advancePost(post, ms - 1);
    expect(post.waves).toHaveLength(1);
    expect(post.split).toBeNull();
    advancePost(post, Math.max(ms, 320));
    expect(post.waves).toHaveLength(0);
    expect(post.split).toBeNull();
  });
});

describe('post: the uniforms', () => {
  it('projects a wave through the camera, scaled by the zoom and the dpr, growing out and fading', () => {
    const post = createPost();
    applyPostEvents(post, [explosion(700, 400, 30, 'medium')], 0);
    const cam = { ...camera(), zoom: 1 };
    const start = glowUniforms(post, cam, VIEWPORT, 2, NO_CINEMATIC, 0);
    expect(start.waves).toHaveLength(1);
    const wave = start.waves[0];
    // World (700, 400) with the camera on (640, 360) at zoom 1 is 60, 40 right and down of the centre; doubled by the dpr.
    expect(wave?.x).toBeCloseTo((640 + 60) * 2);
    expect(wave?.y).toBeCloseTo((360 + 40) * 2);
    expect(wave?.radius).toBe(0);
    expect(wave?.strength).toBeCloseTo((6 + 30 * 0.15) * 2);
    const half = (post.waves[0]?.ms ?? 0) / 2;
    const later = glowUniforms(post, cam, VIEWPORT, 2, NO_CINEMATIC, half);
    expect(later.waves[0]?.radius).toBeGreaterThan(0);
    expect(later.waves[0]?.strength).toBeLessThan(wave?.strength ?? 0);
    // The zoom scales the ring like the dpr does: zoom 2 at dpr 1 is zoom 1 at dpr 2.
    const zoomed = glowUniforms(post, { ...cam, zoom: 2 }, VIEWPORT, 1, NO_CINEMATIC, half);
    expect(zoomed.waves[0]?.radius).toBeCloseTo(later.waves[0]?.radius ?? 0);
    expect(zoomed.waves[0]?.width).toBeCloseTo(later.waves[0]?.width ?? 0);
    expect(start.bloom).toBe(BLOOM_BASE);
    expect(start.threshold).toBe(BLOOM_THRESHOLD);
    expect(start.vignette).toBe(VIGNETTE);
    expect(start.chroma).toBe(0);
  });

  it('hands the shader the newest waves only, and the split fading out', () => {
    const post = createPost();
    for (let i = 0; i < MAX_WAVES + 4; i += 1) applyPostEvents(post, [explosion(i * 10, 0, 10)], i);
    applyPostEvents(post, [{ type: 'gib', wormId: 'b', x: 20, y: 20, vx: 0, vy: 0, colorIndex: 1 }], 100);
    const uniforms = glowUniforms(post, camera(), VIEWPORT, 1, NO_CINEMATIC, 100);
    expect(uniforms.waves).toHaveLength(MAX_WAVES);
    expect(uniforms.chroma).toBe(5);
    expect(glowUniforms(post, camera(), VIEWPORT, 1, NO_CINEMATIC, 220).chroma).toBeCloseTo(2.5);
  });

  it('blooms harder through a super: the aura, the white screen and the dim all raise it', () => {
    const post = createPost();
    const plain = glowUniforms(post, camera(), VIEWPORT, 1, NO_CINEMATIC, 0);
    const aura = glowUniforms(post, camera(), VIEWPORT, 1, { ...NO_CINEMATIC, aura: 1 }, 0);
    const white = glowUniforms(post, camera(), VIEWPORT, 1, { ...NO_CINEMATIC, whiteout: 1 }, 0);
    expect(aura.bloom).toBeGreaterThan(plain.bloom);
    expect(aura.threshold).toBeLessThan(plain.threshold);
    expect(white.bloom).toBeGreaterThan(plain.bloom);
  });
});
