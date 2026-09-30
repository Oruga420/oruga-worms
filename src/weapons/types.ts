/**
 * Weapon contracts (architecture.md section D, corrected by ultraplan.html rev 2).
 *
 * Seven combat behaviour kinds plus a utility family. Clustering is a FIELD, not a kind: Mortar,
 * Cluster Bomb and Banana Bomb are the same behaviour module with a ClusterSpec attached.
 * Weapon defs are data rows and are never mutated; ammo lives in match state.
 */

/** The 31 panel slots: 26 combat weapons plus 5 utilities, in panel order. */
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
  'kamehameha',
  'freezer',
  'fire_punch',
  'baseball_bat',
  'ryuko_ranbu',
  'gear_five',
  'dynamite',
  'mine',
  'sheep',
  'saibaman',
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
  /** A MELEE row that plays out as a super move over several ticks (Ryuko Ranbu). */
  readonly combo?: ComboSpec;
  /** A HITSCAN row fired as a charged energy beam over several ticks (Kamehameha). */
  readonly beam?: BeamSpec;
  /** A MELEE row played out as a transformation that grabs a worm and eats it (Gear 5). */
  readonly devour?: DevourSpec;
  /** A HITSCAN row fired as a light that makes a worm float, swell up and burst (the Freezer). */
  readonly hex?: HexSpec;
  /** A PLACED row planted as a seed a small worm grows out of, to join the team (the Saibaman). */
  readonly sprout?: SproutSpec;
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

/**
 * A super move that resolves over time instead of at fire time: a super freeze, a rush to a
 * victim in plain sight, a flurry of blows and a finisher. Like clustering it is a FIELD on a
 * MELEE row, not a kind of its own: the row's melee block still states the lock range, the total
 * damage and the final throw, which is what the CPU heuristic and the panel read; this block is
 * the timeline the sim plays (sim/combo.ts). Durations are ms, rounded to ticks by the sim.
 */
export interface ComboSpec {
  /** Lock range, worm centre to worm centre, world px. The victim must be in plain sight. */
  readonly rangePx: number;
  /** The super freeze before the rush: the flash and the name call. */
  readonly startupMs: number;
  /** The rush from the attacker's spot to the victim. */
  readonly dashMs: number;
  /** Blows in the flurry, and the time between two of them. */
  readonly hits: number;
  readonly hitIntervalMs: number;
  readonly damagePerHit: number;
  /** The last blow: its own damage and its throw, px per second, x along the rush and y upward. */
  readonly finisherDamage: number;
  readonly finisherKnockback: { readonly x: number; readonly y: number };
  /** The pose held on the finisher before the shot closes. */
  readonly recoverMs: number;
}

/**
 * A beam super (Kamehameha): a charge while the energy gathers in the worm's hands, then a beam
 * whose head races along the aim, bores a tunnel through the land and hits every worm it touches
 * once, and a blast where it ends. A FIELD on a HITSCAN row, as the combo is on a melee row: the
 * row's hitscan block states the reach and the damage the CPU and the panel read; this block is
 * the timeline the sim plays (sim/beam.ts). Durations are ms, rounded to ticks by the sim.
 */
export interface BeamSpec {
  /** The charge before the beam ("Ka... me... ha... me..."). */
  readonly chargeMs: number;
  /** How fast the beam's head travels, world px per second. */
  readonly speedPxPerS: number;
  /** Beam length from the hands, world px. */
  readonly rangePx: number;
  /** Radius of the beam and of the tunnel it bores, world px. */
  readonly radiusPx: number;
  /** Damage to every worm the beam touches, once per worm. */
  readonly damage: number;
  /** The throw of a worm it hits, px per second: along the beam, and upward. */
  readonly push: number;
  readonly lift: number;
  /** The full beam holds this long once its head stops, then fades. */
  readonly holdMs: number;
  readonly fadeMs: number;
  /** Where the beam ends at full reach, it bursts. */
  readonly tipBlast: BlastSpec;
}

