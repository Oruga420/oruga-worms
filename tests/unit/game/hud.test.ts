import { describe, expect, it } from 'vitest';
import { INITIAL_AIM } from '@/game/aim.ts';
import { drawHud, hudKey, type HudModel } from '@/game/hud.ts';
import { POWER_GOLD } from '@/game/power-orb.ts';
import { quickGame } from '@/game/setup.ts';
import type { Ctx2D } from '@/engine/canvas-types.ts';
import type { MatchState } from '@/match/state.ts';
import { createFakeFactory } from '../terrain/fakes.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

function model(state: MatchState): HudModel {
  return { state, aim: INITIAL_AIM, weapon: 'bazooka', banner: null, steps: 10, stepsTotal: 10, panel: null, weaponSprites: null };
}

/** Every line of text the HUD writes, with the colour it was written in. */
function texts(m: HudModel): (readonly [string, unknown])[] {
  const ctx = createRecordingContext();
  const out: (readonly [string, unknown])[] = [];
  const spy = new Proxy(ctx, {
    get(target, name) {
      if (name === 'fillText') return (text: string) => out.push([text, target.fillStyle] as const);
      return Reflect.get(target, name);
    },
    set(target, name, value) {
      return Reflect.set(target, name, value);
    },
  }) as Ctx2D;
  drawHud(spy, { w: 1280, h: 720 }, m);
  return out;
}

describe('HUD: the supply line', () => {
  const game = quickGame(3, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const state = game.value.state;

  it('counts down to the next drop, then says a supply crate is coming', () => {
    expect(texts(model(state)).map(([t]) => t)).toContain('SUPPLY | 3 TURNS');
    expect(texts(model({ ...state, crateDrop: 'weapon' })).map(([t]) => t)).toContain('SUPPLY INCOMING');
  });

  it('announces a power orb in gold', () => {
    const line = texts(model({ ...state, crateDrop: 'power' })).find(([t]) => t === 'POWER INCOMING');
    expect(line?.[1]).toBe(POWER_GOLD);
    // And the redraw key sees the difference, so the HUD is repainted when the orb is announced.
    expect(hudKey(model({ ...state, crateDrop: 'power' }))).not.toBe(hudKey(model({ ...state, crateDrop: 'weapon' })));
  });
});
