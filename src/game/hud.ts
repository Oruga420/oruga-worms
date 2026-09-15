/**
 * The screen space HUD (Phase 2.1, minimal placeholder skin): per team health totals, the wind
 * meter, the turn timer, the selected weapon and the charge power bar, plus a center banner for
 * turn and sudden death. Drawn on the HUD canvas, redrawn only when a value changes (the caller
 * keys the dirty flag).
 */

import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import type { MatchState } from '../match/state.ts';
import { activeTeamOf, activeWormOf } from '../match/ledger.ts';
import type { AimState } from './aim.ts';
import { ammoBadge, type PanelLayout } from './weapon-panel.ts';
import { drawSprite } from '../engine/sprite.ts';
import { SPRITE_SCALE } from '../config/units.ts';
import { WEAPONS } from '../weapons/registry.ts';
import type { CharacterSprites } from './render.ts';
import type { WeaponId } from '../weapons/types.ts';

const TEAM_COLORS = ['#e05a4d', '#4d8fe0', '#57b85a', '#d9b23a'] as const;

function teamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? '#e05a4d';
}

function teamTotalHp(state: MatchState, teamIndex: number): number {
  return state.teams[teamIndex]?.worms.reduce((sum, worm) => sum + Math.max(0, worm.hp), 0) ?? 0;
}

export interface HudModel {
  readonly state: MatchState;
  readonly aim: AimState;
  readonly weapon: WeaponId;
  readonly fuseMs?: number | null;
  readonly dropEveryTurns?: number;
  readonly jetpackFuelMs?: number | null;
  readonly banner: string | null;
  /** Whole movement steps left this turn, and the per turn total from the match config. */
  readonly steps: number;
  readonly stepsTotal: number;
  /** The open weapon panel, or null when closed. */
  readonly panel: PanelLayout | null;
  /** The weapon atlas for the panel icons; null falls back to the letter glyphs. */
  readonly weaponSprites: CharacterSprites | null;
}

export function hudKey(model: HudModel): string {
  const totals = model.state.teams.map((_, i) => teamTotalHp(model.state, i)).join(',') + `|fuel:${model.jetpackFuelMs == null ? '-' : Math.ceil(model.jetpackFuelMs / 100)}`;
  // The panel's cells change with ammo, which the totals do not track, so the key carries the
  // per cell enabled flags whenever it is open; a closed panel is a single character.
  const panel = model.panel === null ? '-' : model.panel.rows.flatMap((row) => row.cells.map((cell) => `${cell.id}:${cell.count}:${cell.enabled ? 1 : 0}`)).join(',');
  return `${activeWormOf(model.state)?.id}|${activeWormOf(model.state)?.ammo[model.weapon]}|${model.dropEveryTurns ?? 3}|${model.state.crateDrop}|${model.state.turnsSinceCrateDrop}|${model.state.phase}|${totals}|${model.state.wind.step}|${Math.ceil(model.state.timers.turnRemainingMs / 1000)}|${model.weapon}|${model.fuseMs ?? ""}|${Math.round(model.aim.power * 20)}|${model.banner ?? ''}|${model.steps}|${panel}`;
}