/**
 * Gear 5: the worm awakens to the drums of liberation, turns white and rubbery, shoots its arm out
 * to the nearest enemy in plain sight within reach, reels it into a giant mouth, chews it and
 * swallows it whole. A FIELD on a MELEE row, like the combo: the row's melee block states the reach
 * the CPU and the panel read; this block is the timeline the sim plays (sim/devour.ts). A worm
 * swallowed is gone, whatever health it had left. Durations are ms, rounded to ticks by the sim.
 */
export interface DevourSpec {
  /** Lock and arm reach, worm centre to worm centre, world px. The victim must be in plain sight. */
  readonly rangePx: number;
  /** The transformation, and the drum beats spread over it. */
  readonly awakenMs: number;
  readonly drums: number;
  /** The rubber arm's flight out to the victim, and back with it. */
  readonly stretchMs: number;
  readonly reelMs: number;
  /** Bites while the victim is in the mouth, the time between two of them, and what each takes. */
  readonly chomps: number;
  readonly chompIntervalMs: number;
  readonly chompDamage: number;
  /** After the swallow: the lump going down, the burp, and the white wearing off. */
  readonly recoverMs: number;
}

/**
 * The Freezer: the worm points a finger at the nearest enemy in plain sight within reach, and a
 * glowing pink light leaves the fingertip, flies to it and sinks into its body; the victim rises
 * off the ground glowing from inside, swells up and bursts. A FIELD on a HITSCAN row, like the
 * beam: the row's hitscan block states the reach the CPU and the panel read; this block is the
 * timeline the sim plays (sim/hex.ts). A worm that bursts is gone, whatever health it had left,
 * and the burst is a blast that hurts whoever stands close. Durations are ms, rounded to ticks.
 */
export interface HexSpec {
  /** Lock reach, worm centre to worm centre, world px. The victim must be in plain sight. */
  readonly rangePx: number;
  /** The finger up, the light gathering on its tip. */
  readonly pointMs: number;
  /** How fast the light flies, world px per second. */
  readonly lightSpeedPxPerS: number;
  /** The victim floats up this far off the ground (less under a ceiling) over riseMs. */
  readonly riseMs: number;
  readonly liftPx: number;
  /** Then it swells up over swellMs, throbbing faster and faster (pulses), and bursts. */
  readonly swellMs: number;
  readonly pulses: number;
  /** The burst, around the victim's middle: it hurts its neighbours and carves the land. */
  readonly burst: BlastSpec;
  /** After the burst: the finger comes down, and a laugh. */
  readonly recoverMs: number;
}

/**
 * The Saibaman seed: the worm plants a seed in the ground just in front of it, the ground shakes and
 * cracks, more and more, and a Saibaman leaps out of it: a small green worm, a share of a worm's
 * size and health, that joins the planter's team and takes its own turns from then on. A FIELD on a
 * PLACED row, as the mine's spawn block is; this block is the timeline the sim plays
 * (sim/sprout.ts). With no ground to plant in, or a team already at its cap, the seed withers.
 * Durations are ms, rounded to ticks by the sim.
 */
export interface SproutSpec {
  /** How far in front of the worm the seed goes in, world px. */
  readonly plantAheadPx: number;
  /** The worm bends down and pushes the seed into the ground. */
  readonly plantMs: number;
  /** The ground shakes and cracks, cracks times, before it gives. */
  readonly growMs: number;
  readonly cracks: number;
  /** How hard the Saibaman leaps out of the ground, px per second, upward. */
  readonly popSpeed: number;
  /** The crater it leaves, world px. */
  readonly holePx: number;
  /** The planter straightens up while the new one looks around. */
  readonly recoverMs: number;
  /** The Saibaman's size and health, as a share of a worm's: its hitbox is that much smaller too. */
  readonly size: number;
  readonly hpShare: number;
  /** Living worms a team may have; a seed planted by a full team withers. */
  readonly maxTeamWorms: number;
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
