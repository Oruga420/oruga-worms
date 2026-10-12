import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng.ts';
import { createParticleSystem } from '@/engine/particles.ts';
import { applyFxEvents, createFx } from '@/game/fx.ts';
import { createGore } from '@/game/gore.ts';

// The full event pipeline must not put a geometric ring back on top of a painted scene.
describe('painted power event overlays', () => {
  it.each([
    { kind: 'force_field', beat: 'shield' },
    { kind: 'time_stop', beat: 'freeze' },
    { kind: 'room', beat: 'open' },
  ] as const)('$kind does not emit a second procedural ring', ({ kind, beat }) => {
    const fx = createFx();
    applyFxEvents(fx, [{ type: 'techniqueBeat', techniqueId: 1, kind, attackerId: 'a', victimId: null, beat, n: 1, x: 100, y: 100, facing: 1, colorIndex: 0 }], {
      gore: createGore(), particles: createParticleSystem(), rng: createRng(4), onScreen: () => true,
    });
    expect(fx.rings).toHaveLength(0);
  });
});
