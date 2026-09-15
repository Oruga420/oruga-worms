/**
 * Simulation bodies and the events the sim emits toward the match reducer, the audio mixer and
 * the particle system. Bodies are MUTABLE on purpose: they live in the 60 Hz hot path and are
 * pooled or reused across ticks (architecture.md section E: mutation in the tick loop,
 * immutability in the ledger). Nothing here is a MatchState; the match layer converts events.
 */

import type { BlastSpec, ClusterSpec, ProjectileSpec, SpawnSpec } from '../weapons/types.ts';

export type WormMotion = 'idle' | 'walking' | 'jumping' | 'falling' | 'flying' | 'parachuting' | 'jetpacking' | 'drowning' | 'dead';

export interface WormBody {
  readonly id: string;
  readonly teamId: string;
  /** Feet position, world px. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  motion: WormMotion;
  onGround: boolean;
  /** Feet y when the current fall started; fall damage reads the landing speed, this is for the log. */
  fallStartY: number;
  /** The first landing after a blast is free (Worms rule); set by the explosion, cleared on landing. */
  exemptNextLanding: boolean;
  restTicks: number;
  alive: boolean;
  /** Jetpack fuel left in ms while jetpacking. */
  fuelMs: number;
  drownTicks: number;
}

export type ProjectileKind = 'projectile' | 'cluster_child' | 'strike_bomb';

export interface ProjectileBody {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly weaponId: string;
  readonly ownerTeamId: string | null;
  readonly ownerWormId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly spec: ProjectileSpec;
  readonly blast: BlastSpec;
  readonly cluster: ClusterSpec | null;
  readonly windAffected: boolean;
  readonly gravityScale: number;
  /** Ticks left on the fuse; -1 means no fuse (contact or timeout detonation). */
  fuseTicks: number;
  readonly restBeforeDetonate: boolean;
  lifeTicks: number;
  ageTicks: number;
  homingTarget: { readonly x: number; readonly y: number } | null;
  restTicks: number;
  alive: boolean;
  /** Set by a nearby blast when the spec allows chain reactions; detonated on the next step. */
  chainTriggered: boolean;
}

export type CrateKind = 'weapon' | 'health' | 'utility';

export interface CrateBody {
  readonly id: number;
  readonly kind: CrateKind;
  x: number;
  y: number;
  landed: boolean;
  /** The first landing has registered this crate in the match ledger. */
  counted: boolean;
  alive: boolean;
}

export interface MineBody {
  readonly id: number;
  readonly ownerTeamId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly spec: SpawnSpec;
  readonly blast: BlastSpec;
  armed: boolean;
  fuseTicks: number;
  /** Ticks the owner is immune after placing it, so the placer can walk away. */
  graceTicks: number;
  alive: boolean;
  dud: boolean;
}

export interface SheepBody {
  readonly id: number;
  readonly ownerTeamId: string | null;
  readonly ownerWormId: string | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  readonly spec: SpawnSpec;
  readonly blast: BlastSpec;
  lifeTicks: number;
  hopTicks: number;
  onGround: boolean;
  alive: boolean;
  detonateRequested: boolean;
}

export type SimEvent =
  | { readonly type: 'damage'; readonly wormId: string; readonly amount: number; readonly sourceTeamId: string | null; readonly sourceWormId: string | null; readonly cause: 'blast' | 'fall' | 'hit' | 'melee' }
  | { readonly type: 'drown'; readonly wormId: string }
  | { readonly type: 'activity'; readonly kind: 'bounce' | 'carve' | 'spawn' }
  | { readonly type: 'explosion'; readonly x: number; readonly y: number; readonly radius: number; readonly particle: BlastSpec['particle']; readonly shake: number }
  | { readonly type: 'sound'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'crateLanded'; readonly crateId: number; readonly kind: CrateKind; readonly x: number; readonly y: number }
  | { readonly type: 'cratePicked'; readonly crateId: number; readonly kind: CrateKind; readonly wormId: string }
  | { readonly type: 'crateDestroyed'; readonly crateId: number; readonly wasCounted: boolean }
  | { readonly type: 'landed'; readonly wormId: string; readonly speed: number }
  | { readonly type: 'projectileGone'; readonly projectileId: number; readonly reason: 'exploded' | 'water' | 'bounds' | 'timeout' };

export interface WormIntent {
  readonly moveX: -1 | 0 | 1;
  readonly jump: boolean;
  readonly backflip: boolean;
  /** Jump key held: upward thrust while the worm is on a jetpack, ignored otherwise. */
  readonly thrust: boolean;
}

export const IDLE_INTENT: WormIntent = Object.freeze({ moveX: 0, jump: false, backflip: false, thrust: false });
