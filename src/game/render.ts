/**
 * Draws the live game world: sky, the terrain tiles from the mask, the water band, the worms (the
 * generated character sprites, or procedural little characters until they load), projectiles,
 * mines, crates, the active worm marker, the aim and the weapon in hand. Everything goes through
 * the camera and the Ctx2D interface; no readback. Ctx2D has no ellipse, so round shapes are built
 * from a scaled arc: the path is constructed under a scale transform and the transform is restored
 * before fill and stroke, so the outline width stays uniform.
 *
 * Animation: a worm's pose comes from its motion plus the presentation cues of fx.ts (hurt,
 * recoil, landing, weapon switch) and its part in a super move (poseFor). Wounds and hit flashes
 * are composited on a small scratch canvas with source-atop, so the blood and the flash stay
 * inside the sprite's own silhouette; the super move's white screen reuses the same composite to
 * draw its fighters as black silhouettes.
 */

import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { visibleRect, worldToScreen, type Camera } from '../engine/camera.ts';
import type { Context2DLike } from '../terrain/context.ts';
import { blitTiles } from '../terrain/tiles.ts';
import type { MatchState } from '../match/state.ts';
import { activeWormOf } from '../match/ledger.ts';
import { WORM_HEIGHT, WORM_HALF_WIDTH } from '../sim/constants.ts';
import type { SimWorld } from '../sim/world.ts';
import { clamp, degToRad } from '../core/math.ts';
import { hash01, seedFromString } from '../core/rng.ts';
import { ticksToMs } from '../config/units.ts';
import type { AimState } from './aim.ts';
import type { Atlas } from '../engine/atlas.ts';
import type { AtlasFrame, AtlasPoint } from '../engine/atlas-schema.ts';
import type { ImageSource } from '../engine/canvas-types.ts';
import { drawSprite, type SpriteOptions } from '../engine/sprite.ts';
import type { BeamBody, ComboBody, CrateKind, DevourBody, HexBody, ProjectileBody, SproutBody, WormMotion } from '../sim/types.ts';
import { sproutProgress } from '../sim/sprout.ts';
import { wormHalfWidth, wormHeight, wormMiddleY } from '../sim/worm-size.ts';
import { beamProgress } from '../sim/beam.ts';
import { devourHand, devourProgress } from '../sim/devour.ts';
import { hexLight, hexProgress } from '../sim/hex.ts';
import { holdsVictim, ticksFor } from '../sim/combo.ts';
import { sweep } from '../sim/collision.ts';
import { getWeapon } from '../weapons/registry.ts';
import type { BeamSpec, WeaponId } from '../weapons/types.ts';
import { lockTarget } from '../weapons/behaviors/combo.ts';
import { GAME_CONFIG } from '../config/game-config.ts';
import type { WormAnim } from './fx.ts';
import { bodyPalette } from './gore.ts';
import {
  MOUTH_CENTRE_AHEAD_PX,
  MOUTH_CENTRE_LIFT_PX,
  MOUTH_RADIUS_PX,
  drawCloudScarf,
  drawLump,
  drawMouthFace,
  drawMouthHead,
  drawMouthInside,
  drawRubberArm,
  drawStrawHat,
  drawSunHalo,
  drumBounce,
  gearWhiteness,
  haloStrength,
  hatScale,
  lumpDown,
  mouthState,
  type MouthLook,
} from './gear-five.ts';
import { HEX_PINK, TYRANT_WHITE, drawHexLight, drawHexTrail, drawInnerGlow, drawTyrantDome, innerGlow, swelling, tipCharge, tremble, tyrantForm } from './freezer.ts';
import { drawPowerOrb } from './power-orb.ts';
import { SAIBA_GREEN, SAIBA_SKIN_ALPHA, drawSproutScene, isSaibaman, seedHand } from './saibaman.ts';

/** Both Ctx2D and Context2DLike are structural subsets of the real 2D context, which the browser passes as is. */
function asTileContext(ctx: Ctx2D): Context2DLike {
  return ctx as unknown as Context2DLike;
}

/** Rough label width without measureText (absent from Ctx2D), good enough for a placeholder tag. */
function labelWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6;
}

const TEAM_COLORS = ['#e05a4d', '#4d8fe0', '#57b85a', '#d9b23a'] as const;
const WORM_SKIN = '#e7b98a';
const WORM_SKIN_SHADE = '#c98f5f';
const WORM_OUTLINE = '#5a3a22';

export function teamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length] ?? '#e05a4d';
}

/** One character's generated sprite set, keyed by the team colour index it belongs to. */
export interface CharacterSprites {
  readonly atlas: Atlas;
  readonly image: ImageSource;
}

/** A small offscreen surface for per worm composites (wounds, hit flash, silhouettes). */
export interface Scratch {
  readonly canvas: ImageSource;
  readonly ctx: Ctx2D;
  /** Side of the square surface in px; a bigger frame is drawn without the composite. */
  readonly size: number;
}

export interface RenderModel {
  readonly state: MatchState;
  readonly world: SimWorld;
  readonly aim: AimState;
  readonly timeMs: number;
  /** Team colour index to sprite set. Absent or empty means draw the procedural fallback worm. */
  readonly sprites?: ReadonlyMap<number, CharacterSprites>;
  /** The weapon the active worm holds; drawn in its hand when the weapon atlas has a held layer. */
  readonly weapon?: WeaponId;
  /** The weapon atlas (icons and held layers); null or absent means arms stay empty. */
  readonly weaponSprites?: CharacterSprites | null;
  /** World point under the mouse, drawn as the crosshair while a targeted weapon is selected. */
  readonly pointer?: { readonly x: number; readonly y: number };
  /** True while the human's selected weapon fires where the mouse points (air strike, teleport, girder). */
  readonly targeting?: boolean;
  /** Presentation cues per worm (fx.ts): hurt, recoil, landing, weapon switch. Absent means plain poses. */
  readonly anim?: (wormId: string) => WormAnim | undefined;
  /** Composite surface for wounds, hit flashes and silhouettes; absent or null skips those layers. */
  readonly scratch?: Scratch | null;
  /** 0..1: the super move's white screen, washed over the world with its fighters on top in black. */
  readonly whiteout?: number;
  /** 0..1: the super freeze, the world dimmed with its fighters on top in colour. */
  readonly dim?: number;
  /** 0..1: the attacker's aura while the super gathers. */
  readonly aura?: number;
  /** Aim helpers (laser sight, reach, lock on) for the human; the CPU's aim stays bare. */
  readonly aimAssist?: boolean;
  /** False keeps the worms clean (?gore=0): no wounds on the sprites. On by default. */
  readonly gore?: boolean;
}

/**
 * Frame id for a worm's current state from its motion alone. Walking cycles through the four walk
 * frames on a fixed cadence; everything else is a single pose. The ids match tools/lora/frames.json.
 * poseFor layers the presentation cues and the fight poses on top of this.
 */
export function wormFrameId(worm: WormVisual, timeMs: number): string {
  if (!worm.alive) return 'death_a';
  if (worm.motion === 'drowning') return 'drown_sink';
  if (worm.motion === 'jumping') return 'jump_air';
  if (worm.motion === 'falling' || worm.motion === 'flying') return worm.vy > 0 ? 'fall' : 'jump_air';
  if (worm.motion === 'parachuting' || worm.motion === 'jetpacking') return 'parachute';
  if (Math.abs(worm.vx) > 5) {
    const cycle = ['walk_1', 'walk_2', 'walk_3', 'walk_4'] as const;
    return cycle[Math.floor(timeMs / 110) % cycle.length] ?? 'walk_1';
  }
  return Math.floor(timeMs / 900) % 2 === 0 ? 'idle_a' : 'idle_b';
}

/** A worm's part in a live super move. */
export interface FightRole {
  readonly role: 'attacker' | 'victim';
  readonly combo: ComboBody;
}

/** Who is fighting whom right now, by worm id. */
export function fightRoles(combos: readonly ComboBody[]): Map<string, FightRole> {
  const roles = new Map<string, FightRole>();
  for (const combo of combos) {
    if (!combo.alive) continue;
    roles.set(combo.attackerId, { role: 'attacker', combo });
    if (combo.victimId !== null && holdsVictim(combo.stage)) roles.set(combo.victimId, { role: 'victim', combo });
  }
  return roles;
}

/** A worm's part in Gear 5: the one eating, or its meal until it is swallowed. */
export interface DevourRole {
  readonly role: 'eater' | 'prey';
  readonly devour: DevourBody;
}

/** Who is eating whom right now, by worm id. */
export function devourRoles(devours: readonly DevourBody[]): Map<string, DevourRole> {
  const roles = new Map<string, DevourRole>();
  for (const devour of devours) {
    if (!devour.alive) continue;
    roles.set(devour.attackerId, { role: 'eater', devour });
    if (devour.victimId !== null && !devour.swallowed) roles.set(devour.victimId, { role: 'prey', devour });
  }
  return roles;
}

/** A worm's part in the Freezer: the one pointing, or the one its light went into, until it bursts. */
export interface HexRole {
  readonly role: 'caster' | 'target';
  readonly hex: HexBody;
}

/** Who is pointing at whom right now, by worm id. */
export function hexRoles(hexes: readonly HexBody[]): Map<string, HexRole> {
  const roles = new Map<string, HexRole>();
  for (const hex of hexes) {
    if (!hex.alive) continue;
    roles.set(hex.attackerId, { role: 'caster', hex });
    if (hex.victimId !== null && !hex.burst) roles.set(hex.victimId, { role: 'target', hex });
  }
  return roles;
}

/** Who is planting a seed right now, by worm id: until the Saibaman is out or the seed has wilted. */
export function sproutRoles(sprouts: readonly SproutBody[]): Map<string, SproutBody> {
  const roles = new Map<string, SproutBody>();
  for (const sprout of sprouts) if (sprout.alive && sprout.stage !== 'recover') roles.set(sprout.planterId, sprout);
  return roles;
}

/** How a worm stands to use a weapon: the sheets have a hold pose per family. */
export function holdPose(weapon: WeaponId): string {
  const def = getWeapon(weapon);
  if (def.kind === 'MELEE') return 'hold_melee';
  if (def.kind === 'HITSCAN' || weapon === 'longbow') return 'hold_gun';
  if (def.kind === 'TIMED' || def.kind === 'PLACED' || def.kind === 'ANIMAL') return 'hold_throw';
  if (def.kind === 'PROJECTILE') return 'hold_launcher';
  return 'idle_a';
}

export interface WormPose {
  readonly frame: string;
  /** Radians, clockwise on screen, about the middle of the body. */
  readonly rotation: number;
  readonly stretchX: number;
  readonly stretchY: number;
  /** World px, on top of the body position: a lunge, a flinch, a hop. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** A colour washed over the sprite (the hit flash), and how strongly. */
  readonly tint: string | null;
  readonly tintAlpha: number;
}

export interface PoseInput {
  readonly worm: WormVisual;
  readonly anim?: WormAnim | undefined;
  readonly fight?: FightRole | undefined;
  /** The beam this worm is firing, charge to fade. */
  readonly beam?: BeamBody | undefined;
  /** This worm's part in Gear 5, eating or being eaten. */
  readonly devour?: DevourRole | undefined;
  /** This worm's part in the Freezer, pointing or swelling up. */
  readonly hex?: HexRole | undefined;
  /** The seed this worm is planting, reaching out and kneeling to push it in, then watching the ground. */
  readonly sprout?: SproutBody | undefined;
  /** The weapon the worm is aiming, when it is the active worm on its turn. */
  readonly aiming?: WeaponId | null;
  /** The match is over and this worm's team won. */
  readonly victory?: boolean;
  readonly timeMs: number;
}

