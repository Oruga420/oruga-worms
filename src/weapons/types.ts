/**
 * Weapon contracts (architecture.md section D, corrected by ultraplan.html rev 2).
 *
 * Seven combat behaviour kinds plus a utility family. Clustering is a FIELD, not a kind: Mortar,
 * Cluster Bomb and Banana Bomb are the same behaviour module with a ClusterSpec attached.
 * Weapon defs are data rows and are never mutated; ammo lives in match state.
 */

/** The 26 panel slots: 21 combat weapons plus 5 utilities, in panel order. */
export const PANEL_WEAPON_IDS = [
  'bazooka',
  'homing_missile',
  'mortar',
  'longbow',
  'grenade',
  'cluster_bomb',
  'banana_bomb',
  'holy_hand_grenade',
  'tank',
  'napalm',
  'handgun',
  'shotgun',
  'uzi',
  'minigun',
  'sonic_blast',
  'fire_punch',
  'baseball_bat',
  'dynamite',
  'mine',
  'sheep',
  'air_strike',
  'parachute',
  'jetpack',
  'teleport',
  'girder',
  'skip_go',
] as const;

/** Child projectiles spawned by clustering or by the air strike. Never in the panel. */
export const CHILD_WEAPON_IDS = [
  'mortar_bomblet',
  'cluster_bomblet',
  'banana_bomblet',
  'strike_bomb',
  'napalm_blob',
] as const;

export type PanelWeaponId = (typeof PANEL_WEAPON_IDS)[number];
export type ChildWeaponId = (typeof CHILD_WEAPON_IDS)[number];
/**
 * A registry key: exactly the panel weapons. Children are not weapons of their own, they are
 * nested inside ClusterSpec and StrikeSpec (childProjectile plus childBlast), so an ammo ledger
 * or a CPU response can never name a bomblet. ChildWeaponId only labels those nested children.
 */
export type WeaponId = PanelWeaponId;

export const PANEL_SLOT_COUNT = PANEL_WEAPON_IDS.length;

export type WeaponKind =
  | 'PROJECTILE'
  | 'TIMED'
  | 'HITSCAN'
  | 'MELEE'
  | 'PLACED'
  | 'TARGETED'
  | 'ANIMAL'
  | 'UTILITY';

export type WeaponCategory = 'explosive' | 'firearm' | 'melee' | 'air' | 'animal' | 'utility';

/** What a projectile does when it reaches the water line. */
export const WATER_BEHAVIORS = ['splash', 'skim', 'pass'] as const;
export type WaterBehavior = (typeof WATER_BEHAVIORS)[number];

/** Atlas frame id, validated against the atlas manifest at boot. */
export type AtlasFrameId = string;

/** Audio cue id, validated against the audio manifest at boot. */
export type SoundId = string;

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  readonly kind: WeaponKind;
  readonly category: WeaponCategory;
  /** Atlas frame id in weapon_icon. */
  readonly icon: AtlasFrameId;
  /** Atlas frame id in weapon_held, null for weapons drawn without a held sprite. */
  readonly heldSprite: AtlasFrameId | null;

  /** Starting ammo per team; -1 means infinite. */
  readonly ammo: number;
  /** Turns before the weapon becomes available (the scheme gives Jetpack a 2 turn delay). */
  readonly delayTurns?: number;
  /** Hold fire to build power. */
  readonly charged: boolean;
  /** Launch speed at full charge, world px per second. Source px per frame values go through units.ts. */
  readonly maxPower: number;
  readonly windAffected: boolean;
  readonly gravityScale: number;

  /** Shotgun 2, uzi 1, bazooka 1. */
  readonly shotsPerTurn: number;
  /** False for utilities and for multi shot weapons until the last shot. */
  readonly endsTurnOnFire: boolean;
  /** Retreat window override after the last shot; the config ground and air values apply otherwise. */
  readonly retreatMs?: number;
  /** Homing, air strike, teleport, girder. */
  readonly requiresTargetSelect: boolean;
  /** Relative weight in a weapon crate roll; 0 means never in a crate. */
  readonly crateWeight: number;

  readonly fuse?: FuseSpec;
  readonly projectile?: ProjectileSpec;
  readonly blast?: BlastSpec;
  readonly cluster?: ClusterSpec;
  readonly hitscan?: HitscanSpec;
  readonly melee?: MeleeSpec;
  readonly strike?: StrikeSpec;
  readonly spawn?: SpawnSpec;
  readonly utility?: UtilitySpec;

  readonly sfx: {
    readonly fire: SoundId;
    readonly impact?: SoundId;
    /** Plays while the body is live (rocket jet, dynamite fuse). Must be a loop cue in the audio plan. */
    readonly loop?: SoundId;
    /** Secondary one shot between fire and impact: holy choir at rest, mine trigger beep, bomb whistle. */
    readonly arm?: SoundId;
  };
}

