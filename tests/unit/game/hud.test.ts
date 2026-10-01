import { describe, expect, it } from 'vitest';
import { INITIAL_AIM } from '@/game/aim.ts';
import { drawHud, hudKey, tollBadge, type HudModel } from '@/game/hud.ts';
import { layoutWeaponPanel } from '@/game/weapon-panel.ts';
import { createLedger } from '@/weapons/ammo.ts';
import { WEAPONS } from '@/weapons/registry.ts';
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

describe('HUD: the price of the one hit kills', () => {
  const game = quickGame(3, createFakeFactory().factory, { w: 1200, h: 500 });
  if (!game.ok) throw new Error(game.error.message);
  const state = game.value.state;

  it('says what the picked super costs on the weapon line, and nothing for a free one', () => {
    expect(texts({ ...model(state), weapon: 'gear_five' }).some(([t]) => t.endsWith('| costs 50 hp'))).toBe(true);
    expect(texts({ ...model(state), weapon: 'freezer' }).some(([t]) => t.endsWith('| costs 50 hp'))).toBe(true);
    expect(texts({ ...model(state), weapon: 'kamehameha' }).some(([t]) => t.includes('costs'))).toBe(false);
  });

  it('marks the cells of the supers with a price with it, and only them', () => {
    const panel = layoutWeaponPanel({ w: 1280, h: 720 }, { ammo: createLedger(WEAPONS), turnsElapsed: 10 });
    const written = texts({ ...model(state), panel }).map(([t]) => t);
    expect(tollBadge(50)).toBe('-50♥');
    // Gear 5, the Freezer and the Galaxian Explosion: 50 each.
    expect(written.filter((t) => t === '-50♥')).toHaveLength(3);
    expect(WEAPONS.gear_five.toll).toBe(50);
    expect(WEAPONS.freezer.toll).toBe(50);
    expect(Object.values(WEAPONS).filter((def) => def.toll !== undefined).map((def) => def.id).sort()).toEqual(['freezer', 'galaxian', 'gear_five']);
    // Antares, half of what its user has; the Tesoro del Cielo, 15 a strike, three strikes.
    expect(written.filter((t) => t === '-50%♥')).toHaveLength(1);
    expect(written.filter((t) => t === '-15♥×3')).toHaveLength(1);
  });
});
