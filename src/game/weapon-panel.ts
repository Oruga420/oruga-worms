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
import { WEAPONS, WEAPON_IDS, isSuper } from '../weapons/registry.ts';
import type { WeaponCategory, WeaponId } from '../weapons/types.ts';

/** Row order, top to bottom. Every category in the registry must appear here. */
export const CATEGORY_ORDER: readonly WeaponCategory[] = Object.freeze([
  'explosive',
  'firearm',
  'melee',
  'air',
  'animal',
  'anime',
  'utility',
]);

export const CATEGORY_LABELS: Readonly<Record<WeaponCategory, string>> = Object.freeze({
  explosive: 'Explosives',
  firearm: 'Firearms',
  melee: 'Melee',
  air: 'Air',
  animal: 'Animals',
  anime: 'Anime',
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
  /** False when the weapon is out of ammo, still delayed or a resting super; a click on it selects nothing. */
  readonly enabled: boolean;
  /** A super the team sits out this turn, open again on its next: drawn with a note saying so. */
  readonly resting: boolean;
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
  /** The worm used a super on its last turn, so the supers are shown resting (match/super-rest.ts). */
  readonly supersResting?: boolean;
}

function isUnlocked(id: WeaponId, turnsElapsed: number): boolean {
  return turnsElapsed >= (WEAPONS[id].delayTurns ?? 0);
}

/** Margin kept between the panel and the viewport edge. */
export const PANEL_MARGIN_PX = 8;

interface PanelMetrics {
  readonly cell: number;
  readonly gap: number;
  readonly label: number;
  readonly pad: number;
}

/** Full size first, then smaller cells for phones; the first one that fits the viewport wins. */
const PANEL_SIZES: readonly PanelMetrics[] = Object.freeze([
  { cell: CELL_PX, gap: CELL_GAP_PX, label: LABEL_W_PX, pad: PANEL_PAD_PX },
  { cell: 54, gap: 5, label: 72, pad: 10 },
  { cell: 48, gap: 4, label: 66, pad: 8 },
  { cell: 42, gap: 4, label: 62, pad: 8 },
  { cell: 36, gap: 3, label: 58, pad: 6 },
]);

/**
 * Builds the panel geometry centred in the viewport. Categories with no weapons are dropped, so
 * the panel never shows an empty row. On a desktop the whole roster sits one row per category at
 * full size; on a narrow or short screen (a phone in touch mode) the cells shrink and a long
 * category wraps onto extra lines, so every weapon stays on screen and tappable.
 */
export function layoutWeaponPanel(viewport: Size, model: PanelModel): PanelLayout {
  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    ids: WEAPON_IDS.filter((id) => WEAPONS[id].category === category),
  })).filter((group) => group.ids.length > 0);

  const widest = Math.max(1, ...byCategory.map((group) => group.ids.length));
  const measure = (m: PanelMetrics): { columns: number; w: number; h: number } => {
    const room = viewport.w - PANEL_MARGIN_PX * 2 - m.pad * 2 - m.label + m.gap;
    const columns = Math.max(1, Math.min(widest, Math.floor(room / (m.cell + m.gap))));
    const lines = byCategory.reduce((total, group) => total + Math.ceil(group.ids.length / columns), 0);
    const w = m.pad * 2 + m.label + columns * m.cell + (columns - 1) * m.gap;
    const h = m.pad * 2 + TITLE_H_PX + lines * (m.cell + ROW_GAP_PX);
    return { columns, w, h };
  };
  const fits = (size: { w: number; h: number }): boolean =>
    size.w <= viewport.w - PANEL_MARGIN_PX * 2 && size.h <= viewport.h - PANEL_MARGIN_PX * 2;
  let metrics = PANEL_SIZES[PANEL_SIZES.length - 1] as PanelMetrics;
  for (const candidate of PANEL_SIZES) {
    if (fits(measure(candidate))) {
      metrics = candidate;
      break;
    }
  }
  const { columns, w, h } = measure(metrics);
  const x = Math.max(0, Math.round((viewport.w - w) / 2));
  const y = Math.max(0, Math.round((viewport.h - h) / 2));

  let lineY = y + metrics.pad + TITLE_H_PX;
  const rows: PanelRow[] = byCategory.map((group) => {
    const rowY = lineY;
    const cells: PanelCell[] = group.ids.map((id, index) => {
      const count = model.ammo[id];
      const column = index % columns;
      const line = Math.floor(index / columns);
      const resting = model.supersResting === true && isSuper(id);
      return Object.freeze({
        id,
        name: WEAPONS[id].name,
        category: group.category,
        x: x + metrics.pad + metrics.label + column * (metrics.cell + metrics.gap),
        y: rowY + line * (metrics.cell + ROW_GAP_PX),
        w: metrics.cell,
        h: metrics.cell,
        count,
        enabled: hasAmmo(model.ammo, id) && isUnlocked(id, model.turnsElapsed) && !resting,
        resting,
      });
    });
    const lines = Math.ceil(group.ids.length / columns);
    const rowH = lines * metrics.cell + (lines - 1) * ROW_GAP_PX;
    lineY += rowH + ROW_GAP_PX;
    return Object.freeze({
      category: group.category,
      label: CATEGORY_LABELS[group.category],
      y: rowY,
      h: rowH,
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
