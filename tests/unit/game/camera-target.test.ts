import { describe, expect, it } from 'vitest';
import {
  IMPACT_HOLD_MS,
  INITIAL_DIRECTOR,
  PROJECTILE_TAU_MS,
  updateCameraTarget,
} from '@/game/camera-target.ts';
import type { SimWorld } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';

/** Only world.projectiles is read, so a stub keeps the test honest and small. */
function world(projectiles: readonly { id: number; x: number; y: number }[]): SimWorld {
  return { projectiles } as unknown as SimWorld;
}

const TICK = 1000 / 60;

/** A world with no shells and one live sheep: the director must ride the sheep the same way. */
function sheepWorld(sheep: readonly { id: number; x: number; y: number; alive: boolean }[]): SimWorld {
  return { projectiles: [], sheep } as unknown as SimWorld;
}

describe('camera director: the sheep', () => {
  it('rides a live sheep when no shell is in the air', () => {
    const aim = updateCameraTarget(INITIAL_DIRECTOR, sheepWorld([{ id: 3, x: 640, y: 300, alive: true }]), TICK);
    expect(aim.director.focus).toBe('projectile');
    expect(aim.target).toEqual({ x: 640, y: 300 });
    expect(aim.tauMs).toBe(PROJECTILE_TAU_MS);
  });

  it('ignores a dead sheep and holds on the impact where it was', () => {
    const riding = updateCameraTarget(INITIAL_DIRECTOR, sheepWorld([{ id: 3, x: 640, y: 300, alive: true }]), TICK);
    const after = updateCameraTarget(riding.director, sheepWorld([{ id: 3, x: 640, y: 300, alive: false }]), TICK);
    expect(after.director.focus).toBe('impact');
    expect(after.target).toEqual({ x: 640, y: 300 });
  });
});

describe('camera director', () => {
  it('stays on the worm when nothing is in the air', () => {
    const aim = updateCameraTarget(INITIAL_DIRECTOR, world([]), TICK);
    expect(aim.target).toBeNull();
    expect(aim.director.focus).toBe('worm');
  });

  it('rides a fired shot with the tighter smoothing', () => {
    const aim = updateCameraTarget(INITIAL_DIRECTOR, world([{ id: 7, x: 100, y: 50 }]), TICK);
    expect(aim.target).toEqual({ x: 100, y: 50 });
    expect(aim.tauMs).toBe(PROJECTILE_TAU_MS);
    expect(aim.director).toMatchObject({ focus: 'projectile', projectileId: 7 });
  });

  it('keeps riding the same shell when a cluster child spawns with a newer id', () => {
    const first = updateCameraTarget(INITIAL_DIRECTOR, world([{ id: 7, x: 100, y: 50 }]), TICK);
    const next = updateCameraTarget(first.director, world([{ id: 7, x: 120, y: 40 }, { id: 9, x: 300, y: 90 }]), TICK);
    expect(next.director.projectileId).toBe(7);
    expect(next.target).toEqual({ x: 120, y: 40 });
  });

  it('holds on the last known position once the shell is gone, then hands back to the worm', () => {
    const riding = updateCameraTarget(INITIAL_DIRECTOR, world([{ id: 7, x: 210, y: 60 }]), TICK);
    const impact = updateCameraTarget(riding.director, world([]), TICK);
    expect(impact.director.focus).toBe('impact');
    expect(impact.target).toEqual({ x: 210, y: 60 });

    let state = impact.director;
    let target = impact.target;
    for (let elapsed = 0; elapsed <= IMPACT_HOLD_MS + TICK; elapsed += TICK) {
      const step = updateCameraTarget(state, world([]), TICK);
      state = step.director;
      target = step.target;
    }
    expect(state.focus).toBe('worm');
    expect(target).toBeNull();
  });

  it('picks up a new shot after the hand back', () => {
    const aim = updateCameraTarget(INITIAL_DIRECTOR, world([{ id: 31, x: 5, y: 5 }]), TICK);
    expect(aim.director.projectileId).toBe(31);
  });
});

