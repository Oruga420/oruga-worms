import { describe, expect, it } from 'vitest';
import { validateResponse, type ValidWeapon } from '@/ai/response-schema.ts';
import type { WeaponId } from '@/weapons/types.ts';

const WORLD = { w: 1920, h: 696 };

function weapons(): Map<string, ValidWeapon> {
  return new Map<string, ValidWeapon>([
    ['bazooka', { id: 'bazooka' as WeaponId, requiresTargetSelect: false, fuseOptionsMs: null, hasAmmo: true }],
    ['grenade', { id: 'grenade' as WeaponId, requiresTargetSelect: false, fuseOptionsMs: [1000, 2000, 3000, 4000, 5000], hasAmmo: true }],
    ['air_strike', { id: 'air_strike' as WeaponId, requiresTargetSelect: true, fuseOptionsMs: null, hasAmmo: true }],
    ['banana_bomb', { id: 'banana_bomb' as WeaponId, requiresTargetSelect: false, fuseOptionsMs: [1000, 2000, 3000, 4000, 5000], hasAmmo: false }],
  ]);
}

const good = { weapon: 'bazooka', aimAngleDeg: 30, power: 80, facing: 'right', move: { direction: 'none', durationMs: 0 }, taunt: 'Fire!', confidence: 0.8, reasoning: 'x' };

describe('validateResponse', () => {
  it('accepts and normalizes a good response', () => {
    const result = validateResponse(good, weapons(), WORLD, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ weapon: 'bazooka', aimAngleDeg: 30, power: 80, facing: 'right' });
  });

  it('clamps angle, power and move duration', () => {
    const result = validateResponse({ ...good, aimAngleDeg: 200, power: 250, move: { direction: 'left', durationMs: 99999 } }, weapons(), WORLD, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aimAngleDeg).toBe(90);
      expect(result.value.power).toBe(100);
      expect(result.value.move).toEqual({ direction: 'left', durationMs: 3000 });
    }
  });

  it('rejects an unknown or empty weapon', () => {
    expect(validateResponse({ ...good, weapon: 'nuke' }, weapons(), WORLD, null).ok).toBe(false);
    expect(validateResponse({ ...good, weapon: 'banana_bomb' }, weapons(), WORLD, null).ok).toBe(false);
  });

  it('rejects a confidence below the floor', () => {
    const result = validateResponse({ ...good, confidence: 0.2 }, weapons(), WORLD, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('floor');
  });

  it('snaps a timed weapon fuse to a legal option', () => {
    const result = validateResponse({ ...good, weapon: 'grenade', fuseMs: 2600 }, weapons(), WORLD, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fuseMs).toBe(3000);
  });

  it('requires a target point for a targeted weapon and clamps it', () => {
    expect(validateResponse({ ...good, weapon: 'air_strike' }, weapons(), WORLD, null).ok).toBe(false);
    const result = validateResponse({ ...good, weapon: 'air_strike', targetPoint: { x: 5000, y: -10 } }, weapons(), WORLD, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetPoint).toEqual({ x: 1920, y: 0 });
  });

  it('derives facing from the nearest enemy when missing, and strips control characters from the taunt', () => {
    const result = validateResponse({ ...good, facing: 'sideways', taunt: `bad${String.fromCharCode(7)}taunt` }, weapons(), WORLD, -50);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.facing).toBe('left');
      expect(result.value.taunt).toBe('badtaunt');
    }
  });
});
