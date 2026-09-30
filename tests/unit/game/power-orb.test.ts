import { describe, expect, it } from 'vitest';
import { ORB_RADIUS, orbLift, orbPulse } from '@/game/power-orb.ts';

describe('power orb timing', () => {
  it('breathes between 0 and 1', () => {
    for (let t = 0; t < 5000; t += 37) {
      expect(orbPulse(t)).toBeGreaterThanOrEqual(0);
      expect(orbPulse(t)).toBeLessThanOrEqual(1);
    }
  });

  it('falling, the ball sits on its point; resting, it floats clear of the ground and bobs', () => {
    expect(orbLift(false, 0)).toBe(ORB_RADIUS);
    expect(orbLift(false, 1234)).toBe(ORB_RADIUS);
    const lifts = Array.from({ length: 60 }, (_, i) => orbLift(true, i * 50));
    expect(Math.min(...lifts)).toBeGreaterThan(ORB_RADIUS);
    expect(Math.max(...lifts) - Math.min(...lifts)).toBeGreaterThan(2);
  });
});