describe('camera director: the beam', () => {
  const beamWorld = (stage: 'charge' | 'fire', length: number, alive = true, dx = 1, dy = 0): SimWorld =>
    ({
      projectiles: [],
      worms: [{ id: 'hero', x: 300, y: 349 }],
      beams: [{ attackerId: 'hero', stage, x0: 306, y0: 339, dx, dy, length, alive }],
    }) as unknown as SimWorld;
  /** A 1280 by 720 screen at the default zoom of 2.5. */
  const desktop = { halfW: 256, halfH: 144 };

  it('frames the worm while it charges, then the beam, then sits where it was', () => {
    const charging = updateCameraTarget(INITIAL_DIRECTOR, beamWorld('charge', 0), TICK, desktop);
    expect(charging.director.focus).toBe('beam');
    expect(charging.target).toEqual({ x: 300, y: 341 });
    // A short beam fits: its middle.
    const firing = updateCameraTarget(charging.director, beamWorld('fire', 200), TICK, desktop);
    expect(firing.target).toEqual({ x: 406, y: 339 });
    const after = updateCameraTarget(firing.director, beamWorld('fire', 200, false), TICK, desktop);
    expect(after.director.focus).toBe('impact');
    expect(after.target).toEqual({ x: 406, y: 339 });
  });

  it('keeps the worm in the picture when the beam is wider than the screen', () => {
    const firing = updateCameraTarget(INITIAL_DIRECTOR, beamWorld('fire', 640), TICK, desktop);
    // Half way from the centre to the edge: the worm well inside, the beam across the rest.
    expect(firing.target).toEqual({ x: 434, y: 339 });
    expect(Math.abs(300 - (firing.target?.x ?? Infinity))).toBeLessThan(desktop.halfW * 0.6);
    // Straight up, the screen is shorter than it is wide.
    const up = updateCameraTarget(INITIAL_DIRECTOR, beamWorld('fire', 640, true, 0, -1), TICK, desktop);
    expect(up.target).toEqual({ x: 306, y: 267 });
    // With no view to fit, the middle of the beam.
    expect(updateCameraTarget(INITIAL_DIRECTOR, beamWorld('fire', 640), TICK).target).toEqual({ x: 626, y: 339 });
  });
});

describe('camera director: gear 5', () => {
  const devourWorld = (stage: 'awaken' | 'stretch' | 'chew', stageTicks: number, alive = true): SimWorld =>
    ({
      projectiles: [],
      worms: [{ id: 'hero', x: 300, y: 349 }],
      devours: [
        {
          attackerId: 'hero',
          victimId: 'enemy',
          stage,
          stageTicks,
          spec: WEAPONS.gear_five.devour,
          holdX: 300,
          holdY: 349,
          facing: 1,
          shoulderX: 304,
          shoulderY: 340,
          reachX: 440,
          reachY: 341,
          grabX: 440,
          grabY: 349,
          mouthX: 311,
          mouthY: 342,
          alive,
        },
      ],
    }) as unknown as SimWorld;

  it('frames the worm as it awakens, the arm and its catch, then the mouth, then sits where it was', () => {
    const awakening = updateCameraTarget(INITIAL_DIRECTOR, devourWorld('awaken', 10), TICK);
    expect(awakening.director.focus).toBe('devour');
    expect(awakening.target?.x).toBe(300);
    expect(awakening.target?.y).toBeCloseTo(349 - 16 * 0.6);
    // The arm at full stretch: half way between the worm and the hand.
    const stretched = updateCameraTarget(awakening.director, devourWorld('stretch', 1000), TICK);
    expect(stretched.target?.x).toBeCloseTo((300 + 440) / 2);
    const chewing = updateCameraTarget(stretched.director, devourWorld('chew', 5), TICK);
    expect(chewing.target).toEqual({ x: 306, y: 333 });
    const after = updateCameraTarget(chewing.director, devourWorld('chew', 5, false), TICK);
    expect(after.director.focus).toBe('impact');
    expect(after.target).toEqual({ x: 306, y: 333 });
  });
});
