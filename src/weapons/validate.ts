/**
 * Registry invariants (architecture.md section D), run at boot and in the tests: every kind has
 * its spec block, fuses are consistent, cluster children never cluster again and never name a
 * registry weapon, sprites are named, every number is finite and non negative (ammo may be -1),
 * infinite weapons never drop from crates, multi shot weapons do not end the turn early, charged
 * weapons have a launch speed, keys match ids, the panel is complete, and the sidecar metadata
 * table (sidecar/weapon-meta.ts) agrees on target selection and fuse options so the two sources
 * cannot drift.
 */

import { err, ok, type Result } from '../core/result.ts';
import { CPU_WEAPON_META } from '../../sidecar/weapon-meta.ts';
import type { SanitizeWeaponInfo } from '../../sidecar/sanitize.ts';
import type { WeaponRegistry } from './registry.ts';
import { PANEL_WEAPON_IDS, type ClusterSpec, type FuseSpec, type WeaponDef, type WeaponKind } from './types.ts';

type Rec = Readonly<Record<string, unknown>>;

const REQUIRED_SPECS: Readonly<Record<WeaponKind, readonly (keyof WeaponDef)[]>> = Object.freeze({
  PROJECTILE: ['projectile', 'blast'],
  TIMED: ['fuse', 'projectile', 'blast'],
  HITSCAN: ['hitscan'],
  MELEE: ['melee'],
  PLACED: [],
  TARGETED: ['strike'],
  ANIMAL: ['spawn'],
  UTILITY: ['utility'],
});

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every numeric leaf must be finite and non negative; `ammo` alone may be -1. */
function checkNumbers(id: string, value: unknown, path: string, out: string[]): void {
  if (typeof value === 'number') {
    const leaf = path.split('.').at(-1) ?? path;
    const allowed = leaf === 'ammo' ? value === -1 || value >= 0 : value >= 0;
    if (!Number.isFinite(value) || !allowed) out.push(`${id}: ${path} must be a finite non negative number (ammo may be -1), got ${String(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkNumbers(id, item, `${path}[${index}]`, out));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) checkNumbers(id, child, path === '' ? key : `${path}.${key}`, out);
  }
}

function checkKindSpecs(id: string, def: WeaponDef, out: string[]): void {
  for (const spec of REQUIRED_SPECS[def.kind] ?? []) {
    if ((def as unknown as Rec)[spec] === undefined) out.push(`${id}: kind ${def.kind} requires a ${spec} block`);
  }
  if (def.kind === 'PLACED' && def.fuse === undefined && def.spawn === undefined) {
    out.push(`${id}: kind PLACED requires a fuse (dynamite) or a spawn block (mine)`);
  }
  if (def.spawn !== undefined) {
    const expected = def.kind === 'ANIMAL' ? 'sheep' : def.kind === 'PLACED' ? 'mine' : null;
    if (expected !== null && def.spawn.entityType !== expected) out.push(`${id}: spawn.entityType ${String(def.spawn.entityType)} does not match kind ${def.kind}`);
  }
}

function checkFuse(id: string, fuse: FuseSpec | undefined, out: string[]): void {
  if (fuse === undefined) return;
  if (!Array.isArray(fuse.optionsMs) || fuse.optionsMs.length === 0) out.push(`${id}: fuse.optionsMs must list at least one option`);
  else if (!fuse.optionsMs.includes(fuse.defaultMs)) out.push(`${id}: fuse.defaultMs ${fuse.defaultMs} is not one of fuse.optionsMs`);
  if (!fuse.selectable && fuse.optionsMs.length > 1) out.push(`${id}: fuse is not selectable but offers ${fuse.optionsMs.length} options`);
}

function checkCluster(id: string, cluster: ClusterSpec | undefined, registryIds: ReadonlySet<string>, out: string[]): void {
  if (cluster === undefined) return;
  if (!Number.isFinite(cluster.count) || cluster.count < 1) out.push(`${id}: cluster.count must be at least 1`);
  const child = cluster.childWeaponId;
  if (child !== undefined && registryIds.has(child)) out.push(`${id}: cluster.childWeaponId ${child} names a registry weapon (children are nested, never a panel id)`);
  if (!isRecord(cluster.childProjectile)) out.push(`${id}: cluster.childProjectile is missing`);
  else if ('cluster' in cluster.childProjectile) out.push(`${id}: cluster child carries its own cluster (children never cluster again)`);
  if (!isRecord(cluster.childBlast)) out.push(`${id}: cluster.childBlast is missing`);
}

function checkRow(id: string, def: WeaponDef, registryIds: ReadonlySet<string>, out: string[]): void {
  if (def.id !== id) out.push(`${id}: def id ${def.id} does not match its key ${id}`);
  if (typeof def.icon !== 'string' || def.icon.length === 0) out.push(`${id}: icon must be a non empty atlas frame id`);
  if (def.heldSprite !== null && (typeof def.heldSprite !== 'string' || def.heldSprite.length === 0)) out.push(`${id}: heldSprite must be a non empty frame id or null`);
  if (typeof def.name !== 'string' || def.name.length === 0) out.push(`${id}: name must be non empty`);
  if (typeof def.sfx?.fire !== 'string' || def.sfx.fire.length === 0) out.push(`${id}: sfx.fire must be non empty`);
  checkNumbers(id, def, '', out);
  if (Number.isFinite(def.ammo) && def.ammo < -1) out.push(`${id}: ammo may be -1 (infinite) or a count, got ${def.ammo}`);
  if (def.ammo === -1 && def.crateWeight > 0) out.push(`${id}: crateWeight must be 0 for an infinite weapon`);
  if (def.shotsPerTurn > 1 && def.endsTurnOnFire) out.push(`${id}: endsTurnOnFire must be false for a ${def.shotsPerTurn} shot weapon`);
  if (def.charged && !(def.maxPower > 0)) out.push(`${id}: maxPower must be positive for a charged weapon`);
  checkKindSpecs(id, def, out);
  checkFuse(id, def.fuse, out);
  checkCluster(id, def.cluster, registryIds, out);
}

function sameOptions(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function checkSidecar(registry: WeaponRegistry, meta: Readonly<Record<string, SanitizeWeaponInfo>>, out: string[]): void {
  const ids = new Set<string>(Object.keys(registry));
  for (const id of Object.keys(meta)) if (!ids.has(id)) out.push(`${id}: present in the sidecar table but not in the registry`);
  for (const [id, def] of Object.entries(registry) as [string, WeaponDef][]) {
    const info = meta[id];
    if (info === undefined) {
      out.push(`${id}: missing from the sidecar table`);
      continue;
    }
    if (info.requiresTargetSelect !== def.requiresTargetSelect) out.push(`${id}: sidecar requiresTargetSelect ${String(info.requiresTargetSelect)} disagrees with the registry`);
    const isTimed = def.kind === 'TIMED';
    if (isTimed) {
      if (!sameOptions(info.fuseOptionsMs, def.fuse?.optionsMs ?? null)) out.push(`${id}: sidecar fuseOptionsMs disagree with the registry fuse`);
      if (info.fuseDefaultMs !== (def.fuse?.defaultMs ?? null)) out.push(`${id}: sidecar fuseDefaultMs disagrees with the registry fuse`);
    } else if (info.fuseOptionsMs !== null) {
      out.push(`${id}: sidecar exposes a fuse for a weapon that is not TIMED`);
    }
  }
}

/** Runs every invariant and returns all messages at once so a broken row is fixed in one pass. */
export function validateRegistry(registry: WeaponRegistry, meta: Readonly<Record<string, SanitizeWeaponInfo>> = CPU_WEAPON_META): Result<void, readonly string[]> {
  const out: string[] = [];
  const keys = Object.keys(registry);
  const panel = new Set<string>(PANEL_WEAPON_IDS);
  for (const id of PANEL_WEAPON_IDS) if (!(id in registry)) out.push(`${id}: panel id missing from the registry`);
  for (const key of keys) if (!panel.has(key)) out.push(`${key}: unknown key, not a panel id`);
  const registryIds = new Set<string>(keys);
  for (const [id, def] of Object.entries(registry) as [string, WeaponDef][]) {
    if (!isRecord(def)) {
      out.push(`${id}: def is not an object`);
      continue;
    }
    checkRow(id, def, registryIds, out);
  }
  checkSidecar(registry, meta, out);
  return out.length === 0 ? ok(undefined) : err(Object.freeze(out));
}
