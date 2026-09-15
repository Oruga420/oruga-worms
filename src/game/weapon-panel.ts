/**
 * Weapon panel layout and hit test (pure). Shift+Q (or Tab) opens the panel and a click picks a
 * weapon, which is the only way to reach the whole roster: the F1..F9 slot binds cover just the
 * first nine ids, so most of the registry was unreachable from the keyboard alone.
 *
 * One row per weapon category in CATEGORY_ORDER, weapons in registry panel order inside their
 * row, which keeps the layout stable when a weapon is added: a new explosive lands at the end of
 * the explosive row rather than reshuffling every cell.
 *
 * This module owns every rectangle. The HUD only draws what layoutWeaponPanel returns and the
 * pointer is resolved by hitTestWeaponPanel against the same layout, so what the player sees and
 * what a click selects cannot drift apart.
 */

import type { Size } from '../engine/canvas-types.ts';
import type { AmmoLedger } from '../weapons/ammo.ts';
import { INFINITE_AMMO, hasAmmo } from '../weapons/ammo.ts';
import { WEAPONS, WEAPON_IDS } from '../weapons/registry.ts';
import type { WeaponCategory, WeaponId } from '../weapons/types.ts';

/** Row order, top to bottom. Every category in the registry must appear here. */
export const CATEGORY_ORDER: readonly WeaponCategory[] = Object.freeze([
  'explosive',
  'firearm',
  'melee',
  'air',
  'animal',
  'utility',
]);

export const CATEGORY_LABELS: Readonly<Record<WeaponCategory, string>> = Object.freeze({
  explosive: 'Explosives',
  firearm: 'Firearms',
  melee: 'Melee',
  air: 'Air',
  animal: 'Animals',
  utility: 'Utility',
});

export const CELL_PX = 62;
export const CELL_GAP_PX = 6;
export const LABEL_W_PX = 84;
export const ROW_GAP_PX = 4;
export const PANEL_PAD_PX = 14;
export const TITLE_H_PX = 26;

export interface PanelCell {
  readonly id: WeaponId;
  readonly name: string;
  readonly category: WeaponCategory;
  /** Screen px, panel space is screen space: the panel is drawn on the HUD canvas. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Ammo left; INFINITE_AMMO renders as an infinity glyph. */
  readonly count: number;
  /** False when the weapon is out of ammo or still delayed; a click on it selects nothing. */
  readonly enabled: boolean;
}

export interface PanelRow {
  readonly category: WeaponCategory;
  readonly label: string;
  readonly y: number;
  readonly h: number;
  readonly cells: readonly PanelCell[];
}

export interface PanelLayout {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rows: readonly PanelRow[];
}

export interface PanelModel {
  readonly ammo: AmmoLedger;
  /** Turns played so far; a weapon with delayTurns above this is shown locked. */
  readonly turnsElapsed: number;
}

function isUnlocked(id: WeaponId, turnsElapsed: number): boolean {
  return turnsElapsed >= (WEAPONS[id].delayTurns ?? 0);
}

/**
 * Builds the panel geometry centred in the viewport. Categories with no weapons are dropped, so
 * the panel never shows an empty row.
 */
export function layoutWeaponPanel(viewport: Size, model: PanelModel): PanelLayout {
  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    ids: WEAPON_IDS.filter((id) => WEAPONS[id].category === category),
  })).filter((group) => group.ids.length > 0);

  const columns = Math.max(1, ...byCategory.map((group) => group.ids.length));
  const rowH = CELL_PX + ROW_GAP_PX;
  const gridW = columns * CELL_PX + (columns - 1) * CELL_GAP_PX;
  const w = PANEL_PAD_PX * 2 + LABEL_W_PX + gridW;
  const h = PANEL_PAD_PX * 2 + TITLE_H_PX + byCategory.length * rowH;
  const x = Math.round((viewport.w - w) / 2);
  const y = Math.round((viewport.h - h) / 2);

  const rows: PanelRow[] = byCategory.map((group, rowIndex) => {
    const rowY = y + PANEL_PAD_PX + TITLE_H_PX + rowIndex * rowH;
    const cells: PanelCell[] = group.ids.map((id, columnIndex) => {
      const count = model.ammo[id];
      return Object.freeze({
        id,
        name: WEAPONS[id].name,
        category: group.category,
        x: x + PANEL_PAD_PX + LABEL_W_PX + columnIndex * (CELL_PX + CELL_GAP_PX),
        y: rowY,
        w: CELL_PX,
        h: CELL_PX,
        count,
        enabled: hasAmmo(model.ammo, id) && isUnlocked(id, model.turnsElapsed),
      });
    });
    return Object.freeze({
      category: group.category,
      label: CATEGORY_LABELS[group.category],
      y: rowY,
      h: CELL_PX,
      cells: Object.freeze(cells),
    });
  });

  return Object.freeze({ x, y, w, h, rows: Object.freeze(rows) });
}

/** The weapon under a screen point, or null for a miss, a gap or a disabled cell. */
export function hitTestWeaponPanel(layout: PanelLayout, point: { readonly x: number; readonly y: number }): WeaponId | null {
  for (const row of layout.rows) {
    for (const cell of row.cells) {
      const inside = point.x >= cell.x && point.x < cell.x + cell.w && point.y >= cell.y && point.y < cell.y + cell.h;
      if (inside) return cell.enabled ? cell.id : null;
    }
  }
  return null;
}

/** True when the point is anywhere on the panel, so a click there never also aims or fires. */
export function isInsideWeaponPanel(layout: PanelLayout, point: { readonly x: number; readonly y: number }): boolean {
  return point.x >= layout.x && point.x < layout.x + layout.w && point.y >= layout.y && point.y < layout.y + layout.h;
}

/** Every cell, flattened in row order; the HUD and the tests both iterate this. */
export function panelCells(layout: PanelLayout): readonly PanelCell[] {
  return Object.freeze(layout.rows.flatMap((row) => row.cells));
}

/** Ammo badge text: empty for infinite ammo, the count otherwise. */
export function ammoBadge(count: number): string {
  return count === INFINITE_AMMO ? '' : String(count);
}