export interface FuseSpec {
  readonly selectable: boolean;
  /** Must be a member of optionsMs. */
  readonly defaultMs: number;
  /** Legal fuse settings, e.g. [1000, 2000, 3000, 4000, 5000]. */
  readonly optionsMs: readonly number[];
  /** Holy hand grenade: once the fuse runs out, wait until the body is fully at rest, then detonate. */
  readonly restBeforeDetonate?: boolean;
}

export interface ProjectileSpec {
  readonly sprite: AtlasFrameId;
  /** Collision radius for the sweep, world px. */
  readonly radiusPx: number;
  /**
   * Restitution 0..1 on the normal component: the fraction of normal speed KEPT on a bounce
   * (grenade MAX keeps 0.60). For PROJECTILE kinds 0 means detonate on contact; TIMED and PLACED
   * kinds detonate on their fuse, so 0 there means the body stops dead (dynamite does not roll).
   */
  readonly bounce: number;
  /** Tangential damping on bounce: the fraction of tangential speed KEPT (grenade MAX keeps 0.96). */
  readonly friction: number;
  /**
   * Grenade family restitution preset: 'selectable' offers MAX and MIN per throw (config
   * grenadeBounce), 'max' and 'min' are forced (banana forces max, holy hand grenade min).
   */
  readonly bounceMode?: 'selectable' | 'max' | 'min';
  readonly homing?: {
    readonly turnRateRadPerSec: number;
    readonly activateAfterMs: number;
    /** Attraction ends this long after launch (4000 in the source); undefined means it never ends. */
    readonly deactivateAfterMs?: number;
    /** Self destruct after this long without impact. */
    readonly selfDestructMs: number;
  };
  readonly trail: 'smoke' | 'sparkle' | 'none';
  readonly detonateOnTimeout: boolean;
  /**
   * Hard lifetime cap. Also caps the heuristic trajectory search (about 400 ticks) so long
   * shots are evaluated in full with early exit on impact. 0 means no cap: only a placed mine,
   * which persists across turns, may use it.
   */
  readonly maxLifetimeMs: number;
  /** Rotate the sprite to the heading. */
  readonly spinWithVelocity: boolean;
  /** Detonated by nearby blasts. */
  readonly chainReaction: boolean;
  /** Water behaviour: bazooka skims at shallow angles, homing passes under, everything else splashes. */
  readonly water: WaterBehavior;
}

/**
 * Blast resolution. Every blast that moves a worm sets the worm's exemptNextLanding flag: the
 * first landing after knockback pays no fall damage, so a blasted worm never pays twice. This is
 * a property of the explosion resolver, not a per weapon switch.
 */
export interface BlastSpec {
  /** Crater radius, world px (the source documents diameters: 97 px diameter is radiusPx 48.5). */
  readonly radiusPx: number;
  readonly maxDamage: number;
  /** Knockback impulse at the centre, falls off linearly to the radius. */
  readonly knockback: number;
  /** Longbow does not carve. */
  readonly carve: boolean;
  readonly shake: number;
  readonly particle: 'small' | 'medium' | 'big' | 'holy';
}

