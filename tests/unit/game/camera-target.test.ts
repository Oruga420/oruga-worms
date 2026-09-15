import { describe, expect, it } from 'vitest';
import {
  IMPACT_HOLD_MS,
  INITIAL_DIRECTOR,
  PROJECTILE_TAU_MS,
  updateCameraTarget,
} from '@/game/camera-target.ts';
import type { SimWorld } from '@/sim/world.ts';

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