export function drawHud(ctx: Ctx2D, viewport: Size, model: HudModel): void {
  const { state } = model;
  // Team health bars, top left.
  const barW = 160;
  const maxTotal = Math.max(1, ...state.teams.map((_, i) => teamTotalHp(state, i)));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '13px system-ui, sans-serif';
  state.teams.forEach((team, i) => {
    const y = 16 + i * 24;
    const total = teamTotalHp(state, i);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(12, y, barW, 16);
    ctx.fillStyle = teamColor(team.colorIndex);
    ctx.fillRect(12, y, barW * (total / maxTotal), 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${team.name}  ${total}`, 18, y + 8);
  });

  // Turn timer, top center.
  const seconds = Math.ceil(state.timers.turnRemainingMs / 1000);
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillStyle = seconds <= 5 && state.phase === 'Active' ? '#ff5030' : '#fff';
  if (state.phase === 'Active' || state.phase === 'Firing' || state.phase === 'Retreat') ctx.fillText(String(Math.max(0, seconds)), viewport.w / 2, 24);

  // Wind meter, top right.
  const wx = viewport.w - 130;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(wx, 14, 116, 18);
  const mid = wx + 58;
  ctx.fillStyle = state.wind.step >= 0 ? '#5ac8fa' : '#ff9f43';
  const wlen = (state.wind.step / 10) * 54;
  ctx.fillRect(wlen >= 0 ? mid : mid + wlen, 18, Math.abs(wlen), 10);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('WIND', mid, 40);
  ctx.fillText(state.crateDrop !== null ? 'SUPPLY INCOMING' : `SUPPLY | ${Math.max(0, (model.dropEveryTurns ?? 3) - state.turnsSinceCrateDrop)} TURNS`, mid, 56);

  // Weapon and power, bottom left.
  const activeIsHuman = activeTeamOf(state)?.controller === 'human';
  ctx.textAlign = 'left';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  const owner = activeWormOf(state);
  ctx.fillText(`${owner?.name ?? "Worm"} | ${model.weapon} | ${ammoBadge(owner?.ammo[model.weapon] ?? 0) || "unlimited"}${model.fuseMs == null ? "" : ` | fuse ${model.fuseMs / 1000}s`}`, 12, viewport.h - 40);
  // Movement budget, to the right of the weapon name; red once it is spent.
  const stepsTotal = model.stepsTotal;
  ctx.fillStyle = model.steps === 0 && state.phase === 'Active' ? '#ff5030' : '#ffd36a';
  ctx.fillText(`Steps ${model.steps}/${stepsTotal}`, 12, viewport.h - 58);
  if (model.jetpackFuelMs != null) {
    ctx.fillStyle = '#7fd1ff';
    ctx.fillText(`JETPACK | fuel ${(model.jetpackFuelMs / 1000).toFixed(1)}s | Hold Up / W / Enter to lift; Left / Right to steer`, 12, viewport.h - 80, viewport.w - 24);
  }
  if (activeIsHuman) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(12, viewport.h - 26, 200, 12);
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(12, viewport.h - 26, 200 * model.aim.power, 12);
  }

  if (model.panel !== null) drawWeaponPanel(ctx, model.panel, model.weapon, model.weaponSprites, activeWormOf(state)?.name ?? 'Worm');

  // Center banner.
  if (model.banner !== null) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px system-ui, sans-serif';
    const text = model.banner;
    const tw = text.length * 28 * 0.6 + 32;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(viewport.w / 2 - tw / 2, viewport.h / 2 - 26, tw, 44);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, viewport.w / 2, viewport.h / 2 - 2);
  }
}

/** Two or three letter glyph for a weapon until the icon atlas exists: "Tank Cannon" reads "TC". */
function weaponGlyph(name: string): string {
  const initials = name.split(/\s+/).map((word) => word[0] ?? '').join('');
  return (initials.length >= 2 ? initials : name.slice(0, 2)).toUpperCase().slice(0, 3);
}

/**
 * The weapon panel: a dark card, one labelled row per category, one cell per weapon with a
 * glyph, the ammo badge and the short name. The selected weapon gets a gold frame, an empty or
 * locked one is dimmed. Geometry comes from the layout only; nothing here computes a rect.
 */
function drawWeaponPanel(ctx: Ctx2D, panel: PanelLayout, selected: WeaponId, sprites: CharacterSprites | null, owner: string): void {
  ctx.fillStyle = 'rgba(12, 16, 24, 0.88)';
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(`INVENTORY | ${owner}`, panel.x + 14, panel.y + 22);
  ctx.textAlign = 'right';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Shift+Q or Tab closes', panel.x + panel.w - 14, panel.y + 22);

  for (const row of panel.rows) {
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(row.label, panel.x + 14, row.y + row.h / 2);

    for (const cell of row.cells) {
      const isSelected = cell.id === selected;
      ctx.fillStyle = cell.enabled ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      if (isSelected) {
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.strokeRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2);
      }
      const alpha = cell.enabled ? 1 : 0.35;
      // The generated icon when the weapon atlas has it; the letter glyph until then.
      const iconFrame = sprites === null ? undefined : sprites.atlas.frame(WEAPONS[cell.id].icon);
      if (iconFrame !== undefined && sprites !== null) {
        // frameUnit divides the zoom by SPRITE_SCALE, so a 64 px cell icon drawn at zoom
        // SPRITE_SCALE * k lands at 64 * k css px; k fits it inside the cell with a margin.
        const k = (cell.w - 14) / iconFrame.sourceSize.w;
        drawSprite(ctx, sprites.image, iconFrame, sprites.atlas.pivotOf(iconFrame), {
          x: cell.x + cell.w / 2,
          y: cell.y + cell.h / 2 - 6,
          zoom: SPRITE_SCALE * k,
          alpha,
        });
      } else {
        ctx.textAlign = 'center';
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillText(weaponGlyph(cell.name), cell.x + cell.w / 2, cell.y + cell.h / 2 - 8);
      }
      ctx.textAlign = 'center';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.85})`;
      ctx.fillText(cell.name, cell.x + cell.w / 2, cell.y + cell.h - 9, cell.w - 4);
      const badge = ammoBadge(cell.count);
      if (badge !== '') {
        ctx.textAlign = 'right';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillStyle = cell.enabled ? '#ffd36a' : 'rgba(255,211,106,0.4)';
        ctx.fillText(badge, cell.x + cell.w - 4, cell.y + 8);
      }
    }
  }
}
