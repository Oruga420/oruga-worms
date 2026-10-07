import { describe, expect, it } from 'vitest';
import { BLUR_SRC, BRIGHT_SRC, COMPOSITE_SRC, MAX_WAVES, VERTEX_SRC, createGlowPass } from '@/engine/glow.ts';

/** The pass is GPU only; here the fallback and the shader text, the browser smoke runs the rest. */
describe('glow pass', () => {
  it('is null without a WebGL2 context, whether the browser says no or throws', () => {
    const quiet = { getContext: () => null, addEventListener: () => undefined, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    expect(createGlowPass(quiet)).toBeNull();
    const loud = {
      getContext: () => {
        throw new Error('no gpu');
      },
      addEventListener: () => undefined,
    } as unknown as HTMLCanvasElement;
    expect(createGlowPass(loud)).toBeNull();
  });

  it('writes its shaders for WebGL2 with the uniforms the pass sets, the waves sized to MAX_WAVES', () => {
    for (const source of [VERTEX_SRC, BRIGHT_SRC, BLUR_SRC, COMPOSITE_SRC]) expect(source.startsWith('#version 300 es')).toBe(true);
    expect(BRIGHT_SRC).toContain('uThreshold');
    expect(BLUR_SRC).toContain('uStep');
    for (const name of ['uScene', 'uBloom', 'uSize', 'uBloomStrength', 'uChroma', 'uVignette', 'uWaveCount']) expect(COMPOSITE_SRC).toContain(name);
    expect(COMPOSITE_SRC).toContain(`uWaves[${MAX_WAVES}]`);
    expect(COMPOSITE_SRC).toContain(`uWaveStrength[${MAX_WAVES}]`);
    expect(COMPOSITE_SRC).toContain(`i < ${MAX_WAVES}`);
  });
});