/** What the attacker looks like on each blow, and the victim: a different pose every hit. */
const ATTACK_POSES = ['hold_melee', 'fire_recoil', 'hold_gun', 'hold_throw', 'hold_launcher', 'hold_melee', 'taunt', 'fire_recoil'] as const;
const BEATEN_POSES = ['hurt', 'knocked', 'fall', 'drown_gasp', 'hurt', 'death_b'] as const;

function fightPose(input: PoseInput, fight: FightRole): WormPose {
  const { combo } = fight;
  const facing = combo.facing;
  const base: WormPose = { frame: 'hurt', rotation: 0, stretchX: 1, stretchY: 1, offsetX: 0, offsetY: 0, tint: null, tintAlpha: 0 };
  const interval = ticksFor(combo.spec.hitIntervalMs);
  // Ticks since the last blow of the flurry: 0 on the blow's own tick.
  const since = combo.stage === 'flurry' ? (combo.stageTicks - 1) % interval : interval;
  const impact = combo.stage === 'flurry' ? 1 - since / interval : 0;
  if (fight.role === 'attacker') {
    switch (combo.stage) {
      case 'startup':
        // The super freeze: a power pose that trembles with the gathering ki.
        return { ...base, frame: 'taunt', offsetX: Math.sin(input.timeMs / 18) * 0.5, stretchY: 1 + Math.sin(input.timeMs / 60) * 0.03 };
      case 'dash':
        return { ...base, frame: 'knocked', stretchX: 1.3, stretchY: 0.85 };
      case 'flurry':
        return { ...base, frame: ATTACK_POSES[combo.hitsLanded % ATTACK_POSES.length] ?? 'hold_melee', offsetX: facing * impact * 3.5, stretchX: 1 + impact * 0.15 };
      case 'finisher':
      case 'recover':
        return combo.stageTicks < 20 && combo.stage === 'recover'
          ? { ...base, frame: 'hold_launcher', stretchY: 1.15, offsetY: -2 }
          : { ...base, frame: combo.hitsLanded > 0 ? 'taunt' : 'idle_b' };
    }
  }
  if (combo.stage === 'flurry') {
    return {
      ...base,
      frame: BEATEN_POSES[combo.hitsLanded % BEATEN_POSES.length] ?? 'hurt',
      offsetX: facing * impact * 2.8 + Math.sin(input.timeMs / 23) * 0.5,
      offsetY: -impact * 1.2,
      rotation: facing * impact * 0.3,
      tint: impact > 0.5 ? '#ffffff' : '#ff1a1a',
      tintAlpha: impact * 0.75,
    };
  }
  return { ...base, frame: combo.stage === 'finisher' ? 'knocked' : 'hurt' };
}

/** A worm firing a beam: drawn back and trembling while it charges, thrust back when it fires. */
function beamPose(input: PoseInput, beam: BeamBody): WormPose {
  const base: WormPose = { frame: 'hold_throw', rotation: 0, stretchX: 1, stretchY: 1, offsetX: 0, offsetY: 0, tint: null, tintAlpha: 0 };
  const p = beamProgress(beam);
  if (beam.stage === 'charge') {
    const tremble = Math.sin(input.timeMs / 22) * 0.7 * p;
    return { ...base, offsetX: -beam.facing * 1.2 * p + tremble, stretchX: 1 + 0.03 * p, stretchY: 1 - 0.04 * p };
  }
  const push = beam.stage === 'fade' ? 1 - p : 1;
  return { ...base, frame: 'fire_recoil', offsetX: (-beam.facing * 1.8 + Math.sin(input.timeMs / 16) * 0.4) * push };
}

/** How big the meal is drawn in the mouth as it is chewed, from where the reel left it to the swallow. */
const PREY_SCALE_IN = 0.72;
const PREY_SCALE_OUT = 0.42;

/**
 * Gear 5. The eater turns white and bounces like rubber on every drum, throws its arm out, chews
 * with its whole body, swells as the meal goes down and throws its arms up for the burp. The prey
 * trembles, tumbles in along the arm shrinking as it goes, and lies across the mouth, flashing red
 * on every bite.
 */
function devourPose(input: PoseInput, role: DevourRole): WormPose {
  const { devour } = role;
  const f = devour.facing;
  const p = devourProgress(devour);
  const base: WormPose = { frame: 'idle_a', rotation: 0, stretchX: 1, stretchY: 1, offsetX: 0, offsetY: 0, tint: null, tintAlpha: 0 };
  if (role.role === 'eater') {
    const white: Pick<WormPose, 'tint' | 'tintAlpha'> = { tint: '#ffffff', tintAlpha: 0.92 * gearWhiteness(devour) };
    switch (devour.stage) {
      case 'awaken': {
        const bounce = drumBounce(devour);
        return { ...base, ...white, frame: p < 0.8 ? 'taunt' : 'victory', stretchY: 1 - 0.22 * bounce, stretchX: 1 + 0.15 * bounce, offsetY: Math.min(0, bounce) * 2 };
      }
      case 'stretch':
      case 'reel':
        return { ...base, ...white, frame: 'hold_melee', offsetX: f * 1.2 };
      case 'chew':
        return { ...base, ...white, frame: 'taunt', stretchY: 1 + Math.sin(input.timeMs / 60) * 0.03 };
      case 'recover': {
        const lump = lumpDown(devour);
        if (lump !== null) return { ...base, ...white, frame: 'idle_a', stretchX: 1 + 0.2 * (1 - lump * 0.5), stretchY: 0.96 };
        // The burp, then a laugh that shakes the whole body.
        const laugh = Math.abs(Math.sin(input.timeMs / 70));
        return { ...base, ...white, frame: devour.burped && p < 0.6 ? 'victory' : 'taunt', offsetY: -laugh * 1.2, stretchY: 1 + laugh * 0.05 };
      }
    }
  }
  switch (devour.stage) {
    case 'awaken':
    case 'stretch':
      return { ...base, frame: 'hurt', offsetX: Math.sin(input.timeMs / 16) * 0.7 };
    case 'reel': {
      const shrink = 1 - (1 - PREY_SCALE_IN) * p;
      return { ...base, frame: 'knocked', rotation: -f * p * Math.PI * 0.9, stretchX: shrink, stretchY: shrink };
    }
    default: {
      // In the mouth, lying across it with its head down the throat, its middle just inside the jaws.
      const scale = PREY_SCALE_IN - (PREY_SCALE_IN - PREY_SCALE_OUT) * p;
      const cx = devour.holdX + f * (MOUTH_CENTRE_AHEAD_PX + MOUTH_RADIUS_PX * 0.3);
      const cy = devour.holdY - MOUTH_CENTRE_LIFT_PX;
      const interval = ticksFor(devour.spec.chompIntervalMs);
      const sinceBite = Math.max(0, devour.stageTicks - 1) % interval;
      const hurt = sinceBite < 8 ? 1 - sinceBite / 8 : 0;
      return {
        ...base,
        frame: devour.chomps % 2 === 0 ? 'hurt' : 'knocked',
        rotation: -f * Math.PI * 0.45,
        stretchX: scale,
        stretchY: scale,
        offsetX: cx - input.worm.x,
        offsetY: cy + (WORM_HEIGHT / 2) * scale - input.worm.y,
        tint: '#ff1a1a',
        tintAlpha: 0.6 * hurt,
      };
    }
  }
}

/**
 * The Freezer. The attacker holds its arm out and points, in the emperor's white, calm as anything,
 * then laughs with its whole body once it is done. The victim flinches as the light comes; once it
 * is in, it gasps and trembles, pink from inside, as it floats and swells about its middle, faster
 * and faster, until it bursts.
 */
/**
 * The planter: it holds the seed out, kneels and pushes it into the ground in front, leaning over
 * it; then straightens up to watch the ground shake, and cheers as it gives.
 */
function sproutPose(input: PoseInput, sprout: SproutBody): WormPose {
  const base: WormPose = { frame: 'idle_a', rotation: 0, stretchX: 1, stretchY: 1, offsetX: 0, offsetY: 0, tint: null, tintAlpha: 0 };
  const p = sproutProgress(sprout);
  if (sprout.stage === 'plant') {
    if (p < 0.3) return { ...base, frame: 'hold_throw', offsetX: sprout.facing * p * 3 };
    const kneel = Math.sin(clamp((p - 0.3) / 0.7, 0, 1) * Math.PI);
    return { ...base, frame: 'jump_land', stretchX: 1 + kneel * 0.14, stretchY: 1 - kneel * 0.2, offsetX: sprout.facing * (1 + kneel * 1.5) };
  }
  // The ground shakes: it watches, bobbing with the tremors, and throws its arms up at the last crack.
  const bob = Math.abs(Math.sin(input.timeMs / 90)) * 0.6;
  return { ...base, frame: sprout.cracks >= sprout.spec.cracks ? 'taunt' : 'idle_a', offsetY: -bob };
}

function hexPose(input: PoseInput, role: HexRole): WormPose {
  const { hex } = role;
  const base: WormPose = { frame: 'idle_a', rotation: 0, stretchX: 1, stretchY: 1, offsetX: 0, offsetY: 0, tint: null, tintAlpha: 0 };
  const p = hexProgress(hex);
  if (role.role === 'caster') {
    const white: Pick<WormPose, 'tint' | 'tintAlpha'> = { tint: TYRANT_WHITE, tintAlpha: 0.78 * tyrantForm(hex) };
    if (hex.stage !== 'recover') return { ...base, ...white, frame: 'hold_gun', stretchY: 1 + Math.sin(input.timeMs / 400) * 0.015 };
    const laugh = hex.burst ? Math.abs(Math.sin(input.timeMs / 85)) : 0;
    return { ...base, ...white, frame: p < 0.2 ? 'hold_gun' : 'taunt', offsetY: -laugh * 0.9, stretchY: 1 + laugh * 0.04 };
  }
  switch (hex.stage) {
    case 'point':
      return { ...base, frame: 'idle_b' };
    case 'shot':
      return { ...base, frame: p > 0.55 ? 'hurt' : 'idle_b' };
    case 'rise':
    case 'swell': {
      const s = swelling(hex);
      return {
        ...base,
        frame: hex.stage === 'rise' && p < 0.15 ? 'hurt' : 'drown_gasp',
        stretchX: s.x,
        stretchY: s.y,
        // Swollen about its middle, not its feet: the feet go down as the body grows.
        offsetY: ((s.y - 1) * WORM_HEIGHT) / 2,
        offsetX: Math.sin(input.timeMs / 13) * tremble(hex) * 1.3,
        // Pink enough to glow, never so pink that the gasping face is lost.
        tint: HEX_PINK,
        tintAlpha: 0.12 + 0.3 * innerGlow(hex),
      };
    }
    default:
      return base;
  }
}

/**
 * The pose of one worm this frame: its motion, the presentation cues and a super move, in that
 * order of precedence from the bottom up (a fight beats everything, a flight beats a flinch).
 */
