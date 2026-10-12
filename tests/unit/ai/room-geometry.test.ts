import { describe, expect, it } from 'vitest';
import { evaluateTechnique } from '@/ai/technique-eval.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from '../sim/fixture.ts';

describe('CPU ROOM geometry matches the caster-centred region', () => {
  it('finds the99percent swap near a map edge instead of assuming a centred circle', () => {
    const world = flatWorld({ width: 1920, height: 696, floorY: 640, waterY: 680 });
    const caster = { id: 'a', teamId: 'red', x: 20, y: 100, hp: 1, alive: true };
    const enemy = { id: 'b', teamId: 'blue', x: 1800, y: 100, hp: 100, alive: true };
    const choice = evaluateTechnique({ mask: world.terrain.mask, waterY: 680, team: 'red', worms: [caster, enemy] }, WEAPONS.room, caster, 1);
    expect(choice).not.toBeNull();
    expect(choice?.angleDeg).toBe(90);
    expect(choice?.score).toBeGreaterThan(0);
  });
});
