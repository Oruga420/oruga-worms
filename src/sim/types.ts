/**
 * Simulation bodies and the events the sim emits toward the match reducer, the audio mixer and
 * the particle system. Bodies are MUTABLE on purpose: they live in the 60 Hz hot path and are
 * pooled or reused across ticks (architecture.md section E: mutation in the tick loop,
 * immutability in the ledger). Nothing here is a MatchState; the match layer converts events.
 */

import type { BeamSpec, BlastSpec, ClusterSpec, ComboSpec, DevourSpec, HexSpec, ProjectileSpec, SpawnSpec } from '../weapons/types.ts';

export type WormMotion = 'idle' | 'walking' | 'jumping' | 'falling' | 'flying' | 'parachuting' | 'jetpacking' | 'drowning' | 'dead';

export interface WormBody {
  readonly id: string;
  readonly teamId: string;
  /** 1 for a worm, 0.5 for a Saibaman sprouted from a seed: its hitbox scales by it (sim/worm-size.ts). */
  readonly size: number;
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

/**
 * A super move in progress (sim/combo.ts). The attacker, and the victim until the finisher, are
 * held by the combo: the worm controller does not step them, the combo places them every tick.
 */
export type ComboStage = 'startup' | 'dash' | 'flurry' | 'finisher' | 'recover';

export interface ComboBody {
  readonly id: number;
  readonly weaponId: string;
  readonly attackerId: string;
  readonly ownerTeamId: string;
  /** Null when nobody was in reach and in sight: the rush whiffs. */
  readonly victimId: string | null;
  readonly spec: ComboSpec;
  stage: ComboStage;
  /** Ticks spent in the current stage, counted from 1 on the stage's first tick. */
  stageTicks: number;
  /** Where the rush starts and where the attacker plants its feet for the beating, world px. */
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** Where the attacker is left standing afterwards: beside the victim when it can stand there, else home. */
  readonly restX: number;
  readonly restY: number;
  /** Where the victim is held until the finisher throws it. */
  readonly holdX: number;
  readonly holdY: number;
  /** Direction of the rush and of every blow. */
  readonly facing: 1 | -1;
  hitsLanded: number;
  alive: boolean;
}

/**
 * A beam super in progress (sim/beam.ts). The attacker is held from the charge to the end of the
 * fade: the worm controller does not step it, the beam keeps it where it stood.
 */
export type BeamStage = 'charge' | 'fire' | 'hold' | 'fade';

export interface BeamBody {
  readonly id: number;
  readonly weaponId: string;
  readonly attackerId: string;
  readonly ownerTeamId: string;
  readonly spec: BeamSpec;
  stage: BeamStage;
  /** Ticks spent in the current stage, counted from 1 on the stage's first tick. */
  stageTicks: number;
  /** Where the beam leaves the hands, and its unit direction. */
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  /** Where the attacker stands while the beam plays. */
  readonly holdX: number;
  readonly holdY: number;
  readonly facing: 1 | -1;
  /** How far the head has got from (x0, y0), world px, and how far it can go: its reach, or the world's edge. */
  length: number;
  readonly maxLength: number;
  /** How far along the beam the tunnel has been bored, world px. */
  carved: number;
  /** Worms the beam has hit: each takes it once. */
  readonly hit: string[];
  alive: boolean;
}

/**
 * Gear 5 in progress (sim/devour.ts). The eater is held from the awakening to the end; the victim
 * is held from the start until it is swallowed, and once swallowed its body is out of the world.
 */
export type DevourStage = 'awaken' | 'stretch' | 'reel' | 'chew' | 'recover';

/** The beats of Gear 5 the presentation plays: each drum, the awakening, the arm, every bite, the swallow, the burp. */
export type DevourBeat = 'drum' | 'awake' | 'stretch' | 'grab' | 'snap' | 'chomp' | 'gulp' | 'burp';

export interface DevourBody {
  readonly id: number;
  readonly weaponId: string;
  readonly attackerId: string;
  readonly ownerTeamId: string;
  /** Null when nobody was in reach and in sight: the arm grabs at the air. */
  readonly victimId: string | null;
  readonly spec: DevourSpec;
  stage: DevourStage;
  /** Ticks spent in the current stage, counted from 1 on the stage's first tick. */
  stageTicks: number;
  /** Where the eater stands through it all, and which way it faces. */
  readonly holdX: number;
  readonly holdY: number;
  readonly facing: 1 | -1;
  /** Where the arm leaves the body, and where the hand goes: the victim's middle, or as far as it got. */
  readonly shoulderX: number;
  readonly shoulderY: number;
  readonly reachX: number;
  readonly reachY: number;
  /** The victim's feet where it was grabbed, and where they are held in the mouth for the chewing. */
  readonly grabX: number;
  readonly grabY: number;
  readonly mouthX: number;
  readonly mouthY: number;
  /** Bites taken so far. */
  chomps: number;
  /** The victim went down the throat, and the burp has come back up. */
  swallowed: boolean;
  burped: boolean;
  alive: boolean;
}

/**
 * The Freezer in progress (sim/hex.ts). The attacker and the victim are held from the point until
 * the burst; the burst takes the victim's body out of the world, and nobody is held afterwards.
 */
export type HexStage = 'point' | 'shot' | 'rise' | 'swell' | 'recover';

/** The beats of the Freezer the presentation plays: the light leaving, going in or fizzling out, every throb, the burst. */
export type HexBeat = 'shot' | 'enter' | 'fizzle' | 'pulse' | 'burst';

export interface HexBody {
  readonly id: number;
  readonly weaponId: string;
  readonly attackerId: string;
  readonly ownerTeamId: string;
  /** Null when nobody was in reach and in sight: the light flies on and fizzles out. */
  readonly victimId: string | null;
  readonly spec: HexSpec;
  stage: HexStage;
  /** Ticks spent in the current stage, counted from 1 on the stage's first tick. */
  stageTicks: number;
  /** Where the attacker stands until the burst, and which way it faces. */
  readonly holdX: number;
  readonly holdY: number;
  readonly facing: 1 | -1;
  /** The fingertip the light leaves, and where it goes: the victim's middle, or as far as it got. */
  readonly tipX: number;
  readonly tipY: number;
  readonly targetX: number;
  readonly targetY: number;
  /** How far the light's path bows up over the straight line at its middle, world px. */
  readonly arcPx: number;
  /** Ticks the light takes to get there. */
  readonly flightTicks: number;
  /** The victim's feet where it stood, and how high it floats: the spec's lift, or less under a ceiling. */
  readonly groundX: number;
  readonly groundY: number;
  readonly liftPx: number;
  /** Throbs so far while it swells. */
  pulses: number;
  /** The victim has burst. */
  burst: boolean;
  alive: boolean;
}

/** Where a hit landed and which way it pushed, so the presentation can spray the blood the right way. */
export interface HitPoint {
  readonly x: number;
  readonly y: number;
  /** Unit direction of the blow. */
  readonly dx: number;
  readonly dy: number;
}

export type SimEvent =
  | { readonly type: 'damage'; readonly wormId: string; readonly amount: number; readonly sourceTeamId: string | null; readonly sourceWormId: string | null; readonly cause: 'blast' | 'fall' | 'hit' | 'melee'; readonly at?: HitPoint }
  | { readonly type: 'drown'; readonly wormId: string }
  | { readonly type: 'activity'; readonly kind: 'bounce' | 'carve' | 'spawn' }
  | { readonly type: 'explosion'; readonly x: number; readonly y: number; readonly radius: number; readonly particle: BlastSpec['particle']; readonly shake: number }
  | { readonly type: 'sound'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'crateLanded'; readonly crateId: number; readonly kind: CrateKind; readonly x: number; readonly y: number }
  | { readonly type: 'cratePicked'; readonly crateId: number; readonly kind: CrateKind; readonly wormId: string }
  | { readonly type: 'crateDestroyed'; readonly crateId: number; readonly wasCounted: boolean }
  | { readonly type: 'landed'; readonly wormId: string; readonly speed: number }
  | { readonly type: 'projectileGone'; readonly projectileId: number; readonly reason: 'exploded' | 'water' | 'bounds' | 'timeout' }
  /** A bullet's path from the muzzle to where it stopped, for the tracer; presentation only. */
  | { readonly type: 'tracer'; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly hit: 'worm' | 'land' | 'none' }
  /** A melee swing left the worm's hands (fire punch, bat), hit or miss; presentation only. */
  | { readonly type: 'swing'; readonly wormId: string; readonly weaponId: string; readonly x: number; readonly y: number; readonly facing: 1 | -1 }
  | { readonly type: 'comboStart'; readonly comboId: number; readonly weaponId: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number }
  | { readonly type: 'comboHit'; readonly comboId: number; readonly attackerId: string; readonly victimId: string; readonly hit: number; readonly finisher: boolean; readonly at: HitPoint }
  | { readonly type: 'comboEnd'; readonly comboId: number; readonly attackerId: string; readonly victimId: string | null; readonly hits: number }
  /** A beam super starts charging at (x, y), the hands, aimed along (dx, dy). */
  | { readonly type: 'beamStart'; readonly beamId: number; readonly weaponId: string; readonly attackerId: string; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  /** The charge is spent: the beam leaves the hands. */
  | { readonly type: 'beamFire'; readonly beamId: number; readonly attackerId: string; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly type: 'beamEnd'; readonly beamId: number; readonly attackerId: string; readonly hits: number }
  /** Gear 5 starts: the eater, and the victim its arm will grab (null for a whiff). */
  | { readonly type: 'devourStart'; readonly devourId: number; readonly weaponId: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number }
  /** One beat of Gear 5 at (x, y); n counts the drums and the bites from 1, 0 for the rest. Presentation only. */
  | { readonly type: 'devourBeat'; readonly devourId: number; readonly attackerId: string; readonly victimId: string | null; readonly beat: DevourBeat; readonly n: number; readonly x: number; readonly y: number; readonly facing: 1 | -1 }
  | { readonly type: 'devourEnd'; readonly devourId: number; readonly attackerId: string; readonly victimId: string | null; readonly eaten: boolean }
  /** The Freezer starts: the attacker, and the worm its light will go into (null for a whiff). */
  | { readonly type: 'hexStart'; readonly hexId: number; readonly weaponId: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number }
  /** One beat of the Freezer at (x, y); n counts the throbs from 1, 0 for the rest. Presentation only. */
  | { readonly type: 'hexBeat'; readonly hexId: number; readonly attackerId: string; readonly victimId: string | null; readonly beat: HexBeat; readonly n: number; readonly x: number; readonly y: number; readonly facing: 1 | -1 }
  | { readonly type: 'hexEnd'; readonly hexId: number; readonly attackerId: string; readonly victimId: string | null; readonly burst: boolean };

export interface WormIntent {
  readonly moveX: -1 | 0 | 1;
  readonly jump: boolean;
  readonly backflip: boolean;
  /** Jump key held: upward thrust while the worm is on a jetpack, ignored otherwise. */
  readonly thrust: boolean;
}

export const IDLE_INTENT: WormIntent = Object.freeze({ moveX: 0, jump: false, backflip: false, thrust: false });
