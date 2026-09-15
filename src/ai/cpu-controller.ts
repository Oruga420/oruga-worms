/**
 * The CPU controller (architecture.md section F, ai/cpu-controller.ts): the one entry point a
 * CPU turn calls. It probes the sidecar once per match; when a backend is available it asks the
 * model, validates the answer client side, and uses it only if it passes; on any miss it falls
 * back to the deterministic heuristic. The heuristic is the floor, so the model can never make
 * the CPU play worse, and the static build with no backend always plays.
 */

import type { CpuTurnResponse } from './contract.ts';
import type { CpuClient } from './client.ts';
import { decideHeuristic, type HeuristicInput } from './heuristic.ts';
import { buildCpuRequest, type SnapshotInput } from './snapshot.ts';
import { validateResponse, type ValidWeapon } from './response-schema.ts';
import type { WeaponRegistry } from '../weapons/registry.ts';
import { isTimed } from '../weapons/registry.ts';
import type { WeaponId } from '../weapons/types.ts';

export interface CpuControllerOptions {
  readonly client: CpuClient | null;
  readonly registry: WeaponRegistry;
}

export interface CpuControllerState {
  probed: boolean;
  backendAvailable: boolean;
}

export function createCpuState(): CpuControllerState {
  return { probed: false, backendAvailable: false };
}

export interface CpuTurnDecision {
  readonly response: CpuTurnResponse;
  readonly source: 'model' | 'heuristic';
}

function validWeaponsFor(snapshot: SnapshotInput, registry: WeaponRegistry): Map<string, ValidWeapon> {
  const map = new Map<string, ValidWeapon>();
  for (const entry of snapshot.ammo) {
    const def = registry[entry.weapon];
    if (def === undefined) continue;
    map.set(entry.weapon, {
      id: entry.weapon as WeaponId,
      requiresTargetSelect: def.requiresTargetSelect,
      fuseOptionsMs: isTimed(def) && def.fuse !== undefined ? def.fuse.optionsMs : null,
      hasAmmo: entry.count !== 0,
    });
  }
  return map;
}

function nearestEnemyDx(snapshot: SnapshotInput): number | null {
  const active = snapshot.worms.find((w) => w.id === snapshot.activeWormId);
  if (active === undefined) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const worm of snapshot.worms) {
    if (!worm.alive || worm.teamId === snapshot.activeTeamId) continue;
    const d = Math.abs(worm.x - active.x);
    if (d < bestDist) {
      bestDist = d;
      best = worm.x - active.x;
    }
  }
  return best;
}

/** Decides one CPU turn. Always returns a legal response; source says whether the model was used. */
export async function decideCpuTurn(snapshot: SnapshotInput, options: CpuControllerOptions, state: CpuControllerState): Promise<CpuTurnDecision> {
  const request = buildCpuRequest(snapshot);
  const heuristicInput: HeuristicInput = {
    request,
    registry: options.registry,
    mask: snapshot.mask,
    worms: snapshot.worms.map((w) => ({ id: w.id, teamId: w.teamId, x: w.x, y: w.y, hp: w.hp, alive: w.alive })),
  };
  const fallback = (): CpuTurnDecision => ({ response: decideHeuristic(heuristicInput), source: 'heuristic' });

  if (options.client === null) return fallback();
  if (!state.probed) {
    const health = await options.client.health();
    state.probed = true;
    state.backendAvailable = health.available && health.backend !== 'off';
  }
  if (!state.backendAvailable) return fallback();

  const raw = await options.client.requestTurn(request);
  if (raw === null) return fallback();
  const validated = validateResponse(raw, validWeaponsFor(snapshot, options.registry), request.world, nearestEnemyDx(snapshot));
  if (!validated.ok) return fallback();
  return { response: validated.value, source: 'model' };
}
