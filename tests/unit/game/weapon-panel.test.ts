import { describe, expect, it } from 'vitest';
import { createLedger, INFINITE_AMMO } from '@/weapons/ammo.ts';
import { WEAPONS, WEAPON_IDS } from '@/weapons/registry.ts';
import {
  CATEGORY_ORDER,
  ammoBadge,
  hitTestWeaponPanel,
  isInsideWeaponPanel,
  layoutWeaponPanel,
  panelCells,
  type PanelCell,
} from '@/game/weapon-panel.ts';

const VIEWPORT = { w: 1280, h: 720 };

function overlaps(a: PanelCell, b: PanelCell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('weapon panel layout', () => {
  const ledger = createLedger(WEAPONS);
  const layout = layoutWeaponPanel(VIEWPORT, { ammo: ledger, turnsElapsed: 0 });
  const cells = panelCells(layout);

  it('shows every registry weapon exactly once, so nothing is unreachable from the panel', () => {
    expect(cells.map((cell) => cell.id).sort()).toEqual([...WEAPON_IDS].sort());
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(WEAPON_IDS.length);
  });

  it('orders rows by CATEGORY_ORDER and keeps panel order inside a row', () => {
    const rowCategories = layout.rows.map((row) => row.category);
    const expected = CATEGORY_ORDER.filter((category) => WEAPON_IDS.some((id) => WEAPONS[id].category === category));
    expect(rowCategories).toEqual(expected);
    for (const row of layout.rows) {
      const ids = row.cells.map((cell) => cell.id);
      const inPanelOrder = WEAPON_IDS.filter((id) => WEAPONS[id].category === row.category);
      expect(ids).toEqual(inPanelOrder);
    }
  });

  it('never lets two cells overlap and keeps every cell inside the card', () => {
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i];
        const b = cells[j];
        if (a === undefined || b === undefined) throw new Error('cell missing');
        expect(overlaps(a, b)).toBe(false);
      }
    }
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(layout.x);
      expect(cell.y).toBeGreaterThanOrEqual(layout.y);
      expect(cell.x + cell.w).toBeLessThanOrEqual(layout.x + layout.w);
      expect(cell.y + cell.h).toBeLessThanOrEqual(layout.y + layout.h);
    }
  });

  it('is centred in the viewport', () => {
    expect(Math.abs(layout.x + layout.w / 2 - VIEWPORT.w / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.y + layout.h / 2 - VIEWPORT.h / 2)).toBeLessThanOrEqual(1);
  });

  it('carries the ledger count and enables only weapons with ammo that are not delayed', () => {
    for (const cell of cells) {
      expect(cell.count).toBe(ledger[cell.id]);
      const hasAmmo = ledger[cell.id] === INFINITE_AMMO || ledger[cell.id] > 0;
      // The jetpack has ammo but a scheme delay, so at turn 0 it is stocked yet locked.
      const unlocked = (WEAPONS[cell.id].delayTurns ?? 0) <= 0;
      expect(cell.enabled).toBe(hasAmmo && unlocked);
    }
    // The minigun is crate only, so it starts greyed out; the bazooka is infinite, so it is live.
    expect(cells.find((cell) => cell.id === 'minigun')?.enabled).toBe(false);
    expect(cells.find((cell) => cell.id === 'bazooka')?.enabled).toBe(true);
  });

  it('keeps a delayed weapon locked until its turn arrives', () => {
    const delayed = WEAPON_IDS.find((id) => (WEAPONS[id].delayTurns ?? 0) > 0);
    if (delayed === undefined) return;
    const delay = WEAPONS[delayed].delayTurns ?? 0;
    const stocked = { ...ledger, [delayed]: 1 };
    const early = panelCells(layoutWeaponPanel(VIEWPORT, { ammo: stocked, turnsElapsed: delay - 1 }));
    const late = panelCells(layoutWeaponPanel(VIEWPORT, { ammo: stocked, turnsElapsed: delay }));
    expect(early.find((cell) => cell.id === delayed)?.enabled).toBe(false);
    expect(late.find((cell) => cell.id === delayed)?.enabled).toBe(true);
  });
});

describe('weapon panel hit test', () => {
  const ledger = createLedger(WEAPONS);
  const layout = layoutWeaponPanel(VIEWPORT, { ammo: ledger, turnsElapsed: 0 });
  const cells = panelCells(layout);

  it('returns the weapon under the pointer for every enabled cell', () => {
    for (const cell of cells.filter((c) => c.enabled)) {
      expect(hitTestWeaponPanel(layout, { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 })).toBe(cell.id);
      // Corners inclusive at the origin, exclusive at the far edge.
      expect(hitTestWeaponPanel(layout, { x: cell.x, y: cell.y })).toBe(cell.id);
      expect(hitTestWeaponPanel(layout, { x: cell.x + cell.w, y: cell.y + cell.h })).not.toBe(cell.id);
    }
  });

  it('returns null on a greyed out cell so an empty weapon cannot be selected', () => {
    const empty = cells.find((cell) => !cell.enabled);
    if (empty === undefined) throw new Error('expected at least one empty weapon in the default ledger');
    expect(hitTestWeaponPanel(layout, { x: empty.x + 2, y: empty.y + 2 })).toBeNull();
    expect(isInsideWeaponPanel(layout, { x: empty.x + 2, y: empty.y + 2 })).toBe(true);
  });

  it('returns null in the gaps, on the labels and outside the card', () => {
    const first = cells[0];
    if (first === undefined) throw new Error('no cells');
    // Just left of the first cell is the category label column.
    expect(hitTestWeaponPanel(layout, { x: first.x - 2, y: first.y + 2 })).toBeNull();
    expect(isInsideWeaponPanel(layout, { x: first.x - 2, y: first.y + 2 })).toBe(true);
    expect(hitTestWeaponPanel(layout, { x: -1, y: -1 })).toBeNull();
    expect(isInsideWeaponPanel(layout, { x: -1, y: -1 })).toBe(false);
    expect(hitTestWeaponPanel(layout, { x: layout.x + layout.w + 5, y: layout.y + 5 })).toBeNull();
  });
});

describe('ammo badge', () => {
  it('hides infinite ammo and prints a count otherwise', () => {
    expect(ammoBadge(INFINITE_AMMO)).toBe('');
    expect(ammoBadge(0)).toBe('0');
    expect(ammoBadge(3)).toBe('3');
  });
});