export function poseFor(input: PoseInput): WormPose {
  const { worm, anim, timeMs } = input;
  if (input.fight !== undefined) return fightPose(input, input.fight);
  if (input.beam !== undefined) return beamPose(input, input.beam);
  if (input.devour !== undefined) return devourPose(input, input.devour);
  if (input.hex !== undefined) return hexPose(input, input.hex);
  if (input.sprout !== undefined) return sproutPose(input, input.sprout);
  const plain: WormPose = { frame: wormFrameId(worm, timeMs), rotation: 0, stretchX: 1, stretchY: 1, offsetX: 0, offsetY: 0, tint: null, tintAlpha: 0 };
  // The hit flash rides on whatever the body is doing: white for a moment, then red, fading.
  const hurtMs = anim?.hurtMs ?? Infinity;
  const flash: Pick<WormPose, 'tint' | 'tintAlpha'> =
    hurtMs < 70 ? { tint: '#ffffff', tintAlpha: 0.85 }
    : hurtMs < 320 ? { tint: '#ff2020', tintAlpha: 0.55 * (1 - (hurtMs - 70) / 250) }
    : { tint: null, tintAlpha: 0 };
  if (!worm.alive) return plain;
  if (worm.motion === 'drowning') return { ...plain, ...flash };
  if (worm.motion === 'flying') {
    // Thrown worms tumble, faster the harder they were hit; fx integrates the turn tick by tick.
    return { ...plain, ...flash, frame: 'knocked', rotation: anim?.tumble ?? 0 };
  }
  if (worm.motion === 'jumping' && worm.vx * worm.facing < 0) {
    // A backflip: one full turn over the arc, backwards.
    const progress = clamp((worm.vy + 260) / 520, 0, 1);
    return { ...plain, ...flash, frame: 'backflip', rotation: -worm.facing * progress * Math.PI * 2 };
  }
  if (worm.motion === 'jumping' || worm.motion === 'falling') {
    const stretch = clamp(Math.abs(worm.vy) / 1400, 0, 0.18);
    return { ...plain, ...flash, frame: worm.vy > 90 ? 'fall' : 'jump_air', stretchX: 1 - stretch * 0.5, stretchY: 1 + stretch };
  }
  if (worm.motion === 'parachuting' || worm.motion === 'jetpacking') return { ...plain, ...flash };
  if (hurtMs < 420) return { ...plain, ...flash, frame: 'hurt', offsetX: hurtMs < 120 ? Math.sin(hurtMs / 9) * 1.2 : 0 };
  const landedMs = anim?.landedMs ?? Infinity;
  if (landedMs < 170) {
    const k = (1 - landedMs / 170) * clamp((anim?.landSpeed ?? 0) / 700, 0.12, 0.35);
    return { ...plain, frame: 'jump_land', stretchX: 1 + k, stretchY: 1 - k };
  }
  if ((anim?.swingMs ?? Infinity) < 300) return { ...plain, frame: 'hold_melee', offsetX: worm.facing * 1.5 };
  const firedMs = anim?.firedMs ?? Infinity;
  if (firedMs < 260 && anim?.firedWeapon != null) {
    const kind = getWeapon(anim.firedWeapon).kind;
    const thrown = kind === 'TIMED' || kind === 'PLACED' || kind === 'ANIMAL';
    const kick = 1 - firedMs / 260;
    return { ...plain, frame: thrown ? 'hold_throw' : 'fire_recoil', offsetX: thrown ? worm.facing * kick : -worm.facing * kick * 2 };
  }
  if (Math.abs(worm.vx) > 5) {
    const bob = Math.abs(Math.sin(timeMs / 70));
    return { ...plain, offsetY: -bob * 0.8, stretchY: 1 + bob * 0.04 };
  }
  if (input.victory === true) {
    const hop = Math.abs(Math.sin(timeMs / 170));
    return { ...plain, frame: hop > 0.6 ? 'victory' : 'taunt', offsetY: -hop * 5, stretchY: 1 + (1 - hop) * 0.05 };
  }
  const breath = 1 + Math.sin(timeMs / 520 + worm.x * 0.13) * 0.025;
  if (input.aiming !== undefined && input.aiming !== null) {
    const pop = anim === undefined ? 0 : Math.max(0, 1 - anim.switchedMs / 220);
    return { ...plain, frame: holdPose(input.aiming), stretchY: breath + pop * 0.08, stretchX: 1 - pop * 0.04 };
  }
  // A badly hurt worm winces now and then.
  if (worm.hp > 0 && worm.hp < (worm.maxHp ?? GAME_CONFIG.wormHp) * 0.3 && Math.floor((timeMs + worm.x * 37) / 400) % 6 === 0) return { ...plain, frame: 'hurt', stretchY: breath };
  return { ...plain, stretchY: breath };
}

/** 0 for a healthy worm, 1 for one on its last legs: how much blood the sprite wears. */
export function woundLevel(hp: number, maxHp: number = GAME_CONFIG.wormHp): number {
  return clamp((1 - hp / Math.max(1, maxHp) - 0.1) / 0.8, 0, 1);
}

/** Builds an ellipse path centred at (cx, cy) with radii (rx, ry); leaves it current for fill or stroke. */
function ellipsePath(ctx: Ctx2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.restore();
}

/** Cloud blobs in world x, drawn with parallax and wrapped so some are always in view. */
const CLOUDS: readonly { readonly x: number; readonly y: number; readonly s: number }[] = Object.freeze([
  { x: 120, y: 74, s: 1.0 },
  { x: 560, y: 46, s: 1.4 },
  { x: 980, y: 104, s: 0.8 },
  { x: 1420, y: 66, s: 1.2 },
  { x: 1840, y: 96, s: 0.9 },
]);