/**
 * Clustering is a field: the children are nested here because bomblets are never panel weapons
 * (no registry row, no ammo, no CPU pick). A child never clusters again by construction, since a
 * ProjectileSpec carries no cluster of its own.
 */
export interface ClusterSpec {
  readonly count: number;
  readonly childProjectile: ProjectileSpec;
  readonly childBlast: BlastSpec;
  /** Optional label from CHILD_WEAPON_IDS for particles and debugging; never a registry key. */
  readonly childWeaponId?: ChildWeaponId;
  /**
   * Where the children fly: 'up' fans around the vertical (cluster bomb, banana), 'back' fans
   * around the reversed travel heading of the parent (mortar bomblets fly back).
   */
  readonly direction: 'up' | 'back';
  /** Total fan width in degrees: 90 means -45 to +45 around the direction (the source figure). */
  readonly spreadDeg: number;
  /** Child launch speed, world px per second. */
  readonly speed: number;
  /** Fraction of speed removed at random per child: 0.09 means up to 9 percent slower. */
  readonly jitter: number;
}

export interface HitscanSpec {
  readonly pellets: number;
  readonly spreadDeg: number;
  readonly damagePerPellet: number;
  readonly rangePx: number;
  /**
   * Bullet crater radius, world px: the roster gives handgun, uzi and minigun 11 px craters
   * (5.5) and the shotgun 47 px (23.5). architecture.md's "0 for uzi and minigun" loses to the plan.
   */
  readonly carveRadiusPx: number;
  readonly burstCount: number;
  readonly burstIntervalMs: number;
  /** Cumulative push on the target per pellet. */
  readonly recoil: number;
  /** Handgun: the aim can be adjusted while the burst fires. */
  readonly aimWhileFiring: boolean;
}

export interface MeleeSpec {
  readonly reachPx: number;
  readonly arcDeg: number;
  readonly damage: number;
  /**
   * Impulse applied to the target, world px per second, both components non negative: x along
   * the puncher's facing, y upward. The bat is calibrated to throw 643 px at 45 degrees.
   */
  readonly knockback: { readonly x: number; readonly y: number };
  /** Fire punch cuts the land directly above the puncher; undefined means no carve. */
  readonly carveRadiusPx?: number;
  /**
   * Source calibration: a victim hit at 45 degrees lands this far away (643 px for the bat). The
   * melee module may rescale knockback so this holds under the live gravity.
   */
  readonly throwRangePx?: number;
}

/** Air strike: the plane releases count bombs, nested here for the same reason as ClusterSpec. */
export interface StrikeSpec {
  readonly count: number;
  /** Horizontal distance between consecutive bombs, world px. */
  readonly spacingPx: number;
  /** World y where the bombs are released; 0 is the top edge of the world. */
  readonly spawnY: number;
  readonly childProjectile: ProjectileSpec;
  readonly childBlast: BlastSpec;
  /** Optional label from CHILD_WEAPON_IDS for particles and debugging; never a registry key. */
  readonly childWeaponId?: ChildWeaponId;
  readonly planeSprite: AtlasFrameId;
  /** World px per second. */
  readonly planeSpeed: number;
}

export interface SpawnSpec {
  readonly entityType: 'sheep' | 'mine';
  /** Sheep: manual detonation or this timeout. Mines: unused. */
  readonly lifetimeMs: number;
  readonly moveSpeed: number;
  readonly hopImpulse: number;
  readonly detonateOnSecondFire: boolean;
  /** Mines: trigger radius, world px (48 in the source). */
  readonly proximityPx?: number;
  /** Mines: fixed fuse after the proximity trigger (3000 ms for placed mines). */
  readonly armDelayMs?: number;
}

export interface UtilitySpec {
  readonly effect: 'parachute' | 'jetpack' | 'teleport' | 'girder' | 'skip';
  /** Jetpack fuel, ms of single thruster burn. */
  readonly fuelMs?: number;
  readonly girderSizePx?: { readonly w: number; readonly h: number };
  /** Placement range from the worm, world px (girder 600); undefined means unlimited (teleport). */
  readonly rangePx?: number;
}
