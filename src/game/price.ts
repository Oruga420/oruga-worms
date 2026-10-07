/**
 * What a super costs the worm that uses it, as the HUD and the aim show it: the panel badge in the
 * cell's corner and the line under the weapon's name. A fixed toll (Gear 5, the Freezer, the
 * Galaxian Explosion), a share of what the worm has (Antares), the Tesoro del Cielo's toll on
 * every strike, or the Explosión Final's: the worm itself. Null for everything free.
 */

import type { WeaponDef } from '../weapons/types.ts';

export interface SuperPrice {
  /** On the panel cell, short: -50♥, -50%♥, -15♥×3. */
  readonly badge: string;
  /** Under the weapon's name as it is picked, and in the HUD line. */
  readonly label: string;
}

export function superPrice(def: Pick<WeaponDef, 'toll' | 'tollShare' | 'technique'>): SuperPrice | null {
  if (def.toll !== undefined) return { badge: `-${def.toll}♥`, label: `COSTS ${def.toll} HP` };
  if (def.tollShare !== undefined) {
    const percent = Math.round(def.tollShare * 100);
    return { badge: `-${percent}%♥`, label: percent === 50 ? 'COSTS HALF YOUR HP' : `COSTS ${percent}% OF YOUR HP` };
  }
  if (def.technique?.kind === 'treasure') return { badge: `-${def.technique.hitToll}♥×${def.technique.hits}`, label: `COSTS ${def.technique.hitToll} HP A STRIKE` };
  if (def.technique?.kind === 'final') return { badge: '-100%♥', label: 'COSTS YOUR LIFE' };
  return null;
}