/** A soft sun: concentric arcs of falling alpha, since Ctx2D has no radial gradient. */
function drawSun(ctx: Ctx2D, cx: number, cy: number, radius: number): void {
  for (let i = 6; i >= 1; i -= 1) {
    ctx.globalAlpha = 0.05 + (6 - i) * 0.012;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (i / 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** One rolling silhouette ridge, sampled from two sines so it does not read as a pure wave. */
function drawRidge(ctx: Ctx2D, viewport: Size, camera: Camera, baseY: number, parallax: number, amp: number, wavelength: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, viewport.h);
  for (let x = 0; x <= viewport.w; x += 8) {
    const wx = x + camera.x * parallax;
    const y = baseY - amp * (0.55 + 0.45 * Math.sin(wx / wavelength) * Math.cos(wx / (wavelength * 2.3)));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(viewport.w, viewport.h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawClouds(ctx: Ctx2D, viewport: Size, camera: Camera, timeMs: number): void {
  const span = viewport.w + 400;
  const drift = timeMs * 0.004;
  ctx.fillStyle = '#ffffff';
  for (const cloud of CLOUDS) {
    let sx = ((cloud.x + drift - camera.x * 0.14 + 200) % span + span) % span - 200;
    if (!Number.isFinite(sx)) continue;
    sx = Math.round(sx);
    const r = 22 * cloud.s;
    ctx.globalAlpha = 0.82;
    ellipsePath(ctx, sx, cloud.y, r * 1.6, r * 0.7);
    ctx.fill();
    ellipsePath(ctx, sx - r * 0.9, cloud.y + r * 0.22, r * 1.0, r * 0.52);
    ctx.fill();
    ellipsePath(ctx, sx + r * 0.95, cloud.y + r * 0.26, r * 0.9, r * 0.46);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSky(ctx: Ctx2D, viewport: Size, camera: Camera, horizonY: number, timeMs: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, viewport.h);
  sky.addColorStop(0, '#2d6ea6');
  sky.addColorStop(0.34, '#6aa6cf');
  sky.addColorStop(0.66, '#a9d0e5');
  sky.addColorStop(1, '#e7dcbc');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  drawSun(ctx, viewport.w * 0.8, viewport.h * 0.17, 34);
  drawClouds(ctx, viewport, camera, timeMs);

  // Two ridges behind the playfield: the far one hazier and slower, the near one darker.
  drawRidge(ctx, viewport, camera, horizonY + 26, 0.22, 58, 260, '#7ea6b8', 0.55);
  drawRidge(ctx, viewport, camera, horizonY + 48, 0.42, 44, 170, '#4f7a6a', 0.7);
}

function drawWater(ctx: Ctx2D, viewport: Size, camera: Camera, waterY: number, timeMs: number): void {
  const surface = worldToScreen(camera, viewport, { x: camera.x, y: waterY }).y;
  if (surface > viewport.h) return;
  const wave = (x: number): number => {
    const wx = x + camera.x;
    return surface + Math.sin(wx / 44 + timeMs / 800) * 2.5 + Math.sin(wx / 19 - timeMs / 430) * 1.2;
  };

  const body = ctx.createLinearGradient(0, surface, 0, viewport.h);
  body.addColorStop(0, 'rgba(86, 166, 214, 0.58)');
  body.addColorStop(1, 'rgba(16, 54, 102, 0.88)');
  ctx.beginPath();
  ctx.moveTo(0, wave(0));
  for (let x = 6; x <= viewport.w; x += 6) ctx.lineTo(x, wave(x));
  ctx.lineTo(viewport.w, viewport.h);
  ctx.lineTo(0, viewport.h);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  // Foam line on the crest.
  ctx.beginPath();
  ctx.moveTo(0, wave(0));
  for (let x = 6; x <= viewport.w; x += 6) ctx.lineTo(x, wave(x));
  ctx.strokeStyle = 'rgba(233, 247, 255, 0.72)';
  ctx.lineWidth = 2;
  ctx.stroke();
}


export interface WormVisual {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly color: string;
  readonly name: string;
  readonly hp: number;
  readonly active: boolean;
  readonly motion: WormMotion;
  readonly alive: boolean;
  /** Team colour index, used to pick this worm's character sprite set. */
  readonly colorIndex: number;
  /** Stable per worm seed for where its wounds sit. */
  readonly seed?: number;
  /** 1 for a worm (when absent), less for a Saibaman: drawn that much smaller. */
  readonly size?: number;
  /** A colour washed over the whole body (the Saibaman's green), under the hit flash. */
  readonly skin?: string | null;
  /** Its full health (half a worm's for a Saibaman), for how hurt it looks; a worm's when absent. */
  readonly maxHp?: number;
}

/** How one worm is drawn this frame beyond its pose. */
interface WormLook {
  readonly pose: WormPose;
  /** 0..1 blood on the body. */
  readonly wounds: number;
  /** Solid colour over the whole sprite (the super's silhouettes), overriding the pose's tint. */
  readonly silhouette?: string;
  readonly showTag: boolean;
}

/**
 * Blood on the body, in frame px of a 96 px worm frame (feet at 84, body from about 36 down):
 * blotches and runs that stay put for this worm as it moves, more of them the worse it is hurt.
 * Painted with source-atop on the scratch canvas, so anything off the silhouette never shows.
 */
function paintWounds(s: Ctx2D, w: number, h: number, wounds: number, seed: number): void {
  const count = Math.ceil(wounds * 11);
  const kx = w / 96;
  const ky = h / 96;
  for (let i = 0; i < count; i += 1) {
    const x = (34 + hash01(seed, i) * 28) * kx;
    const y = (42 + hash01(seed, i + 50) * 38) * ky;
    const r = (2.4 + hash01(seed, i + 100) * 3.6 * (0.6 + wounds * 0.6)) * kx;
    s.fillStyle = hash01(seed, i + 150) < 0.5 ? 'rgba(140, 0, 10, 0.92)' : 'rgba(96, 0, 6, 0.95)';
    s.beginPath();
    s.arc(x, y, r, 0, Math.PI * 2);
    s.fill();
    // A run of blood down from the wound.
    const run = (4 + hash01(seed, i + 200) * 12) * ky * (0.5 + wounds);
    s.fillRect(x - r * 0.3, y, r * 0.6, run);
  }
}

function scratchFrameFor(w: number, h: number): AtlasFrame {
  return { frame: { x: 0, y: 0, w, h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h } };
}

/**
 * Draws a sprite frame with a composite on top: wounds and a tint, clipped to the sprite's own
 * pixels on the scratch surface, then placed exactly as drawSprite would place the frame itself.
 */
function drawComposite(ctx: Ctx2D, set: CharacterSprites, frame: AtlasFrame, pivot: AtlasPoint, options: SpriteOptions, scratch: Scratch, look: { readonly wounds: number; readonly seed: number; readonly tint: string | null; readonly tintAlpha: number }): void {
  const w = frame.sourceSize.w;
  const h = frame.sourceSize.h;
  if (w > scratch.size || h > scratch.size) {
    drawSprite(ctx, set.image, frame, pivot, options);
    return;
  }
  const s = scratch.ctx;
  s.save();
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'source-over';
  s.imageSmoothingEnabled = false;
  s.clearRect(0, 0, w, h);
  s.drawImage(set.image, frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h, frame.spriteSourceSize.x, frame.spriteSourceSize.y, frame.frame.w, frame.frame.h);
  s.globalCompositeOperation = 'source-atop';
  if (look.wounds > 0) paintWounds(s, w, h, look.wounds, look.seed);
  if (look.tint !== null && look.tintAlpha > 0) {
    s.globalAlpha = clamp(look.tintAlpha, 0, 1);
    s.fillStyle = look.tint;
    s.fillRect(0, 0, w, h);
  }
  s.restore();
  drawSprite(ctx, scratch.canvas, scratchFrameFor(w, h), pivot, options);
}

function drawWorm(ctx: Ctx2D, viewport: Size, camera: Camera, worm: WormVisual, look: WormLook, timeMs: number, sprites?: ReadonlyMap<number, CharacterSprites>, scratch?: Scratch | null): void {
  // A Saibaman is the same worm drawn smaller: every size below goes through z.
  const z = camera.zoom * (worm.size ?? 1);
  const pose = look.pose;
  const feet = worldToScreen(camera, viewport, { x: worm.x + pose.offsetX, y: worm.y + pose.offsetY });
  const walking = Math.abs(worm.vx) > 5;
  const airborne = Math.abs(worm.vy) > 25;

  // Ground shadow stays on the ground; the body bobs, squashes and tumbles above it.
  if (look.silhouette === undefined) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ellipsePath(ctx, feet.x, feet.y - 1 * z, 8 * z, 2.4 * z);
    ctx.fill();
  }

  // Rotation turns the body about its middle, not its feet: place the pivot where the feet swing to.
  const half = (WORM_HEIGHT / 2) * z;
  const pivotX = pose.rotation === 0 ? feet.x : feet.x - Math.sin(pose.rotation) * half;
  const pivotY = pose.rotation === 0 ? feet.y : feet.y - half + Math.cos(pose.rotation) * half;

  // Generated character sprite when its atlas is loaded; the procedural worm below is the fallback.
  const set = sprites?.get(worm.colorIndex);
  if (set !== undefined) {
    const frame = set.atlas.frame(pose.frame) ?? set.atlas.frame(wormFrameId(worm, timeMs));
    if (frame !== undefined) {
      // No extra scale: frameUnit already divides by SPRITE_SCALE, the engine's 3x authoring
      // convention, so a 48 px worm inside a 96 px frame lands at 48*z/3 = WORM_HEIGHT*z on screen.
      const options: SpriteOptions = {
        x: pivotX,
        y: pivotY,
        zoom: z,
        flipX: worm.facing === -1,
        rotation: pose.rotation,
        stretchX: pose.stretchX,
        stretchY: pose.stretchY,
      };
      // The hit flash wins over the skin; the skin over nothing.
      const skinned = pose.tint === null && worm.skin !== undefined && worm.skin !== null;
      const tint = look.silhouette ?? (skinned ? worm.skin ?? null : pose.tint);
      const tintAlpha = look.silhouette !== undefined ? 1 : skinned ? SAIBA_SKIN_ALPHA : pose.tintAlpha;
      const wounds = look.silhouette !== undefined ? 0 : look.wounds;
      if (scratch !== undefined && scratch !== null && (wounds > 0 || (tint !== null && tintAlpha > 0))) {
        drawComposite(ctx, set, frame, set.atlas.pivotOf(frame), options, scratch, { wounds, seed: worm.seed ?? 0, tint, tintAlpha });
      } else {
        drawSprite(ctx, set.image, frame, set.atlas.pivotOf(frame), options);
      }
      if (look.showTag) drawWormTag(ctx, feet.x, feet.y - WORM_HEIGHT * z - 20, worm, timeMs);
      return;
    }
  }

  const phase = worm.x * 0.13;
  const bob = airborne ? 0 : Math.sin(timeMs / 360 + phase) * 1.1 * z;
  const stretch = airborne ? Math.max(-0.18, Math.min(0.18, worm.vy / 900)) : 0;
  const bodyH = WORM_HEIGHT * z * (1 + stretch) * pose.stretchY;
  const bodyRx = 6.2 * z * (1 - stretch * 0.6) * pose.stretchX;
  const cx = feet.x;
  const cy = feet.y - bodyH * 0.5 - bob;
  const lean = walking ? worm.facing * 0.06 : 0;
  const silhouette = look.silhouette;

  ctx.save();
  ctx.translate(cx, cy);
  if (lean + pose.rotation !== 0) ctx.rotate(lean + pose.rotation);

  // Feet: two nubs, alternating on the walk cycle.
  const step = walking ? Math.sin(timeMs / 90 + phase) * 2 * z : 0;
  ctx.fillStyle = silhouette ?? WORM_OUTLINE;
  ellipsePath(ctx, -2.6 * z, bodyH * 0.5 - 0.5 * z + step, 2.6 * z, 1.5 * z);
  ctx.fill();
  ellipsePath(ctx, 2.6 * z, bodyH * 0.5 - 0.5 * z - step, 2.6 * z, 1.5 * z);
  ctx.fill();

  // Body with a dark outline, a lit belly and a shaded back.
  ellipsePath(ctx, 0, 0, bodyRx, bodyH * 0.5);
  ctx.fillStyle = silhouette ?? (pose.tint !== null && pose.tintAlpha > 0.3 ? pose.tint : worm.skin ?? WORM_SKIN);
  ctx.fill();
  if (silhouette !== undefined) {
    ctx.restore();
    return;
  }
  ctx.strokeStyle = WORM_OUTLINE;
  ctx.lineWidth = Math.max(1, 1.1 * z);
  ctx.stroke();
  ctx.fillStyle = WORM_SKIN_SHADE;
  ellipsePath(ctx, -worm.facing * 2.4 * z, 1.5 * z, 3.0 * z, bodyH * 0.32);
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Wounds: dark blotches on the body, more the worse it is hurt.
  const blotches = Math.ceil(look.wounds * 6);
  for (let i = 0; i < blotches; i += 1) {
    ctx.fillStyle = 'rgba(130, 0, 8, 0.85)';
    ctx.beginPath();
    ctx.arc((hash01(worm.seed ?? 0, i) - 0.5) * bodyRx * 1.2, (hash01(worm.seed ?? 0, i + 9) - 0.3) * bodyH * 0.6, (0.8 + hash01(worm.seed ?? 0, i + 18)) * z, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bandana across the forehead in the team colour, with a knot tail on the back side.
  const browY = -bodyH * 0.22;
  ctx.fillStyle = worm.color;
  ellipsePath(ctx, 0, browY, bodyRx * 0.98, 1.9 * z);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-worm.facing * bodyRx * 0.7, browY);
  ctx.lineTo(-worm.facing * (bodyRx + 3.2 * z), browY - 1.6 * z);
  ctx.lineTo(-worm.facing * (bodyRx + 3.2 * z), browY + 2.4 * z);
  ctx.closePath();
  ctx.fill();

  // Eyes look toward the facing direction; a pupil and a highlight give it life.
  const eyeY = -bodyH * 0.06;
  const eyeDx = 2.1 * z;
  const look2 = worm.facing * 0.7 * z;
  for (const ex of [-eyeDx, eyeDx]) {
    ellipsePath(ctx, ex + worm.facing * 0.6 * z, eyeY, 1.7 * z, 2.0 * z);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(0.6, 0.5 * z);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex + look2, eyeY + 0.3 * z, 0.9 * z, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a';
    ctx.fill();
  }
  ctx.restore();

  if (look.showTag) drawWormTag(ctx, feet.x, cy - bodyH * 0.5 - 20, worm, timeMs);
}

/** Name and health tag, plus the bobbing turn arrow. Shared by the sprite and fallback paths. */
function drawWormTag(ctx: Ctx2D, cx: number, tagY: number, worm: WormVisual, timeMs: number): void {
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = `${worm.name} ${Math.max(0, Math.round(worm.hp))}`;
  const tw = labelWidth(label, 11) + 10;
  ctx.fillStyle = worm.active ? 'rgba(255,255,255,0.94)' : 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - tw / 2, tagY, tw, 15);
  ctx.fillStyle = worm.active ? '#111' : '#f2f2f2';
  ctx.fillText(label, cx, tagY + 12);

  if (worm.active) {
    const ay = tagY - 6 - Math.abs(Math.sin(timeMs / 240)) * 4;
    ctx.fillStyle = worm.color;
    ctx.beginPath();
    ctx.moveTo(cx - 5, ay - 8);
    ctx.lineTo(cx + 5, ay - 8);
    ctx.lineTo(cx, ay);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** How far out the reticle sits along the aim, world px (the source's crosshair distance). */
const RETICLE_PX = 34;
/** The laser sight's reach, world px. */
const LASER_PX = 520;

function aimDirection(angleDeg: number, facing: number): { readonly x: number; readonly y: number } {
  const a = degToRad(angleDeg);
  return { x: Math.cos(a) * facing, y: -Math.sin(a) };
}

/**
 * The aim: the arm, a reticle out along the aim (red, pulsing while the shot charges), and a charge
 * wedge from yellow to red that grows with the power, so the aim and the power read at the worm
 * instead of only in the HUD corner.
 */
function drawAim(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, angleDeg: number, facing: number, power: number, timeMs: number, armColor: string, size = 1): void {
  const z = camera.zoom;
  const shoulder = worldToScreen(camera, viewport, { x, y: y - WORM_HEIGHT * size * 0.55 });
  const dir = aimDirection(angleDeg, facing);

  // The arm: a short thick stub from the shoulder in the aim direction, in the body's colour.
  const armLen = 10 * z * size;
  const hand = { x: shoulder.x + dir.x * armLen, y: shoulder.y + dir.y * armLen };
  ctx.strokeStyle = armColor;
  ctx.lineWidth = Math.max(2, 3 * z * size);
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hand.x, hand.y);
  ctx.stroke();

  // The charge wedge: widening dots from the hand toward the reticle, yellow to red.
  if (power > 0) {
    const steps = Math.max(2, Math.round(power * 14));
    for (let i = 0; i < steps; i += 1) {
      const t = i / 13;
      const d = (6 + t * (RETICLE_PX - 8)) * z;
      const r = (0.8 + t * 2.4) * z;
      ctx.fillStyle = `rgb(255, ${Math.round(220 - t * 200)}, ${Math.round(60 - t * 60)})`;
      ctx.beginPath();
      ctx.arc(hand.x + dir.x * d, hand.y + dir.y * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The reticle.
  const cx = shoulder.x + dir.x * RETICLE_PX * z;
  const cy = shoulder.y + dir.y * RETICLE_PX * z;
  const r = (3.2 + (power > 0 ? Math.sin(timeMs / 60) * 0.5 : 0)) * z;
  ctx.lineWidth = Math.max(1.5, 0.9 * z);
  for (const [color, width] of [['rgba(0,0,0,0.55)', 2.2], ['#ff3030', 1]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * z * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.9, cy);
    ctx.lineTo(cx - r * 0.6, cy);
    ctx.moveTo(cx + r * 0.6, cy);
    ctx.lineTo(cx + r * 1.9, cy);
    ctx.moveTo(cx, cy - r * 1.9);
    ctx.lineTo(cx, cy - r * 0.6);
    ctx.moveTo(cx, cy + r * 0.6);
    ctx.lineTo(cx, cy + r * 1.9);
    ctx.stroke();
  }
}

/**
 * Laser sight for the guns: a thin red beam from the muzzle to the first land or worm it meets,
 * with a dot where the round would land; brighter when it is on a worm.
 */
function drawLaser(ctx: Ctx2D, viewport: Size, camera: Camera, world: SimWorld, body: SimWorld['worms'][number], angleDeg: number, timeMs: number): void {
  const dir = aimDirection(angleDeg, body.facing);
  // The muzzle and the hit test the guns use (behaviors/types.ts muzzlePoint, hitscan.ts), a Saibaman's smaller body included.
  const mx = body.x + body.facing * 6 * body.size;
  const my = body.y - wormHeight(body) * 0.6;
  const wall = sweep(world.terrain.mask, mx, my, mx + dir.x * LASER_PX, my + dir.y * LASER_PX, 0);
  let reach = wall.hit === null ? LASER_PX : Math.hypot(wall.x - mx, wall.y - my);
  let onWorm = false;
  for (const other of world.worms) {
    if (!other.alive || other.id === body.id) continue;
    const ox = other.x;
    const oy = wormMiddleY(other);
    const t = (ox - mx) * dir.x + (oy - my) * dir.y;
    if (t < 0 || t > reach) continue;
    if (Math.hypot(mx + dir.x * t - ox, my + dir.y * t - oy) <= wormHalfWidth(other) + 2) {
      reach = t;
      onWorm = true;
    }
  }
  const from = worldToScreen(camera, viewport, { x: mx, y: my });
  const to = worldToScreen(camera, viewport, { x: mx + dir.x * reach, y: my + dir.y * reach });
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ff1f1f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = onWorm ? '#ff4040' : '#ff1f1f';
  ctx.beginPath();
  ctx.arc(to.x, to.y, (onWorm ? 2.6 + Math.sin(timeMs / 70) * 0.6 : 1.6) * camera.zoom * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A melee weapon's reach: a faint arc in front of the worm where a blow connects. */
function drawReach(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, facing: 1 | -1, reachPx: number, size = 1): void {
  const c = worldToScreen(camera, viewport, { x, y: y - (WORM_HEIGHT * size) / 2 });
  const from = facing === 1 ? -1.3 : Math.PI - 0.5;
  const to = facing === 1 ? 0.5 : Math.PI + 1.3;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, reachPx * camera.zoom, from, to);
  ctx.stroke();
  ctx.restore();
}

/**
 * The super move's reach and lock: a dashed ring for the range and, on the worm it would rush,
 * red brackets closing in and the words LOCK ON. With nobody in reach the ring alone says so.
 */
function drawLock(ctx: Ctx2D, viewport: Size, camera: Camera, world: SimWorld, body: SimWorld['worms'][number], rangePx: number, timeMs: number): void {
  const z = camera.zoom;
  const c = worldToScreen(camera, viewport, { x: body.x, y: wormMiddleY(body) });
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 210, 60, 0.55)';
  ctx.lineWidth = 1.5;
  const dashes = 48;
  const spin = timeMs / 4000;
  for (let i = 0; i < dashes; i += 2) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, rangePx * z, spin + (i / dashes) * Math.PI * 2, spin + ((i + 1) / dashes) * Math.PI * 2);
    ctx.stroke();
  }
  const target = lockTarget(world, body, rangePx);
  if (target !== null) {
    const t = worldToScreen(camera, viewport, { x: target.x, y: wormMiddleY(target) });
    const pulse = 1 - ((timeMs / 500) % 1) * 0.35;
    const r = 11 * z * pulse * (0.4 + 0.6 * target.size);
    const arm = r * 0.45;
    ctx.strokeStyle = '#ff2626';
    ctx.lineWidth = Math.max(1.5, 0.9 * z);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(t.x + sx * r, t.y + sy * (r - arm));
      ctx.lineTo(t.x + sx * r, t.y + sy * r);
      ctx.lineTo(t.x + sx * (r - arm), t.y + sy * r);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ff2626';
    ctx.fillText('LOCK ON', t.x, t.y - r - 3);
  }
  ctx.restore();
}

/** In flight sprites from the weapon atlas's held layers, with a scale that brings each to its body size. */
const FLIGHT_SPRITES: Readonly<Record<string, { readonly frame: string; readonly scale: number }>> = Object.freeze({
  grenade: { frame: 'weapon_held_grenade', scale: 0.95 },
  cluster_bomb: { frame: 'weapon_held_cluster_bomb', scale: 0.6 },
  banana_bomb: { frame: 'weapon_held_banana_bomb', scale: 0.6 },
  banana_bomblet: { frame: 'weapon_held_banana_bomb', scale: 0.45 },
  holy_hand_grenade: { frame: 'weapon_held_holy_hand_grenade', scale: 0.85 },
  dynamite: { frame: 'weapon_held_dynamite', scale: 0.55 },
});
const CENTER_PIVOT: AtlasPoint = Object.freeze({ x: 0.5, y: 0.5 });

const ROCKET_COLORS: Readonly<Record<string, string>> = Object.freeze({
  bazooka: '#6b7d3a',
  homing_missile: '#e6e6e6',
  tank: '#7d7d7d',
  mortar: '#3d3d3d',
  napalm: '#b3261e',
});

/** A rocket, drawn along its heading: a flickering exhaust, the body, a red nose and two fins. */
function drawRocket(ctx: Ctx2D, x: number, y: number, heading: number, z: number, color: string, timeMs: number, thrust: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  if (thrust) {
    const flicker = 0.75 + Math.abs(Math.sin(timeMs / 25)) * 0.5;
    ctx.fillStyle = '#ff9a2a';
    ctx.beginPath();
    ctx.moveTo(-4.5 * z, -1.4 * z);
    ctx.lineTo(-(8 + 4 * flicker) * z, 0);
    ctx.lineTo(-4.5 * z, 1.4 * z);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff2b0';
    ctx.beginPath();
    ctx.moveTo(-4.5 * z, -0.7 * z);
    ctx.lineTo(-(6 + 2 * flicker) * z, 0);
    ctx.lineTo(-4.5 * z, 0.7 * z);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillRect(-4.5 * z, -1.4 * z, 8 * z, 2.8 * z);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-4 * z, -1.2 * z, 7 * z, 0.8 * z);
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(3.5 * z, -1.4 * z);
  ctx.lineTo(6.2 * z, 0);
  ctx.lineTo(3.5 * z, 1.4 * z);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.moveTo(-4.5 * z, -1.4 * z);
  ctx.lineTo(-5.8 * z, -3 * z);
  ctx.lineTo(-2.5 * z, -1.4 * z);
  ctx.moveTo(-4.5 * z, 1.4 * z);
  ctx.lineTo(-5.8 * z, 3 * z);
  ctx.lineTo(-2.5 * z, 1.4 * z);
  ctx.fill();
  ctx.restore();
}

function drawArrow(ctx: Ctx2D, x: number, y: number, heading: number, z: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = '#8b5a2b';
  ctx.lineWidth = Math.max(1, 0.7 * z);
  ctx.beginPath();
  ctx.moveTo(-6 * z, 0);
  ctx.lineTo(4 * z, 0);
  ctx.stroke();
  ctx.fillStyle = '#c9c9c9';
  ctx.beginPath();
  ctx.moveTo(4 * z, -1.3 * z);
  ctx.lineTo(7 * z, 0);
  ctx.lineTo(4 * z, 1.3 * z);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e94f87';
  ctx.fillRect(-6.5 * z, -1.4 * z, 2.4 * z, 1 * z);
  ctx.fillRect(-6.5 * z, 0.4 * z, 2.4 * z, 1 * z);
  ctx.restore();
}

function drawBomb(ctx: Ctx2D, x: number, y: number, heading: number, z: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = '#2d2d2d';
  ellipsePath(ctx, 0, 0, size * 1.5 * z, size * z);
  ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(-0.2 * size * z, -size * z, 0.5 * size * z, 2 * size * z);
  ctx.fillStyle = '#555555';
  ctx.beginPath();
  ctx.moveTo(-1.3 * size * z, 0);
  ctx.lineTo(-2.4 * size * z, -1.2 * size * z);
  ctx.lineTo(-2.4 * size * z, 1.2 * size * z);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Every body in flight looks like what it is, turned to its heading or rolling on the ground. */
function drawProjectile(ctx: Ctx2D, viewport: Size, camera: Camera, p: ProjectileBody, model: RenderModel): void {
  const pos = worldToScreen(camera, viewport, { x: p.x, y: p.y });
  const z = camera.zoom;
  const moving = Math.hypot(p.vx, p.vy) > 4;
  const heading = moving ? Math.atan2(p.vy, p.vx) : 0;
  const sprites = model.weaponSprites;
  const flight = FLIGHT_SPRITES[p.weaponId];
  const frame = flight === undefined || sprites === undefined || sprites === null ? undefined : sprites.atlas.frame(flight.frame);
  if (flight !== undefined && frame !== undefined && sprites !== undefined && sprites !== null) {
    // Thrown things roll: the turn follows the distance travelled, so a resting grenade is still.
    const roll = p.weaponId === 'dynamite' ? 0 : (p.x / Math.max(2, p.spec.radiusPx)) * 0.6;
    drawSprite(ctx, sprites.image, frame, CENTER_PIVOT, { x: pos.x, y: pos.y, zoom: z, scale: flight.scale, rotation: roll });
  } else if (ROCKET_COLORS[p.weaponId] !== undefined) {
    drawRocket(ctx, pos.x, pos.y, heading, z, ROCKET_COLORS[p.weaponId] ?? '#6b7d3a', model.timeMs, p.spec.trail === 'smoke');
  } else if (p.weaponId === 'longbow') {
    drawArrow(ctx, pos.x, pos.y, heading, z);
  } else if (p.weaponId === 'strike_bomb') {
    drawBomb(ctx, pos.x, pos.y, heading, z, 2.2);
  } else if (p.weaponId === 'napalm_blob') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flicker = 0.8 + Math.abs(Math.sin(model.timeMs / 40 + p.id)) * 0.4;
    ctx.fillStyle = '#ff6a00';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 2.6 * z * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd35a';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y - 0.6 * z, 1.4 * z * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (p.kind === 'cluster_child') {
    drawBomb(ctx, pos.x, pos.y, heading, z, 1.3);
  } else {
    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, Math.max(2, p.spec.radiusPx) * z, 0, Math.PI * 2);
    ctx.fill();
  }
  // The fuse, counted down in whole seconds above the body, as the source game shows it.
  if (p.fuseTicks > 0) {
    const seconds = Math.ceil(ticksToMs(p.fuseTicks) / 1000);
    const ty = pos.y - (p.spec.radiusPx + 7) * z;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(String(seconds), pos.x + 1, ty + 1);
    ctx.fillStyle = seconds <= 1 ? '#ff3b30' : '#ffffff';
    ctx.fillText(String(seconds), pos.x, ty);
  }
}

/** A mine: the atlas's mine, or a dark disc, with a light that blinks green at rest and red when armed. */
function drawMine(ctx: Ctx2D, viewport: Size, camera: Camera, mine: SimWorld['mines'][number], model: RenderModel): void {
  const p = worldToScreen(camera, viewport, { x: mine.x, y: mine.y });
  const z = camera.zoom;
  const sprites = model.weaponSprites;
  const frame = sprites === undefined || sprites === null ? undefined : sprites.atlas.frame('weapon_held_mine');
  if (frame !== undefined && sprites !== undefined && sprites !== null) {
    drawSprite(ctx, sprites.image, frame, CENTER_PIVOT, { x: p.x, y: p.y - 1 * z, zoom: z, scale: 0.55 });
  } else {
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 * z, 0, Math.PI * 2);
    ctx.fill();
  }
  const blink = mine.armed ? Math.floor(model.timeMs / 110) % 2 === 0 : Math.floor(model.timeMs / 700) % 3 === 0;
  if (blink) {
    ctx.fillStyle = mine.armed ? '#ff3b30' : '#44ff66';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 3.4 * z, 1.1 * z, 0, Math.PI * 2);
    ctx.fill();
  }
}

interface AuraPalette {
  readonly layers: readonly [string, string, string];
  readonly tongue: string;
}

/** The fighting spirit of a rush super, and the blue ki of a beam. */
const FIRE_AURA: AuraPalette = { layers: ['#ff6a00', '#ffb000', '#fff0a0'], tongue: '#ff8c1a' };
const KI_AURA: AuraPalette = { layers: ['#0a5cff', '#3fb4ff', '#dff7ff'], tongue: '#56c8ff' };
/** The emperor's aura: a dark purple burning round the worm that points. */
const TYRANT_AURA: AuraPalette = { layers: ['#3d0a73', '#8d3cff', '#f1d9ff'], tongue: '#a35cff' };

/** The ki flaring around a worm gathering a super: glowing layers and flickering tongues of flame. */
function drawAura(ctx: Ctx2D, viewport: Size, camera: Camera, worm: WormVisual, strength: number, timeMs: number, palette: AuraPalette = FIRE_AURA): void {
  if (strength <= 0) return;
  const z = camera.zoom;
  const c = worldToScreen(camera, viewport, { x: worm.x, y: worm.y - WORM_HEIGHT / 2 });
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  palette.layers.forEach((color, i) => {
    const pulse = 1 + Math.sin(timeMs / 70 + i * 1.3) * 0.08;
    ctx.globalAlpha = strength * (0.42 - i * 0.1);
    ctx.fillStyle = color;
    ellipsePath(ctx, c.x, c.y, (12 - i * 3) * z * pulse, (16 - i * 3.5) * z * pulse);
    ctx.fill();
  });
  ctx.globalAlpha = strength * 0.55;
  ctx.fillStyle = palette.tongue;
  for (let i = 0; i < 11; i += 1) {
    const a = -Math.PI / 2 + (i - 5) * 0.27;
    const len = (12 + Math.abs(Math.sin(timeMs / 45 + i * 1.7)) * 12) * z;
    const bx = c.x + Math.cos(a) * 7 * z;
    const by = c.y + Math.sin(a) * 11 * z;
    ctx.beginPath();
    ctx.moveTo(bx - 2 * z, by);
    ctx.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
    ctx.lineTo(bx + 2 * z, by);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Radial black strokes out of the beating, manga style, redrawn on every blow. */
function drawSpeedLines(ctx: Ctx2D, cx: number, cy: number, seed: number, alpha: number, viewport: Size): void {
  const reach = Math.hypot(viewport.w, viewport.h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000000';
  for (let i = 0; i < 26; i += 1) {
    const a = hash01(seed, i) * Math.PI * 2;
    const r0 = 90 + hash01(seed, i + 40) * 110;
    const width = 0.004 + hash01(seed, i + 80) * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a - width) * reach, cy + Math.sin(a - width) * reach);
    ctx.lineTo(cx + Math.cos(a + width) * reach, cy + Math.sin(a + width) * reach);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawGame(ctx: Ctx2D, viewport: Size, camera: Camera, model: RenderModel): void {
  // The ridges sit just under the land surface line so they read as distant hills behind it.
  const horizonY = worldToScreen(camera, viewport, { x: camera.x, y: model.world.terrain.height * 0.45 }).y;
  drawSky(ctx, viewport, camera, horizonY, model.timeMs);
  const view = visibleRect(camera, viewport);
  const origin = worldToScreen(camera, viewport, { x: view.x, y: view.y });
  ctx.save();
  ctx.translate(origin.x, origin.y);
  blitTiles(model.world.terrain.tiles, asTileContext(ctx), view, camera.zoom);
  ctx.restore();
  drawWater(ctx, viewport, camera, model.state.waterY, model.timeMs);

  const phase = model.state.phase;
  const activeId = activeWormOf(model.state)?.id;
  const infoById = new Map<string, { hp: number; maxHp: number; color: string; name: string; colorIndex: number; teamId: string }>();
  for (const team of model.state.teams) for (const worm of team.worms) infoById.set(worm.id, { hp: worm.hp, maxHp: worm.maxHp, color: teamColor(team.colorIndex), name: worm.name, colorIndex: team.colorIndex, teamId: team.id });
  const winnerTeam = phase === 'MatchEnd' ? model.state.teams.find((team) => team.worms.some((worm) => worm.alive))?.id : undefined;
  const fights = fightRoles(model.world.combos ?? []);
  const beamers = new Map<string, BeamBody>();
  for (const beam of model.world.beams ?? []) if (beam.alive) beamers.set(beam.attackerId, beam);
  const devours = devourRoles(model.world.devours ?? []);
  const hexes = hexRoles(model.world.hexes ?? []);
  const planters = sproutRoles(model.world.sprouts ?? []);
  // The Freezer's worms drawn with the rest of its scene, on top of everything.
  const hexDrawn = new Set<string>();
  const aimingPhase = phase === 'Active' || phase === 'Firing';
  const visuals = new Map<string, { visual: WormVisual; pose: WormPose; wounds: number }>();

  for (const body of model.world.worms) {
    if (!body.alive) continue;
    const info = infoById.get(body.id);
    if (info === undefined) continue;
    const fight = fights.get(body.id);
    const devour = devours.get(body.id);
    // An attacker its own burst threw flies like any other worm, out of the Freezer's scene.
    const hexRole = hexes.get(body.id);
    const hex = hexRole !== undefined && !(hexRole.role === 'caster' && hexRole.hex.stage === 'recover' && body.motion === 'flying') ? hexRole : undefined;
    // A worm at 0 hp is gone (it burst into gore), unless a super move is still beating it or Gear 5 chewing it.
    if (info.hp <= 0 && fight === undefined && devour === undefined) continue;
    const visual: WormVisual = { x: body.x, y: body.y, vx: body.vx, vy: body.vy, facing: body.facing, color: info.color, name: info.name, hp: info.hp, active: body.id === activeId, motion: body.motion, alive: body.alive, colorIndex: info.colorIndex, seed: seedFromString(body.id), size: body.size, skin: isSaibaman(body) ? SAIBA_GREEN : null, maxHp: info.maxHp };
    const pose = poseFor({
      worm: visual,
      anim: model.anim?.(body.id),
      fight,
      beam: beamers.get(body.id),
      devour,
      hex,
      sprout: planters.get(body.id),
      aiming: body.id === activeId && phase === 'Active' && model.weapon !== undefined ? model.weapon : null,
      victory: winnerTeam !== undefined && info.teamId === winnerTeam,
      timeMs: model.timeMs,
    });
    const wounds = model.gore === false ? 0 : (fight?.role === 'victim' || devour?.role === 'prey') && info.hp <= 0 ? 1 : woundLevel(info.hp, info.maxHp);
    visuals.set(body.id, { visual, pose, wounds });
    // Gear 5's worms and the Freezer's are drawn with the rest of their scene, on top of everything.
    if (hex !== undefined) hexDrawn.add(body.id);
    else if (devour === undefined) drawWorm(ctx, viewport, camera, visual, { pose, wounds, showTag: info.hp > 0 }, model.timeMs, model.sprites, model.scratch);
  }
  for (const crate of model.world.crates) {
    if (!crate.alive) continue;
    drawCrate(ctx, viewport, camera, crate.x, crate.y, crate.kind, crate.landed, model);
  }
  // Saibaman seeds: the seed going in, the mound, the cracks and the light through them.
  for (const sprout of model.world.sprouts ?? []) {
    if (!sprout.alive) continue;
    drawSproutScene(ctx, sprout, worldToScreen(camera, viewport, { x: sprout.spotX, y: sprout.spotY }), worldToScreen(camera, viewport, seedHand(sprout)), camera.zoom, model.timeMs);
  }
  for (const mine of model.world.mines) drawMine(ctx, viewport, camera, mine, model);
  for (const projectile of model.world.projectiles) drawProjectile(ctx, viewport, camera, projectile, model);
  for (const sheep of model.world.sheep) {
    if (!sheep.alive) continue;
    drawSheep(ctx, viewport, camera, sheep.x, sheep.y, sheep.facing, model);
  }

  const activeBody = activeId === undefined ? undefined : model.world.worms.find((b) => b.id === activeId);
  if (activeBody !== undefined && aimingPhase && !fights.has(activeBody.id) && !beamers.has(activeBody.id) && !devours.has(activeBody.id) && !hexes.has(activeBody.id) && !planters.has(activeBody.id)) {
    const def = model.weapon === undefined ? undefined : getWeapon(model.weapon);
    if (def !== undefined && phase === 'Active' && model.aimAssist === true) {
      if (def.beam !== undefined) drawBeamPath(ctx, viewport, camera, activeBody, model.aim.angleDeg, def.beam, model.timeMs);
      else if (def.combo !== undefined) drawLock(ctx, viewport, camera, model.world, activeBody, def.combo.rangePx, model.timeMs);
      else if (def.devour !== undefined) drawLock(ctx, viewport, camera, model.world, activeBody, def.devour.rangePx, model.timeMs);
      else if (def.hex !== undefined) drawLock(ctx, viewport, camera, model.world, activeBody, def.hex.rangePx, model.timeMs);
      else if (def.kind === 'HITSCAN') drawLaser(ctx, viewport, camera, model.world, activeBody, model.aim.angleDeg, model.timeMs);
      else if (def.kind === 'MELEE' && def.melee !== undefined) drawReach(ctx, viewport, camera, activeBody.x, activeBody.y, activeBody.facing, def.melee.reachPx, activeBody.size);
    }
    // Utilities, the air strike, the supers that lock and the seed do not aim: the crosshair or the lock says it all.
    const aims = def === undefined || !(def.kind === 'UTILITY' || def.kind === 'TARGETED' || def.combo !== undefined || def.devour !== undefined || def.hex !== undefined || def.sprout !== undefined);
    const colorIndex = infoById.get(activeBody.id)?.colorIndex ?? 0;
    const armColor = model.sprites?.has(colorIndex) === true ? bodyPalette(colorIndex).skin : WORM_SKIN;
    if (aims) drawAim(ctx, viewport, camera, activeBody.x, activeBody.y, model.aim.angleDeg, activeBody.facing, model.aim.power, model.timeMs, isSaibaman(activeBody) ? SAIBA_GREEN : armColor, activeBody.size);
    drawHeldWeapon(ctx, viewport, camera, activeBody.x, activeBody.y, model.aim.angleDeg, activeBody.facing, model, activeBody.id, activeBody.size);
    drawWeaponLabel(ctx, viewport, camera, activeBody.x, activeBody.y, model, activeBody.id);
  }
  if (model.targeting === true && model.pointer !== undefined && phase === 'Active') {
    drawCrosshair(ctx, viewport, camera, model.pointer, model.timeMs);
  }

  // The rush leaves afterimages behind the attacker, in gold.
  for (const [id, fight] of fights) {
    if (fight.role !== 'attacker' || fight.combo.stage !== 'dash') continue;
    const entry = visuals.get(id);
    if (entry === undefined) continue;
    const { combo } = fight;
    for (const k of [0.2, 0.45, 0.7]) {
      const ghost: WormVisual = { ...entry.visual, x: combo.fromX + (entry.visual.x - combo.fromX) * k, y: combo.fromY + (entry.visual.y - combo.fromY) * k };
      ctx.save();
      ctx.globalAlpha = 0.2 + k * 0.35;
      drawWorm(ctx, viewport, camera, ghost, { pose: entry.pose, wounds: 0, silhouette: '#ffc933', showTag: false }, model.timeMs, model.sprites, model.scratch);
      ctx.restore();
    }
  }

  // The super freeze: the world goes dark around the fighters and the attacker's ki flares up.
  const dim = clamp(model.dim ?? 0, 0, 1);
  if (dim > 0) {
    ctx.save();
    ctx.globalAlpha = dim;
    ctx.fillStyle = '#07000c';
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    ctx.restore();
    for (const [id, fight] of fights) {
      const entry = visuals.get(id);
      if (entry === undefined) continue;
      if (fight.role === 'attacker') drawAura(ctx, viewport, camera, entry.visual, clamp(model.aura ?? 0, 0, 1), model.timeMs);
      drawWorm(ctx, viewport, camera, entry.visual, { pose: entry.pose, wounds: entry.wounds, showTag: false }, model.timeMs, model.sprites, model.scratch);
    }
    for (const id of beamers.keys()) {
      const entry = visuals.get(id);
      if (entry === undefined) continue;
      drawAura(ctx, viewport, camera, entry.visual, clamp(model.aura ?? 0, 0, 1), model.timeMs, KI_AURA);
      drawWorm(ctx, viewport, camera, entry.visual, { pose: entry.pose, wounds: entry.wounds, showTag: false }, model.timeMs, model.sprites, model.scratch);
    }
  }
  // The beam glows over it all, the dimmed world included.
  for (const beam of beamers.values()) drawBeam(ctx, viewport, camera, beam, model.timeMs);
  // Gear 5 too: its worm, its halo and its cloud, the arm, and the mouth with the meal in it.
  for (const devour of model.world.devours ?? []) {
    if (!devour.alive) continue;
    drawDevourScene(ctx, viewport, camera, devour, visuals.get(devour.attackerId), devour.victimId === null || devour.swallowed ? undefined : visuals.get(devour.victimId), model);
  }
  // And the Freezer: the pointing worm in its form, the victim swelling, the light over them both.
  for (const hex of model.world.hexes ?? []) {
    if (!hex.alive) continue;
    const scene = (id: string | null): SceneWorm | undefined => (id !== null && hexDrawn.has(id) ? visuals.get(id) : undefined);
    drawHexScene(ctx, viewport, camera, hex, scene(hex.attackerId), scene(hex.victimId), model);
  }

  // The super move's white screen: the world washes out, the fighters stay on it in black.
  const whiteout = clamp(model.whiteout ?? 0, 0, 1);
  if (whiteout > 0) {
    ctx.save();
    ctx.globalAlpha = whiteout;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    ctx.restore();
    for (const [id, fight] of fights) {
      if (fight.role !== 'victim') continue;
      const combo = fight.combo;
      if (combo.stage !== 'flurry') continue;
      const c = worldToScreen(camera, viewport, { x: combo.holdX, y: combo.holdY - WORM_HEIGHT / 2 });
      drawSpeedLines(ctx, c.x, c.y, seedFromString(id) + combo.hitsLanded * 7919, whiteout * 0.22, viewport);
    }
    ctx.save();
    ctx.globalAlpha = whiteout;
    for (const id of fights.keys()) {
      const entry = visuals.get(id);
      if (entry === undefined) continue;
      drawWorm(ctx, viewport, camera, entry.visual, { pose: entry.pose, wounds: 0, silhouette: '#000000', showTag: false }, model.timeMs, model.sprites, model.scratch);
    }
    ctx.restore();
  }
}

/** Glow layers of a beam and its energy ball, outside in: deep blue, light blue, a white core. */
const BEAM_LAYERS: readonly { readonly color: string; readonly alpha: number; readonly width: number }[] = Object.freeze([
  { color: '#1760ff', alpha: 0.35, width: 2.6 },
  { color: '#62c8ff', alpha: 0.7, width: 1.7 },
  { color: '#ffffff', alpha: 0.95, width: 0.8 },
]);

/** A filled band of width w from a to b; the canvas has no line caps here, the balls round the ends. */
function band(ctx: Ctx2D, a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }, w: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * (w / 2);
  const ny = ((b.x - a.x) / len) * (w / 2);
  ctx.beginPath();
  ctx.moveTo(a.x + nx, a.y + ny);
  ctx.lineTo(b.x + nx, b.y + ny);
  ctx.lineTo(b.x - nx, b.y - ny);
  ctx.lineTo(a.x - nx, a.y - ny);
  ctx.closePath();
  ctx.fill();
}

function energyBall(ctx: Ctx2D, x: number, y: number, r: number, alpha: number): void {
  for (const layer of BEAM_LAYERS) {
    ctx.globalAlpha = layer.alpha * alpha;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.arc(x, y, r * (0.4 + layer.width * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A beam super: the ball of energy gathering in the hands with sparks crackling round it, then the
 * beam itself, glow on glow over a white core, pulsing, with a ball at each end; it thins out as it
 * fades. Screen space, drawn over the dimmed world.
 */
function drawBeam(ctx: Ctx2D, viewport: Size, camera: Camera, beam: BeamBody, timeMs: number): void {
  const z = camera.zoom;
  const p = beamProgress(beam);
  const hands = worldToScreen(camera, viewport, { x: beam.x0, y: beam.y0 });
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (beam.stage === 'charge') {
    // It grows to about the aura's size: the worm must still show behind its own ball of ki.
    const r = (1.8 + 5.2 * p) * z * (1 + Math.sin(timeMs / 35) * 0.08);
    energyBall(ctx, hands.x, hands.y, r, 1);
    ctx.strokeStyle = '#c8f4ff';
    ctx.lineWidth = Math.max(1, 0.7 * z);
    ctx.globalAlpha = 0.85;
    const frame = Math.floor(timeMs / 50);
    const sparks = 2 + Math.floor(p * 6);
    for (let i = 0; i < sparks; i += 1) {
      const a = hash01(frame, i) * Math.PI * 2;
      const d0 = r * 1.1;
      const d1 = r * (1.8 + hash01(frame, i + 20) * 1.4);
      const kink = a + (hash01(frame, i + 40) - 0.5) * 0.9;
      const dm = (d0 + d1) / 2;
      ctx.beginPath();
      ctx.moveTo(hands.x + Math.cos(a) * d0, hands.y + Math.sin(a) * d0);
      ctx.lineTo(hands.x + Math.cos(kink) * dm, hands.y + Math.sin(kink) * dm);
      ctx.lineTo(hands.x + Math.cos(a) * d1, hands.y + Math.sin(a) * d1);
      ctx.stroke();
    }
  } else {
    const fade = beam.stage === 'fade' ? 1 - p : 1;
    const head = worldToScreen(camera, viewport, { x: beam.x0 + beam.dx * beam.length, y: beam.y0 + beam.dy * beam.length });
    const w = beam.spec.radiusPx * z * fade * (1 + Math.sin(timeMs / 28) * 0.1);
    if (w > 0.3) {
      for (const layer of BEAM_LAYERS) {
        ctx.globalAlpha = layer.alpha * Math.min(1, fade * 1.5);
        ctx.fillStyle = layer.color;
        band(ctx, hands, head, w * layer.width);
      }
      energyBall(ctx, hands.x, hands.y, w * 1.25, fade);
      energyBall(ctx, head.x, head.y, w * (beam.stage === 'fire' ? 1.6 : 1.1), fade);
    }
  }
  ctx.restore();
}

/** Where a beam would go: straight through the land to its full reach, as wide as it will be. */
function drawBeamPath(ctx: Ctx2D, viewport: Size, camera: Camera, body: { readonly x: number; readonly y: number; readonly facing: 1 | -1 }, angleDeg: number, spec: BeamSpec, timeMs: number): void {
  const z = camera.zoom;
  const dir = aimDirection(angleDeg, body.facing);
  const hands = { x: body.x + body.facing * 6, y: body.y - WORM_HEIGHT * 0.6 };
  const from = worldToScreen(camera, viewport, hands);
  const to = worldToScreen(camera, viewport, { x: hands.x + dir.x * spec.rangePx, y: hands.y + dir.y * spec.rangePx });
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#4ab8ff';
  band(ctx, from, to, spec.radiusPx * 2 * z);
  // A dotted centre line drifting outward, the way the beam will go.
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#c8f4ff';
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const gap = 10 * z;
  for (let d = (timeMs / 20) % gap; d < len; d += gap) {
    const t = d / len;
    ctx.fillRect(from.x + (to.x - from.x) * t - z, from.y + (to.y - from.y) * t - z, 2 * z, 2 * z);
  }
  ctx.restore();
}

type SceneWorm = { readonly visual: WormVisual; readonly pose: WormPose; readonly wounds: number };

/** The giant head in screen space, or null while there is none. */
function mouthLook(camera: Camera, viewport: Size, devour: DevourBody): MouthLook | null {
  const state = mouthState(devour);
  if (state === null) return null;
  const c = worldToScreen(camera, viewport, { x: devour.holdX + devour.facing * MOUTH_CENTRE_AHEAD_PX, y: devour.holdY - MOUTH_CENTRE_LIFT_PX });
  return { cx: c.x, cy: c.y, r: MOUTH_RADIUS_PX * camera.zoom * state.grow, open: state.open, dir: devour.facing === 1 ? 0 : Math.PI };
}

/**
 * Gear 5, back to front: the halo, the meal while it is still out there, the white worm, its
 * cloud, the giant head with the meal between its jaws, the hat, the arm with the meal in its
 * fist, and the lump going down. The worms come from the frame's pass, posed already.
 */
function drawDevourScene(ctx: Ctx2D, viewport: Size, camera: Camera, devour: DevourBody, eater: SceneWorm | undefined, prey: SceneWorm | undefined, model: RenderModel): void {
  const z = camera.zoom;
  const f = devour.facing;
  const draw = (entry: SceneWorm): void => drawWorm(ctx, viewport, camera, entry.visual, { pose: entry.pose, wounds: entry.wounds, showTag: false }, model.timeMs, model.sprites, model.scratch);
  const middle = worldToScreen(camera, viewport, { x: devour.holdX, y: devour.holdY - WORM_HEIGHT * 0.6 });
  drawSunHalo(ctx, middle.x, middle.y, z, haloStrength(devour), model.timeMs);
  const flying = devour.stage === 'reel';
  const chewing = devour.stage === 'chew';
  if (prey !== undefined && !flying && !chewing) draw(prey);
  if (eater !== undefined) draw(eater);
  const white = gearWhiteness(devour);
  const mouth = mouthLook(camera, viewport, devour);
  const pose = eater?.pose;
  const neck = worldToScreen(camera, viewport, { x: devour.holdX + (pose?.offsetX ?? 0), y: devour.holdY + (pose?.offsetY ?? 0) - WORM_HEIGHT * 0.52 * (pose?.stretchY ?? 1) });
  const headTop = mouth === null ? neck.y - WORM_HEIGHT * 0.5 * z * (pose?.stretchY ?? 1) : mouth.cy - mouth.r;
  drawCloudScarf(ctx, neck.x, neck.y, headTop, z, white, f, model.timeMs);
  if (mouth !== null) {
    drawMouthInside(ctx, mouth);
    if (prey !== undefined && chewing) draw(prey);
    drawMouthHead(ctx, mouth, z);
    drawMouthFace(ctx, mouth, z, f);
  }
  const hat = hatScale(devour) * (mouth === null ? 1 : 0.8 + (mouth.r / (MOUTH_RADIUS_PX * z)) * 0.4);
  const hatX = mouth === null ? neck.x - f * 0.5 * z : mouth.cx - f * mouth.r * 0.15;
  const hatY = mouth === null ? headTop + 1.2 * z : mouth.cy - mouth.r * 0.86;
  drawStrawHat(ctx, hatX, hatY, z, hat, -f * 0.12, Math.min(1, white * 1.4));
  if (prey !== undefined && flying) draw(prey);
  const hand = devourHand(devour);
  if (hand !== null) {
    const shoulder = worldToScreen(camera, viewport, { x: devour.shoulderX, y: devour.shoulderY });
    const fist = worldToScreen(camera, viewport, hand);
    drawRubberArm(ctx, shoulder.x, shoulder.y, fist.x, fist.y, z, model.timeMs);
  }
  const lump = lumpDown(devour);
  if (lump !== null) {
    const at = worldToScreen(camera, viewport, { x: devour.holdX + f * 1.5, y: devour.holdY - WORM_HEIGHT * (0.72 - 0.5 * lump) });
    drawLump(ctx, at.x, at.y, (4.2 - lump * 1.2) * z, z);
  }
}

/** Ticks back along the light's path where its trail beads sit, newest first. */
const HEX_TRAIL_TICKS: readonly number[] = Object.freeze([2, 4, 6, 8, 10, 12]);

/**
 * The Freezer, back to front: the attacker's purple aura, the attacker in the emperor's white with
 * the dome on its head and the light gathering on its fingertip; the victim, glowing pink from inside
 * and breaking out in light as it swells; and the light in flight with its trail, over everything.
 */
function drawHexScene(ctx: Ctx2D, viewport: Size, camera: Camera, hex: HexBody, caster: SceneWorm | undefined, target: SceneWorm | undefined, model: RenderModel): void {
  const z = camera.zoom;
  const draw = (entry: SceneWorm): void => drawWorm(ctx, viewport, camera, entry.visual, { pose: entry.pose, wounds: entry.wounds, showTag: false }, model.timeMs, model.sprites, model.scratch);
  const form = tyrantForm(hex);
  if (caster !== undefined) {
    drawAura(ctx, viewport, camera, caster.visual, form * 0.8, model.timeMs, TYRANT_AURA);
    draw(caster);
    const pose = caster.pose;
    // The dome sits on the crown, over the bandana.
    const crown = worldToScreen(camera, viewport, { x: caster.visual.x + pose.offsetX + hex.facing * 1.4, y: caster.visual.y + pose.offsetY - WORM_HEIGHT * 0.82 * pose.stretchY });
    drawTyrantDome(ctx, crown.x, crown.y, z, hex.facing, form);
    const charge = tipCharge(hex);
    if (charge > 0) {
      const tip = worldToScreen(camera, viewport, { x: hex.tipX, y: hex.tipY });
      drawHexLight(ctx, tip.x, tip.y, z, 0.2 + 0.65 * charge, model.timeMs);
    }
  }
  if (target !== undefined) {
    draw(target);
    const strength = innerGlow(hex);
    if (strength > 0) {
      const pose = target.pose;
      const middle = worldToScreen(camera, viewport, { x: target.visual.x + pose.offsetX, y: target.visual.y + pose.offsetY - (WORM_HEIGHT / 2) * pose.stretchY });
      drawInnerGlow(ctx, middle.x, middle.y, WORM_HALF_WIDTH * 1.4 * pose.stretchX * z, (WORM_HEIGHT / 2) * pose.stretchY * z, strength, pose.stretchX, target.visual.seed ?? 0, model.timeMs);
    }
  }
  const light = hexLight(hex);
  if (light !== null) {
    const trail: { x: number; y: number }[] = [];
    for (const back of HEX_TRAIL_TICKS) {
      const at = hexLight(hex, back);
      if (at !== null) trail.push(worldToScreen(camera, viewport, at));
    }
    drawHexTrail(ctx, trail, z);
    const at = worldToScreen(camera, viewport, light);
    drawHexLight(ctx, at.x, at.y, z, 1, model.timeMs);
  }
}

/**
 * The crosshair of a targeted weapon: where the air strike's bombs come down, where the teleport
 * lands, where the girder goes. Nothing marked the point before, so the player aimed blind at the
 * mouse and the strike seemed to "fire into the sky". A slow pulse keeps it readable over terrain.
 */
function drawCrosshair(ctx: Ctx2D, viewport: Size, camera: Camera, pointer: { readonly x: number; readonly y: number }, timeMs: number): void {
  const p = worldToScreen(camera, viewport, pointer);
  const r = 12 + Math.sin(timeMs / 180) * 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - r - 6, p.y);
  ctx.lineTo(p.x - r + 4, p.y);
  ctx.moveTo(p.x + r - 4, p.y);
  ctx.lineTo(p.x + r + 6, p.y);
  ctx.moveTo(p.x, p.y - r - 6);
  ctx.lineTo(p.x, p.y - r + 4);
  ctx.moveTo(p.x, p.y + r - 4);
  ctx.lineTo(p.x, p.y + r + 6);
  ctx.stroke();
  ctx.restore();
}

/**
 * A supply crate: the weapon atlas's crate icon when it has loaded (health or weapon; the utility
 * crate borrows the weapon icon), otherwise a boxed primitive, both about a worm wide so the
 * player can see it. While it falls a canopy hangs over it. Before this a crate was a 12 px
 * rectangle with no parachute, which is why "crates never fall" was the report. The power orb
 * needs no parachute: it comes down glowing (power-orb.ts).
 */
function drawCrate(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, kind: CrateKind, landed: boolean, model: RenderModel): void {
  const p = worldToScreen(camera, viewport, { x, y });
  const z = camera.zoom;
  if (kind === 'power') {
    drawPowerOrb(ctx, p.x, p.y, z, model.timeMs, landed);
    return;
  }
  const size = 14 * z;
  const sprites = model.weaponSprites;
  const frameId = kind === 'health' ? 'weapon_icon_crate_health' : 'weapon_icon_crate_weapon';
  const frame = sprites === undefined || sprites === null ? undefined : sprites.atlas.frame(frameId);
  if (frame !== undefined && sprites !== undefined && sprites !== null) {
    // The icon is a 64 px cell; frameUnit divides the zoom by SPRITE_SCALE, so this lands at about
    // 14 world px, and the pivot sits on the bottom edge so the crate rests on its feet position.
    drawSprite(ctx, sprites.image, frame, { x: 0.5, y: 0.92 }, { x: p.x, y: p.y, zoom: z, scale: 0.75 });
  } else {
    ctx.fillStyle = kind === 'health' ? '#3ecf5a' : kind === 'utility' ? '#5aa7e6' : '#c9a13a';
    ctx.fillRect(p.x - size / 2, p.y - size, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - size / 2, p.y - size, size, size);
  }
  if (!landed) {
    // Canopy and lines: a half disc above the crate, three strings down to its corners.
    const top = p.y - size - 22 * z;
    ctx.fillStyle = 'rgba(255, 140, 60, 0.95)';
    ctx.beginPath();
    ctx.arc(p.x, top, 16 * z, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const dx of [-16, 0, 16]) {
      ctx.moveTo(p.x + dx * z, top);
      ctx.lineTo(p.x + (dx / 3) * z, p.y - size);
    }
    ctx.stroke();
  }
}

/**
 * A live sheep: the weapon atlas's held layer of the sheep when it has loaded (it is the only sheep
 * art there is), otherwise a primitive body. Feet at (x, y), facing flips the drawing. Until this
 * existed the sheep ran its whole 20 s life invisible, which read as "the sheep does nothing".
 */
function drawSheep(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, facing: 1 | -1, model: RenderModel): void {
  const p = worldToScreen(camera, viewport, { x, y });
  const sprites = model.weaponSprites;
  const frame = sprites === undefined || sprites === null ? undefined : sprites.atlas.frame('weapon_held_sheep');
  if (frame !== undefined && sprites !== undefined && sprites !== null) {
    // The held layer is authored 60 px wide for a 48 px worm; the sheep is about a worm tall.
    drawSprite(ctx, sprites.image, frame, { x: 0.5, y: 0.95 }, { x: p.x, y: p.y, zoom: camera.zoom, flipX: facing === -1, scale: 0.6 });
    return;
  }
  const z = camera.zoom;
  ctx.fillStyle = '#f4f1e8';
  ctx.beginPath();
  ctx.arc(p.x - 2.5 * z, p.y - 5 * z, 4 * z, 0, Math.PI * 2);
  ctx.arc(p.x + 2.5 * z, p.y - 5 * z, 4 * z, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.arc(p.x + facing * 5 * z, p.y - 6 * z, 2.2 * z, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(p.x - 4 * z, p.y - 2 * z, 1.5 * z, 2 * z);
  ctx.fillRect(p.x + 2 * z, p.y - 2 * z, 1.5 * z, 2 * z);
}

/**
 * The selected weapon in the active worm's hand: the atlas's held layer (business end drawn
 * pointing right, pivot on the grip) pinned to the hand at the end of the aim arm and rotated to
 * the aim. rotation is clockwise radians on screen; a worm facing left flips the sprite, and since
 * drawSprite flips after rotating, the flipped sprite's base direction is pi, so the sign of the
 * angle flips with it. A shot kicks it back along the aim and a new pick pops it in; nothing is
 * drawn when the atlas is missing or the weapon has no held layer.
 */
function drawHeldWeapon(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, angleDeg: number, facing: number, model: RenderModel, wormId: string, size = 1): void {
  const sprites = model.weaponSprites;
  if (sprites === undefined || sprites === null || model.weapon === undefined) return;
  const frameId = getWeapon(model.weapon).heldSprite;
  if (frameId === null) return;
  const frame = sprites.atlas.frame(frameId);
  if (frame === undefined) return;
  const anim = model.anim?.(wormId);
  const kick = anim === undefined ? 0 : Math.max(0, 1 - anim.firedMs / 150) * 4;
  const pop = anim === undefined ? 0 : Math.max(0, 1 - anim.switchedMs / 220);
  const shoulder = worldToScreen(camera, viewport, { x, y: y - WORM_HEIGHT * size * 0.55 });
  const a = degToRad(angleDeg);
  const armLen = (10 - kick) * camera.zoom * size;
  const hand = { x: shoulder.x + Math.cos(a) * facing * armLen, y: shoulder.y - Math.sin(a) * armLen };
  const flipX = facing === -1;
  // The kick also tips the muzzle up for a moment.
  const tip = kick * 0.06;
  drawSprite(ctx, sprites.image, frame, sprites.atlas.pivotOf(frame), {
    x: hand.x,
    y: hand.y,
    zoom: camera.zoom * size,
    flipX,
    rotation: flipX ? a + tip : -a - tip,
    scale: 1 + pop * 0.45,
  });
}

/** The name of a freshly picked weapon floats over the worm for a moment. */
function drawWeaponLabel(ctx: Ctx2D, viewport: Size, camera: Camera, x: number, y: number, model: RenderModel, wormId: string): void {
  const anim = model.anim?.(wormId);
  if (anim === undefined || model.weapon === undefined || anim.switchedMs > 1100) return;
  const t = anim.switchedMs / 1100;
  const p = worldToScreen(camera, viewport, { x, y: y - WORM_HEIGHT });
  ctx.save();
  ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const text = getWeapon(model.weapon).name.toUpperCase();
  const ly = p.y - 52 - t * 8;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(text, p.x + 1, ly + 1);
  ctx.fillStyle = getWeapon(model.weapon).combo !== undefined ? '#ffcf1f' : '#ffffff';
  ctx.fillText(text, p.x, ly);
  ctx.restore();
}
