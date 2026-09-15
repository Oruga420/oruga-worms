import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { createCamera } from '@/engine/camera.ts';
import type { Ctx2D } from '@/engine/canvas-types.ts';
import {
  MAX_EXPLOSION_PARTICLES,
  alphaCurve,
  createParticle,
  createParticleSystem,
  drawParticles,
  explosionPlan,
  spawnExplosion,
  updateParticle,
  type Particle,
  type ParticleKind,
} from '@/engine/particles.ts';

function particle(overrides: Partial<Particle> = {}): Particle {
  return { ...createParticle(), life: 1, maxLife: 1, alpha: 1, ...overrides };
}

function fakeCtx() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((arg) => (typeof arg === 'number' ? String(Math.round(arg * 1000) / 1000) : String(arg))).join(',')})`);
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
  return { ctx, calls, count: (name: string) => calls.filter((call) => call.startsWith(`${name}(`)).length };
}

describe('particles: update math', () => {
  it('integrates gravity then position and burns life', () => {
    const p = particle({ vx: 10, vy: 0, gravityScale: 1, drag: 0 });
    expect(updateParticle(p, 0.5, 400)).toBe(true);
    expect(p.vy).toBe(200);
    expect(p.x).toBe(5);
    expect(p.y).toBe(100);
    expect(p.life).toBe(0.5);
    expect(p.alpha).toBe(0.5);
  });

  it('applies drag as a fraction of velocity per second and a negative gravity scale rises', () => {
    const p = particle({ vx: 10, vy: 10, drag: 0.5, gravityScale: -1 });
    updateParticle(p, 0.5, 400);
    expect(p.vx).toBe(7.5);
    expect(p.vy).toBe(7.5 - 200);
    const heavy = particle({ vx: 10, drag: 10 });
    updateParticle(heavy, 0.5, 0);
    expect(heavy.vx).toBe(0);
  });

  it('spins and grows', () => {
    const p = particle({ spin: 2, size: 4, growth: 2 });
    updateParticle(p, 0.5, 0);
    expect(p.rotation).toBe(1);
    expect(p.size).toBe(5);
    const shrinking = particle({ size: 1, growth: -10 });
    updateParticle(shrinking, 0.5, 0);
    expect(shrinking.size).toBe(0);
  });

  it('dies when life runs out and reports it', () => {
    const p = particle({ life: 0.2, vx: 100 });
    expect(updateParticle(p, 0.5, 400)).toBe(false);
    expect(p.life).toBe(0);
    expect(p.alpha).toBe(0);
    expect(p.x).toBe(0);
  });

  it('shapes alpha per kind over the remaining life', () => {
    expect(alphaCurve('spark', 1)).toBe(1);
    expect(alphaCurve('spark', 0.25)).toBe(0.25);
    expect(alphaCurve('spark', 0)).toBe(0);
    expect(alphaCurve('smoke', 1)).toBeCloseTo(0.55, 9);
    expect(alphaCurve('smoke', 0)).toBe(0);
    expect(alphaCurve('smoke', 0.5)).toBeGreaterThan(alphaCurve('smoke', 0.25));
    expect(alphaCurve('debris', 1)).toBe(1);
    expect(alphaCurve('debris', 0.5)).toBe(1);
    expect(alphaCurve('debris', 0.1)).toBeCloseTo(0.4, 9);
    expect(alphaCurve('spark', 7)).toBe(1);
    expect(alphaCurve('spark', -1)).toBe(0);
  });
});

describe('particles: explosion plan', () => {
  it('grows with radius and intensity', () => {
    const small = explosionPlan(20, 0.5);
    const big = explosionPlan(100, 0.5);
    const fierce = explosionPlan(100, 1);
    for (const key of ['sparks', 'smoke', 'debris', 'sparkSpeed', 'smokeSpeed', 'debrisSpeed', 'smokeSize', 'debrisSize'] as const) {
      expect(big[key]).toBeGreaterThan(small[key]);
    }
    for (const key of ['sparks', 'smoke', 'debris', 'sparkSpeed', 'debrisSpeed'] as const) {
      expect(fierce[key]).toBeGreaterThan(big[key]);
    }
    expect(Object.isFrozen(small)).toBe(true);
  });

  it('never exceeds the cap and scales the mix down proportionally', () => {
    const plan = explosionPlan(400, 1);
    expect(plan.sparks + plan.smoke + plan.debris).toBeLessThanOrEqual(MAX_EXPLOSION_PARTICLES);
    expect(plan.sparks).toBeGreaterThan(plan.smoke);
    const tight = explosionPlan(400, 1, 20);
    expect(tight.sparks + tight.smoke + tight.debris).toBeLessThanOrEqual(20);
    expect(tight.sparks).toBeGreaterThan(0);
  });

  it('clamps bad or extreme inputs to the supported range', () => {
    expect(explosionPlan(Number.NaN, Number.NaN)).toEqual(explosionPlan(4, 0));
    expect(explosionPlan(-50, 7)).toEqual(explosionPlan(4, 1));
    expect(explosionPlan(10_000, 0.5)).toEqual(explosionPlan(400, 0.5));
  });
});

describe('particles: explosion spawn', () => {
  const spec = { x: 300, y: 200, radius: 50, intensity: 0.8 };

  function kinds(system: ReturnType<typeof createParticleSystem>): Record<ParticleKind, number> {
    const counts: Record<ParticleKind, number> = { spark: 0, smoke: 0, debris: 0 };
    system.forEach((p) => {
      counts[p.kind] += 1;
    });
    return counts;
  }

  it('spawns exactly the planned mix at the explosion point', () => {
    const system = createParticleSystem({ capacity: 1000 });
    const plan = explosionPlan(spec.radius, spec.intensity);
    const spawned = spawnExplosion(system, spec, createRng(42));
    expect(spawned).toBe(plan.sparks + plan.smoke + plan.debris);
    expect(system.count()).toBe(spawned);
    expect(kinds(system)).toEqual({ spark: plan.sparks, smoke: plan.smoke, debris: plan.debris });
    system.forEach((p) => {
      expect(p.x).toBe(spec.x);
      expect(p.y).toBe(spec.y);
      expect(p.life).toBe(p.maxLife);
      expect(p.life).toBeGreaterThan(0);
    });
  });

  it('gives each kind its physics: smoke rises, debris launches upward, sparks fly at the planned speed', () => {
    const system = createParticleSystem({ capacity: 1000 });
    const plan = explosionPlan(spec.radius, spec.intensity);
    spawnExplosion(system, spec, createRng(7));
    system.forEach((p) => {
      const speed = Math.hypot(p.vx, p.vy);
      if (p.kind === 'smoke') {
        expect(p.gravityScale).toBeLessThan(0);
        expect(p.growth).toBeGreaterThan(0);
        expect(speed).toBeLessThanOrEqual(plan.smokeSpeed + 1e-9);
      } else if (p.kind === 'debris') {
        expect(p.vy).toBeLessThanOrEqual(0);
        expect(p.gravityScale).toBe(1);
        expect(p.spin).not.toBe(0);
      } else {
        expect(speed).toBeGreaterThanOrEqual(plan.sparkSpeed * 0.3 - 1e-9);
        expect(speed).toBeLessThanOrEqual(plan.sparkSpeed + 1e-9);
      }
    });
  });

  it('is deterministic for the same seed', () => {
    const a = createParticleSystem({ capacity: 1000 });
    const b = createParticleSystem({ capacity: 1000 });
    spawnExplosion(a, spec, createRng(99));
    spawnExplosion(b, spec, createRng(99));
    const snapshot = (system: typeof a): string[] => {
      const out: string[] = [];
      system.forEach((p) => out.push(`${p.kind}:${p.vx.toFixed(6)}:${p.vy.toFixed(6)}:${p.color}`));
      return out;
    };
    expect(snapshot(a)).toEqual(snapshot(b));
    const c = createParticleSystem({ capacity: 1000 });
    spawnExplosion(c, spec, createRng(100));
    expect(snapshot(c)).not.toEqual(snapshot(a));
  });

  it('stops at the pool capacity and reports how many fit', () => {
    const system = createParticleSystem({ capacity: 10 });
    expect(spawnExplosion(system, spec, createRng(1))).toBe(10);
    expect(system.count()).toBe(10);
    expect(spawnExplosion(system, spec, createRng(2))).toBe(0);
  });
});

describe('particles: system', () => {
  it('sweeps dead particles on update and clears', () => {
    const system = createParticleSystem({ capacity: 16, gravity: 0 });
    for (let i = 0; i < 3; i += 1) {
      system.spawn((p) => {
        p.life = 0.1;
        p.maxLife = 0.1;
      });
    }
    system.spawn((p) => {
      p.life = 5;
      p.maxLife = 5;
      p.vx = 10;
    });
    expect(system.count()).toBe(4);
    system.update(0.2);
    expect(system.count()).toBe(1);
    system.forEach((p) => expect(p.x).toBe(2));
    system.update(-1);
    expect(system.count()).toBe(1);
    system.clear();
    expect(system.count()).toBe(0);
    expect(system.capacity).toBe(16);
    expect(system.gravity).toBe(0);
  });

  it('returns null from spawn when full', () => {
    const system = createParticleSystem({ capacity: 1 });
    expect(system.spawn(() => {})).not.toBeNull();
    expect(system.spawn(() => {})).toBeNull();
  });
});

describe('particles: drawing', () => {
  const camera = createCamera({ x: 100, y: 100, zoom: 2 });
  const viewport = { w: 200, h: 200 };

  it('draws nothing for an empty system', () => {
    const fake = fakeCtx();
    drawParticles(fake.ctx, createParticleSystem(), camera, viewport);
    expect(fake.calls).toEqual([]);
  });

  it('draws smoke as discs, debris as rotated rects and sparks additively, mapped through the camera', () => {
    const system = createParticleSystem();
    system.spawn((p) => {
      Object.assign(p, particle({ kind: 'smoke', x: 100, y: 100, size: 3, alpha: 0.5 }));
    });
    system.spawn((p) => {
      Object.assign(p, particle({ kind: 'debris', x: 110, y: 100, size: 1, rotation: 0.5 }));
    });
    system.spawn((p) => {
      Object.assign(p, particle({ kind: 'spark', x: 100, y: 90, size: 1 }));
    });
    const fake = fakeCtx();
    drawParticles(fake.ctx, system, camera, viewport);
    expect(fake.count('arc')).toBe(1);
    expect(fake.calls).toContain('arc(100,100,6,0,6.283)');
    expect(fake.count('fillRect')).toBe(2);
    expect(fake.calls).toContain('fillRect(98,78,4,4)');
    expect(fake.calls).toContain('translate(120,100)');
    expect(fake.calls).toContain('rotate(0.5)');
    expect(fake.count('save')).toBe(2);
    expect(fake.count('restore')).toBe(2);
    expect(fake.ctx.globalCompositeOperation).toBe('lighter');
    const sparkIndex = fake.calls.indexOf('fillRect(98,78,4,4)');
    const arcIndex = fake.calls.indexOf('arc(100,100,6,0,6.283)');
    expect(sparkIndex).toBeGreaterThan(arcIndex);
  });
});
