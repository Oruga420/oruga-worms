/**
 * Match events: everything the game loop, the sim and the HUD may tell the reducer
 * (architecture.md section E). Discriminated on `type`, like the rest of the codebase, so the
 * crate events carry their crate kind in `crate` rather than in a second `type` field.
 *
 * Who sends what:
 * - the loop: TimerTick every frame, BannerDone when a presentation phase finished showing;
 * - the sim: FireStarted, FireCompleted, RetreatDone, ActivityPing, DamageApplied, WormDied,
 *   WormDrowned, WormSpawned, WormSealed, AllBodiesAtRest, CrateLanded, CratePicked, CrateDestroyed;
 * - the input layer or the CPU: SkipTurn, Surrender;
 * - replays: WindRolled, to pin the wind instead of drawing it from the match rng.
 */

import type { WeaponId } from '../weapons/types.ts';
import type { CrateType } from './state.ts';

export const ACTIVITY_KINDS = ['bounce', 'carve', 'spawn'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** 'skip' is the player's Skip Go; 'lostControl' is fall damage or any sim rule that ends the turn. */
export type SkipReason = 'skip' | 'lostControl';

export interface TimerTickEvent {
  readonly type: 'TimerTick';
  readonly dtMs: number;
  /**
   * True while a parachute or jetpack descent is in progress: the Resolving inactivity timer
   * does not advance on such ticks (tuning card), the absolute ceiling still does.
   */
  readonly controlledDescent?: boolean;
}

export interface BannerDoneEvent {
  readonly type: 'BannerDone';
}

export interface FireStartedEvent {
  readonly type: 'FireStarted';
  readonly weaponId: WeaponId;
  /** Shots left in this turn after this one: 1 after the first shotgun barrel, 0 otherwise. */
  readonly shotsRemaining: number;
}

export interface FireCompletedEvent {
  readonly type: 'FireCompleted';
  /** The worm is on a controlled descent when the shot ends: the air retreat window applies. */
  readonly airborne?: boolean;
  /** A utility that does not end the turn (jetpack, parachute, girder): back to Active, no retreat. */
  readonly keepsTurn?: boolean;
}

export interface RetreatDoneEvent {
  readonly type: 'RetreatDone';
}

export interface ActivityPingEvent {
  readonly type: 'ActivityPing';
  readonly kind: ActivityKind;
}

export interface DamageAppliedEvent {
  readonly type: 'DamageApplied';
  readonly wormId: string;
  /** Requested damage; the reducer scores the part the worm actually had left. */
  readonly amount: number;
  /** null for environmental damage (map mines, sudden death): no points and no kill credit. */
  readonly sourceTeamId: string | null;
  readonly sourceWormId: string | null;
  /**
   * The price of a super the worm is firing (WeaponDef.toll). When it takes the worm's last health
   * the worm still finishes the move: the turn ends when the shot closes, not under it.
   */
  readonly toll?: boolean;
  /**
   * A toll by share (WeaponDef.tollShare, Antares): the worm pays this share of the health it has,
   * rounded up, and amount is only the most that can come to.
   */
  readonly tollShare?: number;
}

export interface WormDiedEvent {
  readonly type: 'WormDied';
  readonly wormId: string;
}

export interface WormDrownedEvent {
  readonly type: 'WormDrowned';
  readonly wormId: string;
}

/** A new worm joined a team mid match: a Saibaman out of the ground (sim/sprout.ts). */
export interface WormSpawnedEvent {
  readonly type: 'WormSpawned';
  readonly wormId: string;
  readonly teamId: string;
  /** Its health as a share of a worm's (config wormHp). */
  readonly hpShare: number;
  readonly x: number;
  readonly y: number;
}

/** The Tesoro del Cielo sealed a worm (sim/techniques/treasure.ts): its team loses its next hits turns (match/seals.ts). */
export interface WormSealedEvent {
  readonly type: 'WormSealed';
  readonly weaponId: WeaponId;
  readonly casterId: string;
  readonly targetId: string;
  /** Turns the sealed worm's team loses, a strike each; the last strike kills it. */
  readonly hits: number;
  /** What each strike costs the caster, hp. */
  readonly hitToll: number;
}

export interface AllBodiesAtRestEvent {
  readonly type: 'AllBodiesAtRest';
}

export interface CrateLandedEvent {
  readonly type: 'CrateLanded';
  readonly crate: CrateType;
}

export interface CratePickedEvent {
  readonly type: 'CratePicked';
  readonly wormId: string;
  readonly crate: CrateType;
  /** Weapon crates: the weapon granted. */
  readonly weaponId?: WeaponId;
  /** Health crates: heal override; the config amount applies when absent. */
  readonly amount?: number;
}

export interface CrateDestroyedEvent {
  readonly type: 'CrateDestroyed';
  /** False when destroyed before its first landing; releases the pending drop reservation. */
  readonly wasCounted?: boolean;
}

export interface SkipTurnEvent {
  readonly type: 'SkipTurn';
  readonly reason?: SkipReason;
}

export interface SurrenderEvent {
  readonly type: 'Surrender';
  readonly teamId: string;
}

export interface WindRolledEvent {
  readonly type: 'WindRolled';
  /** Integer -10..10, clamped by the reducer. */
  readonly step: number;
}

export type MatchEvent =
  | TimerTickEvent
  | BannerDoneEvent
  | FireStartedEvent
  | FireCompletedEvent
  | RetreatDoneEvent
  | ActivityPingEvent
  | DamageAppliedEvent
  | WormDiedEvent
  | WormDrownedEvent
  | WormSpawnedEvent
  | WormSealedEvent
  | AllBodiesAtRestEvent
  | CrateLandedEvent
  | CratePickedEvent
  | CrateDestroyedEvent
  | SkipTurnEvent
  | SurrenderEvent
  | WindRolledEvent;

export type MatchEventType = MatchEvent['type'];

export const MATCH_EVENT_TYPES: readonly MatchEventType[] = Object.freeze([
  'TimerTick',
  'BannerDone',
  'FireStarted',
  'FireCompleted',
  'RetreatDone',
  'ActivityPing',
  'DamageApplied',
  'WormDied',
  'WormDrowned',
  'WormSpawned',
  'WormSealed',
  'AllBodiesAtRest',
  'CrateLanded',
  'CratePicked',
  'CrateDestroyed',
  'SkipTurn',
  'Surrender',
  'WindRolled',
]);

export function isMatchEventType(value: unknown): value is MatchEventType {
  return typeof value === 'string' && (MATCH_EVENT_TYPES as readonly string[]).includes(value);
}
