/**
 * The game controller (Phase 2.4): runs a match end to end. It advances the match reducer's
 * phase machine, steps the sim during the motion phases, feeds the active human worm's input or
 * the CPU's decision through the same fire path, translates sim events into match events, and
 * drives the banners and timers. Rendering reads its snapshot; it owns no canvas.
 *
 * The reducer is the source of truth for phase, hp, turns and scoring; the sim is the source of
 * truth for positions and physics. The bridge keeps them in step.
 */

import { validateUtilityTarget } from '../weapons/behaviors/utility.ts';
import { TICK_MS } from '../config/units.ts';
import { TICK_S, WALK_SPEED_PX_PER_S } from '../sim/constants.ts';
import { wormHeight, wormMiddleY } from '../sim/worm-size.ts';
import { cancelBeams } from '../sim/beam.ts';
import { cancelCombos, heldWormIds } from '../sim/combo.ts';
import { cancelDevours, heldByDevours } from '../sim/devour.ts';
import { cancelHexes, heldByHexes } from '../sim/hex.ts';
import { cancelSprouts } from '../sim/sprout.ts';
import { cancelTechniques, heldByTechniques, techniquePlaying } from '../sim/technique.ts';
import { spawnTreasureStrike } from '../sim/techniques/treasure.ts';
import { reduce } from '../match/machine.ts';
import type { CratePickedEvent, MatchEvent } from '../match/events.ts';
import type { CrateType, MatchState } from '../match/state.ts';
import { activeTeamOf, activeWormOf, findWorm as findWormState } from '../match/ledger.ts';
import { activeWormSealed } from '../match/seals.ts';
import { superResting } from '../match/super-rest.ts';
import { WEAPONS, WEAPON_IDS, getWeapon, isSuper } from '../weapons/registry.ts';
import { fire, type FireAim, type FireResult } from '../weapons/fire.ts';
import { worldAtRest, findWorm as findBody, type SimWorld } from '../sim/world.ts';
import { stepWorld } from '../sim/world.ts';
import { IDLE_INTENT, type DevourBeat, type DiceCell, type HexBeat, type SimEvent, type SproutBeat, type TechniqueBeat, type WormIntent } from '../sim/types.ts';
import { pickCrateColumn, spawnCrate } from '../sim/crate.ts';
import { detonate } from '../sim/projectile.ts';
import { detonateSheep } from '../sim/sheep.ts';
import { createCpuState, decideCpuTurn, type CpuControllerOptions, type CpuControllerState } from '../ai/cpu-controller.ts';
import { decideHeuristic } from '../ai/heuristic.ts';
import { buildCpuRequest } from '../ai/snapshot.ts';
import { aimAtWorm } from '../ai/aim-at.ts';
import { blastDamage } from '../sim/damage.ts';
import { buildPlan, capWalkTicks, quantizePower } from '../ai/plan-executor.ts';
import { windFractionFromStep } from '../match/state.ts';
import { GRAVITY_PX_PER_S2 } from '../sim/constants.ts';
import type { SnapshotInput } from '../ai/snapshot.ts';
import { AIM_RATE_DEG_PER_S, INITIAL_AIM, aimBy, release, setAngle, tickCharge, type AimState } from './aim.ts';
import { CALC_TICKS, MAX_COMMAND_STEPS, STALL_PX, STALL_TICKS, ok, planFromResponse, refuse, type AutoPlan, type CommandResult, type PlanWorm, type WormCommand } from './commands.ts';
import { isSimPhase, snapshotPositions, syncMatchToSim, translateSimEvents } from './bridge.ts';
import type { Game } from './setup.ts';
import type { TechniqueKind, WeaponId } from '../weapons/types.ts';

export interface ControllerInput {
  readonly moveX: -1 | 0 | 1;
  readonly jump: boolean;
  readonly backflip: boolean;
  readonly aimDelta: -1 | 0 | 1;
  readonly fireHeld: boolean;
  readonly fireReleased: boolean;
  /** Jump key held this tick: thrust for a worm on a jetpack, nothing otherwise. */
  readonly thrust: boolean;
  readonly selectedSlot: number | null;
  readonly fuse?: number | null;
  /** World point under the crosshair, for targeted weapons. */
  readonly pointer: { readonly x: number; readonly y: number };
  /** A click this tick that no screen consumed: fires a targeted weapon at the pointer. */
  readonly pointerClicked: boolean;
}

/**
 * What the presentation hears from a tick: cues to play, blasts to draw, and the moments the
 * animation and gore layers react to (a hit and where it landed, a worm reduced to 0 hp, a
 * bullet's path, a shot leaving the barrel, a landing, a worm going under, a super move's
 * beats). None of it feeds back into the match; the reducer reads the sim events directly.
 */
export type GameEvent =
  | { readonly type: 'sound'; readonly id?: string; readonly x: number; readonly y: number }
  | {
      readonly type: 'explosion';
      readonly x: number;
      readonly y: number;
      readonly radius?: number;
      readonly shake?: number;
      /** Blast tier from the weapon row, so the presentation can scale the fireworks to the weapon. */
      readonly particle?: 'small' | 'medium' | 'big' | 'holy';
    }
  /** A worm was hurt: where the blow landed and which way it pushed (unit dx, dy). */
  // amount is the blow's force (the blood, the flinch); lost is the hp it really took, never more
  // than the worm had left, so a worm beaten past 0 still bleeds but its number stops counting.
  | { readonly type: 'damage'; readonly wormId: string; readonly amount: number; readonly lost: number; readonly cause: 'blast' | 'fall' | 'hit' | 'melee' | 'toll'; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  /**
   * A worm paid for its super out of its own health (WeaponDef.toll): lost is what it paid, fatal
   * when that was all it had left (it finishes the move, then bursts). (x, y) is its middle.
   */
  | { readonly type: 'toll'; readonly wormId: string; readonly lost: number; readonly fatal: boolean; readonly x: number; readonly y: number }
  /** A worm hit 0 hp (not drowned): it bursts where it stood, carried along its last velocity. */
  | { readonly type: 'gib'; readonly wormId: string; readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly colorIndex: number }
  | { readonly type: 'tracer'; readonly x: number; readonly y: number; readonly x1: number; readonly y1: number; readonly hit: 'worm' | 'land' | 'none' }
  /** A round or a launch left the active worm's weapon (every round of a burst). */
  | { readonly type: 'fired'; readonly wormId: string; readonly weapon: WeaponId; readonly x: number; readonly y: number; readonly angleDeg: number; readonly facing: 1 | -1 }
  | { readonly type: 'swing'; readonly wormId: string; readonly weapon: string; readonly x: number; readonly y: number; readonly facing: 1 | -1 }
  | { readonly type: 'landed'; readonly wormId: string; readonly x: number; readonly y: number; readonly speed: number }
  | { readonly type: 'drown'; readonly wormId: string; readonly x: number; readonly y: number; readonly facing: 1 | -1; readonly colorIndex: number }
  | { readonly type: 'comboStart'; readonly comboId: number; readonly weapon: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number }
  | { readonly type: 'beamStart'; readonly beamId: number; readonly weapon: string; readonly attackerId: string; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly type: 'beamFire'; readonly beamId: number; readonly attackerId: string; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly type: 'beamEnd'; readonly beamId: number; readonly attackerId: string; readonly hits: number }
  | { readonly type: 'devourStart'; readonly devourId: number; readonly weapon: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number }
  /** A beat of Gear 5; colorIndex is the victim's team colour, for what the burp brings back up. */
  | { readonly type: 'devourBeat'; readonly devourId: number; readonly attackerId: string; readonly victimId: string | null; readonly beat: DevourBeat; readonly n: number; readonly x: number; readonly y: number; readonly facing: 1 | -1; readonly colorIndex: number }
  | { readonly type: 'devourEnd'; readonly devourId: number; readonly attackerId: string; readonly victimId: string | null; readonly eaten: boolean }
  | { readonly type: 'hexStart'; readonly hexId: number; readonly weapon: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number }
  /** A beat of the Freezer; colorIndex is the victim's team colour, for the pieces the burst throws. */
  | { readonly type: 'hexBeat'; readonly hexId: number; readonly attackerId: string; readonly victimId: string | null; readonly beat: HexBeat; readonly n: number; readonly x: number; readonly y: number; readonly facing: 1 | -1; readonly colorIndex: number }
  | { readonly type: 'hexEnd'; readonly hexId: number; readonly attackerId: string; readonly victimId: string | null; readonly burst: boolean }
  /** A Saibaman seed goes in at (x, y); colorIndex is the planter's team colour. */
  | { readonly type: 'sproutStart'; readonly sproutId: number; readonly planterId: string; readonly x: number; readonly y: number; readonly facing: 1 | -1; readonly colorIndex: number }
  | { readonly type: 'sproutBeat'; readonly sproutId: number; readonly planterId: string; readonly beat: SproutBeat; readonly n: number; readonly x: number; readonly y: number; readonly facing: 1 | -1 }
  | { readonly type: 'sproutEnd'; readonly sproutId: number; readonly planterId: string; readonly wormId: string | null }
  /** One blow of a super move; ko once the victim has nothing left. */
  | { readonly type: 'comboHit'; readonly comboId: number; readonly attackerId: string; readonly victimId: string; readonly hit: number; readonly finisher: boolean; readonly ko: boolean; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }
  | { readonly type: 'comboEnd'; readonly comboId: number; readonly attackerId: string; readonly victimId: string | null; readonly hits: number; readonly x: number; readonly y: number }
  /** A technique of the anime row starts; colorIndex is its target's team colour (0 without one). */
  | { readonly type: 'techniqueStart'; readonly techniqueId: number; readonly kind: TechniqueKind; readonly weapon: string; readonly attackerId: string; readonly victimId: string | null; readonly x: number; readonly y: number; readonly facing: 1 | -1; readonly colorIndex: number; readonly strike?: number }
  /** A beat of a technique; the Santoryu's cut brings the cubes the land fell apart into. */
  | { readonly type: 'techniqueBeat'; readonly techniqueId: number; readonly kind: TechniqueKind; readonly attackerId: string; readonly victimId: string | null; readonly beat: TechniqueBeat; readonly n: number; readonly x: number; readonly y: number; readonly facing: 1 | -1; readonly colorIndex: number; readonly cells?: readonly DiceCell[] }
  | { readonly type: 'techniqueEnd'; readonly techniqueId: number; readonly kind: TechniqueKind; readonly attackerId: string; readonly victimId: string | null; readonly landed: boolean }
  /**
   * A worm opened a crate: the weapon it got (a super, out of a power orb) or the hp it healed,
   * for the callout over its head. (x, y) is the top of the worm.
   */
  | { readonly type: 'crateOpened'; readonly wormId: string; readonly crate: CrateType; readonly weapon: WeaponId | null; readonly healed: number; readonly x: number; readonly y: number }
  /** A worm on command took one more whole step of the n it was told to walk (the count over its head). */
  | { readonly type: 'step'; readonly wormId: string; readonly n: number; readonly total: number; readonly x: number; readonly y: number }
  /** The player set off the team's sheep by order ("¡detona la oveja!"), at (x, y). */
  | { readonly type: 'detonateOrder'; readonly wormId: string; readonly x: number; readonly y: number }
  /** A worm was picked to play the turn by name ("¡YO TE ELIJO!"). */
  | { readonly type: 'wormPicked'; readonly wormId: string; readonly name: string; readonly x: number; readonly y: number }
  /**
   * The AI is working out an auto attack: the enemies its reticle hops over, the one it settles on,
   * the shot it found, and the line the worm shouts. ticks is how long the calculating lasts.
   */
  | {
      readonly type: 'aiScan';
      readonly wormId: string;
      readonly name: string;
      readonly weapon: WeaponId;
      readonly targets: readonly { readonly id: string; readonly x: number; readonly y: number }[];
      readonly targetId: string | null;
      readonly angleDeg: number;
      readonly power: number;
      readonly confidence: number;
      readonly message: string;
      readonly ticks: number;
      readonly x: number;
      readonly y: number;
    };

export interface Controller {
  tick(input: ControllerInput): void;
  state(): MatchState;
  world(): SimWorld;
  aim(): AimState;
  selectedWeapon(): WeaponId;
  selectedFuseMs(): number | null;
  /** Picks a weapon by id, the weapon panel's path; ignored when the active team has no ammo for it or its scheme delay has not elapsed. */
  selectWeapon(id: WeaponId): void;
  /** Whole steps of the movement budget left this turn, for the HUD. */
  stepsRemaining(): number;
  /** The per turn budget in steps, from the match config, so the HUD never reads a global. */
  stepsPerTurn(): number;
  drainEvents(): GameEvent[];
  banner(): string | null;
  /** Kills a whole team at once; the reducer ends the match when only one is left. */
  surrender(teamId: string): void;
  /** Passes the active turn now, as the Skip Go does, spending none of the round clock: the harness skips turns with it. */
  skipTurn(): void;
  /**
   * Advances the round clock by ms. A large value also expires the current turn timer, which is
   * the normal path into TurnEnd and the SuddenDeathCheck, so the verification harness uses this
   * to reach sudden death without playing out the whole round.
   */
  advanceRoundClock(ms: number): void;
  /** A command for the human's active worm (voice, WebMCP): checked now, played out over the ticks. */
  command(cmd: WormCommand): CommandResult;
  /** The active worm is still carrying out a command. */
  commandBusy(): boolean;
}

/** One beat of a command, played a tick at a time on the human's Active turn. */
type ScriptStep =
  /** px, when given, is the exact distance to walk (an AI plan's); steps is then only the count shown. */
  | { readonly kind: 'walk'; readonly dir: -1 | 1; readonly steps: number; readonly px?: number; startPx: number | null; counted: number; lastPx: number; stall: number }
  /** Aim at that worm from where the worm now stands, then turn, swing the aim and fire (aim-at.ts). */
  | { readonly kind: 'aimAt'; readonly targetId: string | null; readonly weapon: WeaponId; readonly fuseMs?: number }
  | { readonly kind: 'wait'; ticks: number }
  | { readonly kind: 'face'; readonly dir: -1 | 1 }
  | { readonly kind: 'hop'; readonly backflip: boolean }
  | { readonly kind: 'weapon'; readonly id: WeaponId }
  | { readonly kind: 'aim'; readonly angleDeg: number }
  | { readonly kind: 'fire'; readonly power: number; readonly targetPoint?: { readonly x: number; readonly y: number }; readonly fuseMs?: number }
  /** An auto attack ordered behind other steps: planned when the worm gets to it, from where it then stands. */
  | { readonly kind: 'plan'; readonly weapon: WeaponId; readonly targetWormId?: string; readonly message?: string };

/** How much faster than a held key a command swings the aim, so it reads as the worm sighting in. */
const COMMAND_AIM_RATE = AIM_RATE_DEG_PER_S * 2.5;
/** How much faster a command charges the shot than a held fire key. */
const COMMAND_CHARGE_RATE = 1.6;

interface Pending {
  /** Queued human or CPU walk intents to feed before firing. */
  walk: WormIntent[];
  fireAfterWalk: FireAim | null;
  /** Which way the CPU's worm faces to fire, set once the walk is over (walking turns it the way it goes). */
  fireFacing: 1 | -1;
  fireWeapon: WeaponId | null;
  cpuRequested: boolean;
  /** The CPU decision has come back (with or without a plan), so standing still is not "waiting". */
  cpuDecided: boolean;
  /** Ticks before the CPU may fire the next barrel of a multi shot weapon. */
  refireTicks: number;
  /** A gun burst in progress: the remaining rounds fire one per interval while the phase is Firing. */
  burst: Burst | null;
  /** A super move playing in the sim: the shot stays open in the reducer until the combo is done. */
  sequence: WeaponId | null;
}

interface Burst {
  readonly weapon: WeaponId;
  readonly aim: FireAim;
  readonly shotIndex: number;
  readonly intervalTicks: number;
  roundsLeft: number;
  ticksUntilNext: number;
}

/** The CPU fires its second barrel this long after the first, so the two shots read as two. */
const REFIRE_TICKS = 12;
/** How long to wait before looking for a free crate column again when the map had none. */
const CRATE_RETRY_TICKS = 60;

export interface ControllerOptions {
  readonly cpu: CpuControllerOptions;
}

const BANNER_MS = 1200;

export function createController(game: Game, options: ControllerOptions): Controller {
  let state = game.state;
  const world = game.world;
  let aim: AimState = INITIAL_AIM;
  // Each worm remembers its own selected weapon across turns.
  const slotByWorm = new Map<string, number>();
  const fuseByWorm = new Map<string, number>();
  const wormKey = (): string => activeWormOf(state)?.id ?? '';
  const getSlot = (): number => slotByWorm.get(wormKey()) ?? 0;
  const setSlot = (index: number): void => {
    slotByWorm.set(wormKey(), index);
  };
  const cpuState: CpuControllerState = createCpuState();
  let bannerMs = BANNER_MS;
  let cpuBusy = false;
  const events: GameEvent[] = [];
  const pending: Pending = { walk: [], fireAfterWalk: null, fireFacing: 1, fireWeapon: null, cpuRequested: false, cpuDecided: false, refireTicks: 0, burst: null, sequence: null };
  // Worms whose last hp already went to gore (a burst) or to the water, so each dies exactly once.
  const goneWorms = new Set<string>();
  // Worms that paid for a super with their last hp: they finish the move before they burst.
  const lastBreath = new Set<string>();
  // The turn whose strikes of the Tesoro del Cielo have been played, so a turn plays them once.
  let strikesTurn = -1;

  // Movement budget: real horizontal displacement spent while walking this turn, in world px.
  // Measured, not assumed, so pushing against a wall costs nothing and knockback is never billed.
  // Read from the match config like every other tunable here, so a scheme or a test can override it.
  const MOVE = game.deps.config.movement;
  const budgetPx = MOVE.stepsPerTurn * MOVE.stepPx;
  let spentPx = 0;
  // Which barrel of a multi shot weapon fires next this turn (shotgun, longbow): the reducer only
  // moves on to the retreat when the last one reports zero shots remaining.
  let shotIndex = 0;
  // The reducer announces a crate drop at TurnEnd and keeps it until CrateLanded; the sim gets
  // exactly one crate per announcement, and retries later when no column was free.
  let crateSpawned = false;
  let crateRetryTicks = 0;
  // A Resolving cap (8 s of inactivity or the 45 s ceiling) hands the turn over with bodies still
  // live; the sim detonates them once on the way into TurnEnd, as state.settle promises.
  let forceSettledHandled = false;
  const canMove = (): boolean => spentPx < budgetPx;
  const stepsRemaining = (): number => Math.max(0, Math.ceil((budgetPx - spentPx) / MOVE.stepPx));
  const chargeJump = (): void => {
    spentPx += MOVE.jumpStepCost * MOVE.stepPx;
  };

  const selectedWeapon = (): WeaponId => WEAPON_IDS[getSlot()] ?? 'bazooka';

  const selectedFuseMs = (): number | null => {
    const fuse = getWeapon(selectedWeapon()).fuse;
    if (fuse === undefined) return null;
    const chosen = fuseByWorm.get(wormKey()) ?? fuse.defaultMs;
    return fuse.selectable && fuse.optionsMs.includes(chosen) ? chosen : fuse.defaultMs;
  };

  /** The worm may not use a super this turn: it used one on its last (match/super-rest.ts). */
  const supersRest = (): boolean => {
    const worm = activeWormOf(state);
    return worm !== undefined && superResting(worm);
  };

  /** The weapon can be picked and fired now: stocked, past its delay on this worm's own turns, and not a super the worm is resting. */
  const usable = (id: WeaponId): boolean => {
    const worm = activeWormOf(state);
    const count = worm?.ammo[id] ?? 0;
    if (count === 0) return false;
    if ((worm?.turns ?? 0) < (getWeapon(id).delayTurns ?? 0)) return false;
    return !(isSuper(id) && supersRest());
  };

  const selectWeapon = (id: WeaponId): void => {
    const index = WEAPON_IDS.indexOf(id);
    if (index === -1) return;
    // The panel greys out empty, delayed and resting weapons, but a stale click or a script must
    // not slip one through (the panel's own rule).
    if (!usable(id)) return;
    setSlot(index);
  };

  /** A worm whose remembered weapon cannot be used this turn (spent, or a super it rests) starts on the bazooka. */
  const letGoOfUnusable = (): void => {
    if (state.phase !== 'Active' && state.phase !== 'HotSeat') return;
    if (usable(selectedWeapon())) return;
    setSlot(Math.max(0, WEAPON_IDS.indexOf('bazooka')));
  };

  const apply = (event: MatchEvent): void => {
    state = reduce(state, event, game.deps);
  };

  const emitSim = (): void => {
    const active = activeWormOf(state);
    const body = active === undefined ? undefined : findBody(world, active.id);
    const beforeX = body?.x;
    const wasFlying = body?.motion === 'jetpacking' || body?.motion === 'parachuting';
    // Sampled once: the CPU walk queue is consumed by this call, a second one would skip a tick.
    const intents = currentIntents();
    const commandedWalk = active !== undefined && (intents.get(active.id)?.moveX ?? 0) !== 0;
    const simEvents = stepWorld(world, intents);
    // Bill only the phase the budget governs and only ticks the player actually asked to walk.
    if (state.phase === 'Active' && !wasFlying && commandedWalk && body !== undefined && beforeX !== undefined) {
      spentPx += Math.abs(body.x - beforeX);
    }
    applySimEvents(simEvents);
  };

  /**
   * One batch of sim events, wherever it came from: presentation events out to the game loop, the
   * match events into the reducer, then the ledger's deaths back onto the bodies. Both the tick
   * drain and the fire time drain go through here. They used to differ: the fire time drain kept
   * only sound and explosion, so the damage a gun or a punch emits synchronously inside fire()
   * was spliced away and never reached the ledger, and guns took no health off anyone.
   */
  const applySimEvents = (simEvents: readonly SimEvent[]): void => {
    // The hp each worm had before the batch: the ledger takes min(blow, hp left), and so do the numbers.
    const hpLeft = new Map<string, number>();
    for (const e of simEvents) if (e.type === 'damage' && !hpLeft.has(e.wormId)) hpLeft.set(e.wormId, hpOf(e.wormId));
    // The ledger first, so a blow's event already knows whether it was the knockout.
    for (const matchEvent of translateSimEvents(simEvents)) {
      if (matchEvent.type === 'CratePicked') openCrate(matchEvent);
      else apply(matchEvent);
    }
    for (const e of simEvents) presentSimEvent(e, hpLeft);
    syncMatchToSim(state, world);
    observeCasualties();
  };

  /**
   * A crate taken: into the ledger, which rolls what it holds, then what the worm got over its
   * head. The prize is read back from the ammo and the hp the ledger changed, so the callout says
   * exactly what the rules gave.
   */
  const openCrate = (event: CratePickedEvent): void => {
    const before = findWormState(state, event.wormId)?.worm;
    apply(event);
    const after = findWormState(state, event.wormId)?.worm;
    const body = findBody(world, event.wormId);
    if (before === undefined || after === undefined || body === undefined) return;
    const weapon = WEAPON_IDS.find((id) => (after.ammo[id] ?? 0) > (before.ammo[id] ?? 0)) ?? null;
    const healed = Math.max(0, after.hp - before.hp);
    if (weapon === null && healed === 0) return;
    events.push({ type: 'crateOpened', wormId: event.wormId, crate: event.crate, weapon, healed, x: body.x, y: body.y - wormHeight(body) });
  };

  const colorIndexOf = (wormId: string): number => {
    for (const team of state.teams) if (team.worms.some((w) => w.id === wormId)) return team.colorIndex;
    return 0;
  };

  /** The sim event, as the presentation needs it: positions filled in from the bodies. */
  const presentSimEvent = (e: SimEvent, hpLeft: Map<string, number>): void => {
    // A worm that already burst or sank shows nothing more: no blood, number, landing or second death.
    if ((e.type === 'damage' || e.type === 'landed' || e.type === 'drown') && goneWorms.has(e.wormId)) return;
    switch (e.type) {
      case 'sound':
        events.push({ type: 'sound', id: e.id, x: e.x, y: e.y });
        return;
      case 'explosion':
        events.push({ type: 'explosion', x: e.x, y: e.y, radius: e.radius, shake: e.shake, particle: e.particle });
        return;
      case 'damage': {
        const body = findBody(world, e.wormId);
        const at = e.at ?? (body === undefined ? null : { x: body.x, y: wormMiddleY(body), dx: 0, dy: -1 });
        const left = hpLeft.get(e.wormId) ?? 0;
        // A toll by share (Antares) is that share of what the worm has, rounded up, as the ledger books it.
        const asked = e.share !== undefined && e.share > 0 ? Math.min(e.amount, Math.ceil(left * Math.min(1, e.share))) : e.amount;
        const lost = Number.isFinite(asked) && asked > 0 ? Math.min(asked, left) : 0;
        hpLeft.set(e.wormId, left - lost);
        if (at !== null) events.push({ type: 'damage', wormId: e.wormId, amount: e.amount, lost, cause: e.cause, x: at.x, y: at.y, dx: at.dx, dy: at.dy });
        if (e.cause === 'toll' && at !== null) {
          const fatal = left > 0 && left - lost <= 0;
          if (fatal) lastBreath.add(e.wormId);
          events.push({ type: 'toll', wormId: e.wormId, lost, fatal, x: at.x, y: at.y });
        }
        return;
      }
      case 'tracer':
        events.push({ type: 'tracer', x: e.x0, y: e.y0, x1: e.x1, y1: e.y1, hit: e.hit });
        return;
      case 'swing':
        events.push({ type: 'swing', wormId: e.wormId, weapon: e.weaponId, x: e.x, y: e.y, facing: e.facing });
        return;
      case 'landed': {
        const body = findBody(world, e.wormId);
        if (body !== undefined) events.push({ type: 'landed', wormId: e.wormId, x: body.x, y: body.y, speed: e.speed });
        return;
      }
      case 'drown': {
        goneWorms.add(e.wormId);
        const body = findBody(world, e.wormId);
        if (body !== undefined) events.push({ type: 'drown', wormId: e.wormId, x: body.x, y: body.y, facing: body.facing, colorIndex: colorIndexOf(e.wormId) });
        return;
      }
      case 'comboStart':
        events.push({ type: 'comboStart', comboId: e.comboId, weapon: e.weaponId, attackerId: e.attackerId, victimId: e.victimId, x: e.x, y: e.y });
        return;
      case 'comboHit':
        events.push({ type: 'comboHit', comboId: e.comboId, attackerId: e.attackerId, victimId: e.victimId, hit: e.hit, finisher: e.finisher, ko: hpOf(e.victimId) <= 0, x: e.at.x, y: e.at.y, dx: e.at.dx, dy: e.at.dy });
        return;
      case 'comboEnd': {
        const body = findBody(world, e.attackerId);
        events.push({ type: 'comboEnd', comboId: e.comboId, attackerId: e.attackerId, victimId: e.victimId, hits: e.hits, x: body?.x ?? 0, y: body?.y ?? 0 });
        return;
      }
      case 'beamStart':
        events.push({ type: 'beamStart', beamId: e.beamId, weapon: e.weaponId, attackerId: e.attackerId, x: e.x, y: e.y, dx: e.dx, dy: e.dy });
        return;
      case 'beamFire':
        events.push({ type: 'beamFire', beamId: e.beamId, attackerId: e.attackerId, x: e.x, y: e.y, dx: e.dx, dy: e.dy });
        return;
      case 'beamEnd':
        events.push({ type: 'beamEnd', beamId: e.beamId, attackerId: e.attackerId, hits: e.hits });
        return;
      case 'devourStart':
        events.push({ type: 'devourStart', devourId: e.devourId, weapon: e.weaponId, attackerId: e.attackerId, victimId: e.victimId, x: e.x, y: e.y });
        return;
      case 'devourBeat':
        // Swallowed: the worm is gone for good, with no burst of its own; its remains come back up in the burp.
        if (e.beat === 'gulp' && e.victimId !== null) goneWorms.add(e.victimId);
        events.push({ type: 'devourBeat', devourId: e.devourId, attackerId: e.attackerId, victimId: e.victimId, beat: e.beat, n: e.n, x: e.x, y: e.y, facing: e.facing, colorIndex: e.victimId === null ? 0 : colorIndexOf(e.victimId) });
        return;
      case 'devourEnd':
        events.push({ type: 'devourEnd', devourId: e.devourId, attackerId: e.attackerId, victimId: e.victimId, eaten: e.eaten });
        return;
      case 'hexStart':
        events.push({ type: 'hexStart', hexId: e.hexId, weapon: e.weaponId, attackerId: e.attackerId, victimId: e.victimId, x: e.x, y: e.y });
        return;
      case 'hexBeat':
        events.push({ type: 'hexBeat', hexId: e.hexId, attackerId: e.attackerId, victimId: e.victimId, beat: e.beat, n: e.n, x: e.x, y: e.y, facing: e.facing, colorIndex: e.victimId === null ? 0 : colorIndexOf(e.victimId) });
        return;
      case 'hexEnd':
        events.push({ type: 'hexEnd', hexId: e.hexId, attackerId: e.attackerId, victimId: e.victimId, burst: e.burst });
        return;
      case 'sproutStart':
        events.push({ type: 'sproutStart', sproutId: e.sproutId, planterId: e.planterId, x: e.x, y: e.y, facing: e.facing, colorIndex: colorIndexOf(e.planterId) });
        return;
      case 'sproutBeat':
        events.push({ type: 'sproutBeat', sproutId: e.sproutId, planterId: e.planterId, beat: e.beat, n: e.n, x: e.x, y: e.y, facing: e.facing });
        return;
      case 'sproutEnd':
        events.push({ type: 'sproutEnd', sproutId: e.sproutId, planterId: e.planterId, wormId: e.wormId });
        return;
      case 'techniqueStart':
        events.push({ type: 'techniqueStart', techniqueId: e.techniqueId, kind: e.kind, weapon: e.weaponId, attackerId: e.attackerId, victimId: e.victimId, x: e.x, y: e.y, facing: e.facing, colorIndex: e.victimId === null ? 0 : colorIndexOf(e.victimId), ...(e.strike === undefined ? {} : { strike: e.strike }) });
        return;
      case 'techniqueBeat':
        events.push({ type: 'techniqueBeat', techniqueId: e.techniqueId, kind: e.kind, attackerId: e.attackerId, victimId: e.victimId, beat: e.beat, n: e.n, x: e.x, y: e.y, facing: e.facing, colorIndex: e.victimId === null ? 0 : colorIndexOf(e.victimId), ...(e.cells === undefined ? {} : { cells: e.cells }) });
        return;
      case 'techniqueEnd':
        events.push({ type: 'techniqueEnd', techniqueId: e.techniqueId, kind: e.kind, attackerId: e.attackerId, victimId: e.victimId, landed: e.landed });
        return;
      default:
        return;
    }
  };

  /**
   * A worm at 0 hp is not drawn any more (the Worms rule keeps it in the ledger until TurnEnd), so
   * that is the moment it bursts. A worm a super move still holds keeps taking the beating first
   * and bursts on the finisher, one in Gear 5's mouth is chewed to the end and swallowed, one the
   * Freezer's light went into floats and swells until its own burst, and a drowned worm sinks
   * instead.
   */
  const observeCasualties = (): void => {
    const held = heldWormIds(world.combos);
    const eating = heldByDevours(world.devours);
    const hexed = heldByHexes(world.hexes);
    // A worm a technique still holds (Antares' victim until the last needle, the sealed worm in the wheel) goes when it lets go.
    const performing = heldByTechniques(world.techniques);
    // A worm that paid for its super with its last hp is up until the move is over.
    const finishing = sequencePlaying();
    for (const team of state.teams) {
      for (const worm of team.worms) {
        if (worm.hp > 0 || goneWorms.has(worm.id) || held.has(worm.id) || eating.has(worm.id) || hexed.has(worm.id) || performing.has(worm.id) || (finishing && lastBreath.has(worm.id))) continue;
        lastBreath.delete(worm.id);
        goneWorms.add(worm.id);
        const body = findBody(world, worm.id);
        if (body === undefined || body.motion === 'drowning') continue;
        events.push({ type: 'gib', wormId: worm.id, x: body.x, y: wormMiddleY(body), vx: body.vx, vy: body.vy, colorIndex: team.colorIndex });
        // The body goes with the burst. Left in the physics it flew on unseen: the camera chased
        // it, it landed or drowned in front of the player, and it could trip a mine or take a crate.
        body.alive = false;
        body.motion = 'dead';
        body.vx = 0;
        body.vy = 0;
      }
    }
  };

  /** Drains what fire() just emitted through the same path as a tick's events. */
  const drainSimAfterFire = (): void => {
    applySimEvents(world.events.splice(0, world.events.length));
  };

  /** A super move, a beam, Gear 5, the Freezer, a Saibaman seed or a technique is still playing out in the sim. */
  const sequencePlaying = (): boolean =>
    world.combos.some((c) => c.alive) || world.beams.some((b) => b.alive) || world.devours.some((d) => d.alive) || world.hexes.some((h) => h.alive) || world.sprouts.some((s) => s.alive) || techniquePlaying(world);

  /**
   * The match ended while a super move, a beam, Gear 5, the Freezer or a seed played (a surrender):
   * the sim is not stepped at MatchEnd, so it ends here. The worms are let go, a held worm at 0 hp
   * bursts, and the white screen, the beam, the meal or the swelling does not hold over the end
   * screen forever.
   */
  const endFightsAtMatchEnd = (): void => {
    if (state.phase !== 'MatchEnd' || !sequencePlaying()) return;
    cancelCombos(world);
    cancelBeams(world);
    cancelDevours(world);
    cancelHexes(world);
    cancelSprouts(world);
    cancelTechniques(world);
    drainSimAfterFire();
  };

  /**
   * The Tesoro del Cielo's strikes the ledger left for this turn, at the end of a turn the sealed
   * worm's team played without it, or in a turn taken whole because only sealed worms were left:
   * they play out in the sim (the sense taken, the caster's toll, the last one's kill) while the
   * turn resolves.
   */
  const playStrikes = (): void => {
    if (state.strikes.length === 0 || strikesTurn === state.turn) return;
    strikesTurn = state.turn;
    for (const strike of state.strikes) {
      const target = findBody(world, strike.targetId);
      const spec = getWeapon(strike.weaponId).technique;
      if (target === undefined || !target.alive || spec?.kind !== 'treasure') continue;
      spawnTreasureStrike(world, { weaponId: strike.weaponId, casterId: strike.casterId, casterTeamId: strike.casterTeamId, target, spec, hit: strike.hit, fatal: strike.fatal });
    }
    drainSimAfterFire();
  };

  let humanIntent: WormIntent = IDLE_INTENT;
  // A sheep sent at a worm by an auto attack goes off when it reaches it, as a player would press fire.
  let sheepTargetId: string | null = null;
  // The command being played out on the human's turn, one step at a time (src/game/commands.ts).
  let script: ScriptStep[] = [];

  const currentIntents = (): Map<string, WormIntent> => {
    const active = activeWormOf(state);
    if (active === undefined) return new Map();
    // Only the CPU drives the walk queue; a human turn always reads live input, even if a stale
    // queue somehow survived (defence in depth for the boundary clear below).
    if (!isHumanTurn() && pending.walk.length > 0) {
      // The CPU plays by the same movement budget: once it is spent, the rest of the planned
      // walk is dropped so the turn proceeds to the shot instead of stalling until the timer.
      if (!canMove()) {
        pending.walk = [];
        return new Map([[active.id, IDLE_INTENT]]);
      }
      const next = pending.walk.shift();
      return new Map([[active.id, next ?? IDLE_INTENT]]);
    }
    return new Map([[active.id, humanIntent]]);
  };

  const isHumanTurn = (): boolean => activeTeamOf(state)?.controller === 'human';

  /** The worm is on a controlled or ballistic flight, so the air retreat window applies. */
  const inTheAir = (motion: string): boolean => motion === 'flying' || motion === 'jetpacking' || motion === 'parachuting';

  /**
   * Closes the shot in the reducer. The turn is kept when the weapon is a utility that does not end
   * it (jetpack, parachute, girder) or when fire() reports the turn goes on with no barrel owed,
   * which is how a refused teleport (bad destination) hands control back instead of wasting the turn.
   */
  const completeShot = (def: ReturnType<typeof getWeapon>, motion: string, result: FireResult | null): void => {
    const utilityKeeps = def.kind === 'UTILITY' && !def.endsTurnOnFire;
    const refusedKeeps = result !== null && !result.endsTurn && result.shotsRemaining === 0 && def.kind === 'UTILITY';
    const keepsTurn = utilityKeeps || refusedKeeps;
    apply({ type: 'FireCompleted', ...(inTheAir(motion) ? { airborne: true } : {}), ...(keepsTurn ? { keepsTurn: true } : {}) });
  };

  const startShot = (weapon: WeaponId, fireAim: FireAim): void => {
    const def = getWeapon(weapon);
    if (state.shot === null || state.shot.shotsRemaining === 0) shotIndex = 0;
    const activeWorm = activeWormOf(state);
    const body = activeWorm === undefined ? undefined : findBody(world, activeWorm.id);
    if (body === undefined || !validateUtilityTarget({ world, worm: body, def, aim: fireAim, shotIndex })) return;
    // Which barrel this is decides whether the reducer comes back to Active (shotgun, longbow) or
    // moves on to the retreat; reporting the constant "one left" kept the turn open until the timer.
    apply({ type: 'FireStarted', weaponId: weapon, shotsRemaining: Math.max(0, def.shotsPerTurn - 1 - shotIndex) });
    if (state.phase !== 'Firing') return;
    const barrel = shotIndex;
    shotIndex += 1;
    const result = fire(world, body, def, fireAim, barrel);
    announceShot(body, weapon, fireAim.angleDeg);
    // Damage a gun or a punch dealt inside fire() is booked while the phase is still Firing, so
    // the shot window credits it and a lethal hit resolves the way a projectile kill does.
    drainSimAfterFire();
    if (result.sequence === true) {
      // A super move: the sim plays it out and the shot closes when the combo is done.
      pending.sequence = weapon;
      return;
    }
    const burstCount = def.hitscan?.burstCount ?? 1;
    if (def.hitscan !== undefined && burstCount > 1) {
      // Automatic fire: the remaining rounds go out one per interval from the sim phase branch;
      // the shot stays open in the reducer until the last one.
      const intervalTicks = Math.max(1, Math.round(def.hitscan.burstIntervalMs / TICK_MS));
      pending.burst = { weapon, aim: fireAim, shotIndex: barrel, intervalTicks, roundsLeft: burstCount - 1, ticksUntilNext: intervalTicks };
      return;
    }
    completeShot(def, body.motion, result);
  };

  /** The muzzle flash, recoil and casing of a shot: a presentation beat, nothing the sim reads. */
  const announceShot = (body: { readonly id: string; readonly x: number; readonly y: number; readonly facing: 1 | -1 }, weapon: WeaponId, angleDeg: number): void => {
    const def = getWeapon(weapon);
    // Nothing leaves the worm's hands for a utility, a super move, a seed or an air strike (it comes
    // from the sky), so there is no muzzle flash, smoke or recoil to show; a beam brings its own, later.
    if (def.kind === 'UTILITY' || def.kind === 'TARGETED' || def.combo !== undefined || def.beam !== undefined || def.devour !== undefined || def.hex !== undefined || def.sprout !== undefined || def.technique !== undefined) return;
    events.push({ type: 'fired', wormId: body.id, weapon, x: body.x, y: body.y, angleDeg, facing: body.facing });
  };

  /** Closes a super move's shot once the sim has played the combo, the beam, the meal, the burst or the sprouting out. */
  const stepSequence = (): void => {
    const weapon = pending.sequence;
    if (weapon === null) return;
    if (state.phase !== 'Firing') {
      pending.sequence = null;
      return;
    }
    if (sequencePlaying()) return;
    pending.sequence = null;
    const activeWorm = activeWormOf(state);
    const body = activeWorm === undefined ? undefined : findBody(world, activeWorm.id);
    completeShot(getWeapon(weapon), body?.motion ?? 'idle', null);
  };

  /** One more round of a gun burst; closes the shot after the last one or if the phase moved on. */
  const stepBurst = (): void => {
    const burst = pending.burst;
    if (burst === null) return;
    if (state.phase !== 'Firing') {
      pending.burst = null;
      return;
    }
    burst.ticksUntilNext -= 1;
    if (burst.ticksUntilNext > 0) return;
    const activeWorm = activeWormOf(state);
    const body = activeWorm === undefined ? undefined : findBody(world, activeWorm.id);
    const def = getWeapon(burst.weapon);
    const result = body !== undefined && body.alive ? fire(world, body, def, burst.aim, burst.shotIndex) : null;
    if (result !== null && body !== undefined) announceShot(body, burst.weapon, burst.aim.angleDeg);
    drainSimAfterFire();
    burst.roundsLeft -= 1;
    burst.ticksUntilNext = burst.intervalTicks;
    if (burst.roundsLeft <= 0 || body === undefined) {
      pending.burst = null;
      completeShot(def, body?.motion ?? 'idle', result);
    }
  };

  /** A second fire press while the sim runs detonates the active team's sheep, as its spec promises; how many it set off. */
  const detonateOwnSheep = (): number => {
    const team = activeTeamOf(state);
    if (team === undefined) return 0;
    let count = 0;
    for (const sheep of world.sheep) {
      if (sheep.alive && !sheep.detonateRequested && sheep.ownerTeamId === team.id && sheep.spec.detonateOnSecondFire) {
        sheep.detonateRequested = true;
        count += 1;
      }
    }
    return count;
  };

  /** The reducer announced a crate at TurnEnd; the sim gets exactly one body for it. */
  const dropAnnouncedCrate = (): void => {
    if (state.crateDrop === null) {
      crateSpawned = false;
      return;
    }
    if (crateSpawned) return;
    if (crateRetryTicks > 0) {
      crateRetryTicks -= 1;
      return;
    }
    const x = pickCrateColumn(world);
    if (x === null) {
      crateRetryTicks = CRATE_RETRY_TICKS;
      return;
    }
    spawnCrate(world, state.crateDrop, x);
    crateSpawned = true;
  };

  const buildSnapshot = (): SnapshotInput => {
    const active = activeWormOf(state);
    const team = activeTeamOf(state);
    const worms = world.worms.map((b) => ({ id: b.id, teamId: b.teamId, x: b.x, y: b.y, hp: hpOf(b.id), alive: b.alive && hpOf(b.id) > 0, size: b.size }));
    return {
      matchId: `match-${state.seed}`,
      turn: state.turn,
      difficulty: team?.cpu?.difficulty ?? 'normal',
      personality: team?.cpu?.personality ?? 'aggressive',
      windStep: state.wind.step,
      windFraction: windFractionFromStep(state.wind.step),
      gravity: GRAVITY_PX_PER_S2,
      waterY: state.waterY,
      mask: world.terrain.mask,
      activeWormId: active?.id ?? '',
      activeTeamId: team?.id ?? '',
      worms,
      // Only what it may fire this turn: stocked, unlocked, and no super while the worm rests them.
      ammo: active === undefined ? [] : (Object.entries(active.ammo) as [WeaponId, number][]).filter(([id, n]) => n !== 0 && usable(id)).map(([weapon, count]) => ({ weapon, count })),
      canMoveLeft: true,
      canMoveRight: true,
      // The model is told the walk it can still afford, so its plan is never cut short (backlog 4.4).
      walkBudgetPx: Math.max(0, budgetPx - spentPx),
    };
  };

  const hpOf = (wormId: string): number => {
    for (const team of state.teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
    return 0;
  };

  const runCpuTurn = (): void => {
    if (cpuBusy) return;
    cpuBusy = true;
    void decideCpuTurn(buildSnapshot(), options.cpu, cpuState).then((decision) => {
      const plan = buildPlan(decision.response);
      // The worm turns to its target once it is done walking: set now, the walk would turn it back.
      pending.fireFacing = plan.facing;
      const walk = plan.steps.filter((s) => s.kind === 'move').flatMap((s) => (s.kind === 'move' ? Array.from({ length: s.ticks }, () => s.intent) : []));
      // The request carried the budget and the sanitizer clamped to it; this cap is the last line
      // of defence so the queue never holds a walk the sim would cut short (backlog 4.4).
      pending.walk = walk.slice(0, capWalkTicks(walk.length, Math.max(0, budgetPx - spentPx), WALK_SPEED_PX_PER_S * TICK_S));
      pending.fireAfterWalk = { ...plan.aim, power: quantizePower(decision.response.power) };
      pending.fireWeapon = decision.response.weapon;
      pending.cpuDecided = true;
      cpuBusy = false;
    }, () => {
      pending.cpuDecided = true;
      cpuBusy = false;
    });
  };

  /** The human's active worm and its body, when it is the human's Active turn. */
  const commandable = (): { readonly worm: NonNullable<ReturnType<typeof activeWormOf>>; readonly body: NonNullable<ReturnType<typeof findBody>> } | string => {
    if (state.phase === 'MatchEnd') return 'The match is over.';
    if (!isHumanTurn()) return 'It is not a human turn.';
    if (state.phase !== 'Active') return state.phase === 'TurnStart' || state.phase === 'HotSeat' ? 'The turn has not started yet.' : 'The shot is already out.';
    const worm = activeWormOf(state);
    const body = worm === undefined ? undefined : findBody(world, worm.id);
    if (worm === undefined || body === undefined || !body.alive) return 'There is no worm to command.';
    return { worm, body };
  };

  /** One tick of the command in hand: walk, turn, swing the aim, charge and fire, like the keys would. */
  const playScript = (): void => {
    const active = activeWormOf(state);
    const body = active === undefined ? undefined : findBody(world, active.id);
    const step = script[0];
    let intent: WormIntent = IDLE_INTENT;
    if (step === undefined || body === undefined) {
      script = [];
    } else {
      switch (step.kind) {
        case 'walk': {
          if (step.startPx === null) {
            step.startPx = spentPx;
            step.lastPx = spentPx;
          }
          const walked = spentPx - step.startPx;
          const whole = Math.min(step.steps, Math.floor((walked + 0.5) / MOVE.stepPx));
          while (step.counted < whole) {
            step.counted += 1;
            events.push({ type: 'step', wormId: body.id, n: step.counted, total: step.steps, x: body.x, y: body.y - wormHeight(body) });
            events.push({ type: 'sound', id: `wrm_footstep_${((step.counted - 1) % 3) + 1}`, x: body.x, y: body.y });
          }
          step.stall = spentPx - step.lastPx < STALL_PX ? step.stall + 1 : 0;
          step.lastPx = spentPx;
          const arrived = step.px !== undefined ? walked >= step.px - 0.5 : step.counted >= step.steps;
          if (arrived || !canMove() || step.stall >= STALL_TICKS) {
            script.shift();
          } else {
            intent = { moveX: step.dir, jump: false, backflip: false, thrust: false };
          }
          break;
        }
        case 'aimAt': {
          script.shift();
          const solved = solveAim(body, step.weapon, step.targetId);
          if (solved === null) break;
          if (getWeapon(step.weapon).spawn?.detonateOnSecondFire === true && solved.targetId !== null) sheepTargetId = solved.targetId;
          script.unshift(
            { kind: 'face', dir: solved.facing },
            { kind: 'aim', angleDeg: solved.angleDeg },
            { kind: 'fire', power: solved.power, ...(solved.targetPoint === undefined ? {} : { targetPoint: solved.targetPoint }), ...(step.fuseMs === undefined ? {} : { fuseMs: step.fuseMs }) },
          );
          break;
        }
        case 'plan': {
          script.shift();
          const worm = activeWormOf(state);
          if (worm !== undefined && whyUnusable(step.weapon) === null) startAuto(worm, body, step.weapon, step.targetWormId, step.message);
          break;
        }
        case 'wait':
          step.ticks -= 1;
          if (step.ticks <= 0) script.shift();
          break;
        case 'face':
          body.facing = step.dir;
          script.shift();
          break;
        case 'hop':
          if (canMove() && !inTheAir(body.motion)) {
            chargeJump();
            intent = { moveX: 0, jump: !step.backflip, backflip: step.backflip, thrust: false };
          }
          script.shift();
          break;
        case 'weapon':
          selectWeapon(step.id);
          script.shift();
          break;
        case 'aim': {
          const diff = step.angleDeg - aim.angleDeg;
          const rate = COMMAND_AIM_RATE * TICK_S;
          if (Math.abs(diff) <= rate) {
            aim = setAngle(aim, step.angleDeg);
            script.shift();
          } else {
            aim = setAngle(aim, aim.angleDeg + Math.sign(diff) * rate);
          }
          break;
        }
        case 'fire': {
          const weapon = selectedWeapon();
          const def = getWeapon(weapon);
          if (whyUnusable(weapon) !== null) {
            script.shift();
            break;
          }
          const goal = def.charged ? Math.max(0.1, Math.min(1, step.power)) : 0;
          if (def.charged && aim.power < goal) {
            aim = tickCharge(aim, true, TICK_S * COMMAND_CHARGE_RATE);
            if (aim.power < goal) break;
          }
          script.shift();
          const power = def.charged ? goal : 1;
          aim = { ...aim, charging: false, power: 0 };
          const target = def.requiresTargetSelect ? (step.targetPoint ?? null) : null;
          if (def.requiresTargetSelect && target === null) break;
          startShot(weapon, {
            angleDeg: aim.angleDeg,
            power,
            ...(target === null ? {} : { targetPoint: target }),
            ...(def.fuse === undefined ? {} : { fuseMs: step.fuseMs ?? selectedFuseMs() ?? def.fuse.defaultMs }),
          });
          break;
        }
      }
    }
    humanIntent = intent;
    apply({ type: 'TimerTick', dtMs: TICK_MS });
    emitSim();
    // The shot is out (or the turn moved on): nothing left of the command applies.
    if (state.phase !== 'Active') script = [];
  };

  const plainName = (id: WeaponId): string => getWeapon(id).name;

  /** The weapon the worm will hold once the orders queued so far are done. */
  const queuedWeapon = (): WeaponId => {
    for (let i = script.length - 1; i >= 0; i -= 1) {
      const step = script[i];
      if (step?.kind === 'weapon') return step.id;
      if (step?.kind === 'plan') return step.weapon;
    }
    return selectedWeapon();
  };

  /** The aim the worm will hold once the orders queued so far are done ("apunta a 30 y sube 10" is 40). */
  const queuedAim = (): number => {
    for (let i = script.length - 1; i >= 0; i -= 1) {
      const step = script[i];
      if (step?.kind === 'aim') return step.angleDeg;
    }
    return aim.angleDeg;
  };

  /** Why the worm cannot use this weapon now, or null when it can. */
  const whyUnusable = (id: WeaponId): string | null => {
    const worm = activeWormOf(state);
    if (worm === undefined) return 'no worm';
    if ((worm.ammo[id] ?? 0) === 0) return `${worm.name} has no ${plainName(id)} left.`;
    const delay = getWeapon(id).delayTurns ?? 0;
    if (worm.turns < delay) return `${plainName(id)} opens on ${worm.name}'s turn ${delay + 1}.`;
    if (isSuper(id) && supersRest()) return `${worm.name} used a super last turn and rests them this turn.`;
    return null;
  };

  /** Asks the heuristic for the best shot with that weapon (at that worm, when named) and turns it into a plan. */
  const planAuto = (weapon: WeaponId, targetWormId: string | undefined, from: PlanWorm): AutoPlan => {
    const snapshot = buildSnapshot();
    const team = activeTeamOf(state);
    const worms = snapshot.worms.filter((w) => targetWormId === undefined || w.teamId === team?.id || w.id === targetWormId);
    const scoped = { ...snapshot, difficulty: 'hard' as const, worms, ammo: snapshot.ammo.filter((a) => a.weapon === weapon) };
    const request = buildCpuRequest(scoped);
    const response = decideHeuristic({
      request,
      registry: WEAPONS,
      mask: snapshot.mask,
      worms: worms.map((w) => ({ id: w.id, teamId: w.teamId, x: w.x, y: w.y, hp: w.hp, alive: w.alive, ...(w.size === undefined ? {} : { size: w.size }) })),
    });
    const enemies: PlanWorm[] = snapshot.worms.filter((w) => w.teamId !== team?.id && w.alive).map((w) => ({ id: w.id, teamId: w.teamId, x: w.x, y: w.y, hp: w.hp, alive: w.alive }));
    return planFromResponse({ response, weapon, from, enemies, stepPx: MOVE.stepPx, ...(targetWormId === undefined ? {} : { targetWormId }) });
  };

  const nameOf = (wormId: string | null): string | null => (wormId === null ? null : (findWormState(state, wormId)?.worm.name ?? null));

  const command = (cmd: WormCommand): CommandResult => {
    if (cmd.kind === 'detonate') {
      // In flight, not on the worm: the sheep runs while the shot is out, so this is the one order taken outside Active.
      if (!isHumanTurn() || state.phase === 'MatchEnd') return refuse('It is not a human turn.');
      const set = detonateOwnSheep();
      if (set === 0) return refuse('There is no sheep of yours running to set off.');
      const sheep = world.sheep.find((s) => s.alive && s.detonateRequested);
      events.push({ type: 'detonateOrder', wormId: activeWormOf(state)?.id ?? '', x: sheep?.x ?? 0, y: sheep?.y ?? 0 });
      return ok(set === 1 ? 'The sheep goes off!' : `${set} sheep go off!`);
    }
    if (cmd.kind === 'stop') {
      script = [];
      return ok('Stopped.');
    }
    const ready = commandable();
    if (typeof ready === 'string') return refuse(ready);
    const { worm, body } = ready;
    // Orders given while the worm is still at the last one queue behind it ("walk 5 left, then fire").
    const queued = script.length > 0;
    switch (cmd.kind) {
      case 'select': {
        if (cmd.wormId === worm.id) return ok(`${worm.name} is already up.`);
        const team = activeTeamOf(state);
        const picked = team?.worms.find((w) => w.id === cmd.wormId);
        if (picked === undefined) return refuse('That worm is not on the team whose turn it is.');
        if (!picked.alive || picked.hp <= 0) return refuse(`${picked.name} is out of the fight.`);
        if (queued || spentPx > 0 || state.shot !== null) return refuse(`${worm.name} has already moved this turn; pick a worm before it walks.`);
        apply({ type: 'WormSelected', wormId: picked.id });
        if (activeWormOf(state)?.id !== picked.id) return refuse(`${picked.name} cannot play this turn.`);
        aim = INITIAL_AIM;
        letGoOfUnusable();
        const pickedBody = findBody(world, picked.id);
        events.push({ type: 'wormPicked', wormId: picked.id, name: picked.name, x: pickedBody?.x ?? body.x, y: (pickedBody?.y ?? body.y) - 20 });
        return ok(`${picked.name}, I choose you!`, { worm: picked.name });
      }
      case 'walk': {
        const steps = Math.max(1, Math.min(MAX_COMMAND_STEPS, Math.round(cmd.steps)));
        // The steps a walk still queued will spend are not this one's to promise.
        const queuedSteps = script.reduce((sum, s) => sum + (s.kind === 'walk' ? s.steps - s.counted : 0), 0);
        const left = Math.max(0, stepsRemaining() - queuedSteps);
        if (left <= 0) return refuse(`${worm.name} has no steps left this turn.`);
        const taken = Math.min(steps, left);
        script.push({ kind: 'walk', dir: cmd.dir, steps: taken, startPx: null, counted: 0, lastPx: 0, stall: 0 });
        return ok(`${worm.name} walks ${taken} step${taken === 1 ? '' : 's'} ${cmd.dir < 0 ? 'left' : 'right'}${taken < steps ? ` (only ${left} left this turn)` : ''}.`, { steps: taken });
      }
      case 'face':
        script.push({ kind: 'face', dir: cmd.dir });
        return ok(`${worm.name} turns ${cmd.dir < 0 ? 'left' : 'right'}.`);
      case 'jump':
      case 'backflip':
        if (!canMove()) return refuse(`${worm.name} has no steps left to jump with.`);
        script.push({ kind: 'hop', backflip: cmd.kind === 'backflip' });
        return ok(`${worm.name} ${cmd.kind === 'jump' ? 'jumps' : 'backflips'}.`);
      case 'aim': {
        const angle = Math.max(-90, Math.min(90, cmd.angleDeg));
        script.push({ kind: 'aim', angleDeg: angle });
        return ok(`Aiming at ${Math.round(angle)} degrees.`);
      }
      case 'aimBy': {
        const angle = Math.max(-90, Math.min(90, queuedAim() + cmd.deltaDeg));
        script.push({ kind: 'aim', angleDeg: angle });
        return ok(`Aiming at ${Math.round(angle)} degrees.`);
      }
      case 'weapon': {
        const why = whyUnusable(cmd.id);
        if (why !== null) return refuse(why);
        if (queued) script.push({ kind: 'weapon', id: cmd.id });
        else selectWeapon(cmd.id);
        return ok(`${worm.name} takes the ${plainName(cmd.id)}.`, { weapon: cmd.id });
      }
      case 'fire': {
        const weapon = queuedWeapon();
        const why = whyUnusable(weapon);
        if (why !== null) return refuse(why);
        const def = getWeapon(weapon);
        // "Dispárale a Ana": a shot at a worm is aimed at it, not fired along whatever aim is up.
        if (cmd.targetWormId !== undefined && !def.requiresTargetSelect) return command({ kind: 'auto', weapon, targetWormId: cmd.targetWormId });
        if (def.requiresTargetSelect && cmd.targetPoint === undefined) return refuse(`The ${plainName(weapon)} needs a target: name a worm, or ask for an auto attack.`);
        script.push({ kind: 'fire', power: cmd.power ?? 1, ...(cmd.targetPoint === undefined ? {} : { targetPoint: cmd.targetPoint }) });
        return ok(`${worm.name} fires the ${plainName(weapon)}!`, { weapon });
      }
      case 'auto': {
        const weapon = cmd.weapon ?? queuedWeapon();
        const why = whyUnusable(weapon);
        if (why !== null) return refuse(why);
        const team = activeTeamOf(state);
        if (cmd.targetWormId !== undefined) {
          const target = findWormState(state, cmd.targetWormId);
          if (target === null || !target.worm.alive || target.team.id === team?.id) return refuse('That is not an enemy worm still in the fight.');
        }
        if (queued) {
          script.push({ kind: 'plan', weapon, ...(cmd.targetWormId === undefined ? {} : { targetWormId: cmd.targetWormId }), ...(cmd.message === undefined ? {} : { message: cmd.message }) });
          return ok(`${worm.name} will work out the ${plainName(weapon)} shot once it gets there.`, { weapon });
        }
        startAuto(worm, body, weapon, cmd.targetWormId, cmd.message);
        return lastAuto ?? ok('');
      }
      case 'skip':
        if (queued) return refuse(`${worm.name} is still busy; say stop first.`);
        apply({ type: 'SkipTurn', reason: 'skip' });
        return ok(`${worm.name} passes the turn.`);
    }
  };

  /** The answer of the last auto attack planned, for the tool that asked for it. */
  let lastAuto: CommandResult | null = null;

  /** Plans an auto attack from where the worm stands now and queues it: the calculating, the walk, the turn, the aim, the shot. */
  /** How close the sheep gets to the worm it was sent at before it goes off, world px. */
  const SHEEP_REACH_PX = 16;

  /** The sheep an auto attack sent goes off once it reaches its worm (or the worm is gone). */
  const guideSheep = (): void => {
    if (sheepTargetId === null) return;
    const team = activeTeamOf(state);
    const sheep = world.sheep.find((s) => s.alive && !s.detonateRequested && s.ownerTeamId === team?.id);
    if (sheep === undefined) return;
    const target = findBody(world, sheepTargetId);
    if (target === undefined || !target.alive || hpOf(target.id) <= 0) {
      sheepTargetId = null;
      return;
    }
    if (Math.abs(sheep.x - target.x) <= SHEEP_REACH_PX && Math.abs(sheep.y - target.y) <= 40 && sheepWorthIt(sheep.x, sheep.y, target.id)) {
      sheepTargetId = null;
      detonateOwnSheep();
      events.push({ type: 'detonateOrder', wormId: activeWormOf(state)?.id ?? '', x: sheep.x, y: sheep.y });
    }
  };

  /** Going off here hurts the target more than it hurts the worm's own team (itself included). */
  const sheepWorthIt = (x: number, y: number, targetId: string): boolean => {
    const blast = getWeapon('sheep').blast;
    if (blast === undefined) return true;
    const team = activeTeamOf(state);
    let enemy = 0;
    let friendly = 0;
    for (const worm of world.worms) {
      if (!worm.alive || hpOf(worm.id) <= 0) continue;
      const dealt = Math.min(hpOf(worm.id), blastDamage(blast.maxDamage, Math.hypot(worm.x - x, wormMiddleY(worm) - y), blast.radiusPx));
      if (worm.teamId === team?.id) friendly += dealt;
      else if (worm.id === targetId) enemy += dealt;
    }
    return enemy > friendly;
  };

  /** The enemy worm to aim at: the one named if it still stands, else the nearest. */
  const enemyFor = (body: { readonly x: number; readonly y: number }, preferred: string | null): ReturnType<typeof findBody> => {
    const team = activeTeamOf(state);
    const alive = world.worms.filter((b) => b.alive && b.teamId !== team?.id && hpOf(b.id) > 0);
    return alive.find((b) => b.id === preferred) ?? alive.sort((a, b) => Math.hypot(a.x - body.x, a.y - body.y) - Math.hypot(b.x - body.x, b.y - body.y))[0];
  };

  /** Solves the shot at a worm from where the body stands now (aim-at.ts), against the live terrain and wind. */
  const solveAim = (body: NonNullable<ReturnType<typeof findBody>>, weapon: WeaponId, preferred: string | null): (ReturnType<typeof aimAtWorm> & { readonly targetId: string | null }) | null => {
    const target = enemyFor(body, preferred);
    if (target === undefined) return null;
    const point = (b: NonNullable<ReturnType<typeof findBody>>) => ({ id: b.id, teamId: b.teamId, x: b.x, y: b.y, hp: hpOf(b.id), alive: b.alive && hpOf(b.id) > 0, size: b.size });
    const solution = aimAtWorm({
      def: getWeapon(weapon),
      from: point(body),
      target: point(target),
      worms: world.worms.map(point),
      // The wind the sim really applies (world.wind), which is what the shell will feel.
      env: { mask: world.terrain.mask, waterY: state.waterY, wind: world.wind, gravity: world.gravity },
    });
    return { ...solution, targetId: target.id };
  };

  const startAuto = (worm: NonNullable<ReturnType<typeof activeWormOf>>, body: NonNullable<ReturnType<typeof findBody>>, weapon: WeaponId, targetWormId: string | undefined, cry: string | undefined): void => {
    const team = activeTeamOf(state);
    const from: PlanWorm = { id: worm.id, teamId: team?.id ?? '', x: body.x, y: body.y, hp: worm.hp, alive: true };
    const def = getWeapon(weapon);
    const heuristicPlan = planAuto(weapon, targetWormId, from);
    // The heuristic found no shot it trusts: no walk, the aim is solved at the worm from here.
    const plan = heuristicPlan.fallback ? { ...heuristicPlan, walkDir: 0 as const, walkSteps: 0, walkPx: 0, targetId: heuristicPlan.targetId ?? targetWormId ?? null } : { ...heuristicPlan };
    // The worm the player named is the target, whoever the heuristic's shot would also catch.
    if (targetWormId !== undefined) plan.targetId = targetWormId;
    const shell = def.projectile !== undefined && def.blast !== undefined;
    if (shell && def.blast !== undefined) {
      // A shell: from here if there is a clean shot from here; too close to the target, a few steps
      // back first, out of its own blast; otherwise where the heuristic would walk.
      const radius = def.blast.radiusPx;
      const here = solveAim(body, weapon, plan.targetId);
      const target = here === null ? undefined : findBody(world, here.targetId ?? '');
      const gap = target === undefined ? Infinity : Math.abs(target.x - body.x);
      if (here !== null && here.safe && here.missPx <= radius * 0.6) {
        Object.assign(plan, { walkDir: 0, walkSteps: 0, walkPx: 0 });
      } else if (target !== undefined && gap < radius * 2.5) {
        const px = radius * 2.5 - gap + 8;
        Object.assign(plan, { walkDir: target.x < body.x ? 1 : -1, walkSteps: Math.max(1, Math.ceil(px / MOVE.stepPx)), walkPx: px });
      }
    }
    // A shell, an animal, a strike or a guess is aimed again after the walk (the walk can end a few px
    // off the plan, and a shell fired from the wrong spot can land at the worm's own feet).
    const reaim = plan.fallback || (def.projectile !== undefined && def.blast !== undefined) || def.kind === 'ANIMAL' || def.requiresTargetSelect;
    const affordable = Math.min(plan.walkSteps, stepsRemaining());
    // What the calculating shows: the real solution when the worm fires from where it stands.
    const shown = reaim && (plan.walkDir === 0 || affordable === 0) ? solveAim(body, weapon, plan.targetId) : null;
    if (shown !== null) Object.assign(plan, { angleDeg: Math.round(shown.angleDeg), power: shown.power, targetId: shown.targetId });
    const targetName = nameOf(plan.targetId);
    const message = cry !== undefined && cry.trim() !== '' ? cry.trim().slice(0, 80) : `${plainName(weapon).toUpperCase()}!`;
    const targets = world.worms.filter((b) => b.alive && b.teamId !== team?.id && hpOf(b.id) > 0).map((b) => ({ id: b.id, x: b.x, y: b.y - wormHeight(b) / 2 }));
    events.push({
      type: 'aiScan',
      wormId: worm.id,
      name: worm.name,
      weapon,
      targets,
      targetId: plan.targetId,
      angleDeg: plan.angleDeg,
      power: plan.power,
      confidence: plan.confidence,
      message,
      ticks: CALC_TICKS,
      x: body.x,
      y: body.y - wormHeight(body),
    });
    // In front of whatever was queued after it, so the orders keep the order they were given in.
    const steps: ScriptStep[] = [];
    steps.push({ kind: 'weapon', id: weapon });
    steps.push({ kind: 'wait', ticks: CALC_TICKS });
    if (plan.walkDir !== 0 && affordable > 0) steps.push({ kind: 'walk', dir: plan.walkDir, steps: affordable, ...(affordable === plan.walkSteps ? { px: plan.walkPx } : {}), startPx: null, counted: 0, lastPx: 0, stall: 0 });
    if (reaim) {
      // Aimed again once the walk is over, from where the worm really stands.
      steps.push({ kind: 'aimAt', targetId: plan.targetId, weapon, ...(plan.fuseMs === undefined ? {} : { fuseMs: plan.fuseMs }) });
    } else {
      steps.push({ kind: 'face', dir: plan.facing });
      steps.push({ kind: 'aim', angleDeg: plan.angleDeg });
      steps.push({ kind: 'fire', power: plan.power, ...(plan.targetPoint === undefined ? {} : { targetPoint: plan.targetPoint }), ...(plan.fuseMs === undefined ? {} : { fuseMs: plan.fuseMs }) });
    }
    script.unshift(...steps);
    lastAuto = ok(
      plan.targetId === null
        ? `${worm.name} finds nobody to hit with the ${plainName(weapon)}.`
        : `${worm.name} locks on ${targetName}: ${plainName(weapon)} at ${plan.angleDeg} degrees, ${Math.round(plan.power * 100)}% power${affordable > 0 ? `, after ${affordable} step${affordable === 1 ? '' : 's'} ${plan.walkDir < 0 ? 'left' : 'right'}` : ''}${shown !== null && !shown.safe ? ' (too close: it may get caught in its own blast)' : ''}.`,
      { weapon, target: targetName, angleDeg: plan.angleDeg, power: Math.round(plan.power * 100), walkSteps: affordable, confidence: plan.confidence, fallback: plan.fallback },
    );
  };

  return {
    command,
    commandBusy: () => script.length > 0,
    tick(input) {
      endFightsAtMatchEnd();
      dropAnnouncedCrate();
      // A cap ended Resolving with bodies still live: blow them up now so nothing carries over into
      // the next turn. Mines stay, they are placed on purpose. Once per turn.
      if (state.phase === 'TurnEnd' && state.settle?.forceSettled === true && !forceSettledHandled) {
        forceSettledHandled = true;
        for (const p of [...world.projectiles]) if (p.alive) detonate(world, p);
        for (const sheep of [...world.sheep]) if (sheep.alive) detonateSheep(world, sheep);
        drainSimAfterFire();
      }
      if (state.phase !== 'TurnEnd') forceSettledHandled = false;
      // Advance banners for the presentation phases; the game loop sends BannerDone when they end.
      if (state.phase === 'TurnStart' || state.phase === 'TurnEnd' || state.phase === 'SuddenDeathCheck' || state.phase === 'HotSeat') {
        bannerMs -= TICK_MS;
        if (bannerMs <= 0) {
          bannerMs = BANNER_MS;
          apply({ type: state.phase === 'HotSeat' ? 'TimerTick' : 'BannerDone', ...(state.phase === 'HotSeat' ? { dtMs: BANNER_MS } : {}) } as MatchEvent);
          if (isHumanTurn()) aim = INITIAL_AIM;
          // Drop any CPU plan left over from a turn the timer force-ended mid-walk, so it cannot
          // replay onto the next active worm (which is normally the human's).
          pending.walk = [];
          pending.fireAfterWalk = null;
          pending.fireWeapon = null;
          pending.cpuRequested = false;
          pending.cpuDecided = false;
          pending.refireTicks = 0;
          pending.burst = null;
          pending.sequence = null;
          script = [];
          sheepTargetId = null;
          // A fresh turn, a fresh movement budget and the first barrel.
          spentPx = 0;
          shotIndex = 0;
          letGoOfUnusable();
        }
        return;
      }

      if (state.phase === 'Active') {
        if (isHumanTurn() && script.length > 0) {
          // A key pressed while a command plays takes the worm back.
          if (input.moveX !== 0 || input.fireHeld || input.jump || input.backflip || input.aimDelta !== 0) script = [];
          else {
            playScript();
            return;
          }
        }
        if (isHumanTurn()) {
          // Walking and jumping both draw on the movement budget; aiming and firing never do, so a
          // worm that has spent its steps can still take the shot.
          const mayMove = canMove();
          const active = activeWormOf(state);
          const activeBody = active === undefined ? undefined : findBody(world, active.id);
          // On a jetpack the jump key is thrust, not a jump, and flying does not spend steps.
          const flying = activeBody !== undefined && inTheAir(activeBody.motion);
          const jump = input.jump && mayMove && !flying;
          const backflip = input.backflip && mayMove && !flying;
          if (jump || backflip) chargeJump();
          humanIntent = { moveX: flying || mayMove ? input.moveX : 0, jump, backflip, thrust: input.thrust };
          aim = tickCharge(aimBy(aim, input.aimDelta, TICK_S), input.fireHeld, TICK_S);
          if (input.selectedSlot !== null) {
            const pick = WEAPON_IDS[input.selectedSlot - 1];
            if (pick !== undefined) selectWeapon(pick);
          }
          apply({ type: 'TimerTick', dtMs: TICK_MS });
          emitSim();
          const weapon = selectedWeapon();
          const def = getWeapon(weapon);
          // A targeted weapon (air strike, teleport, girder) fires where the player CLICKS; the
          // fire key still works and takes the point under the crosshair at release.
          const fuseMs = (input.fuse ?? 0) * 1000;
          if (def.fuse?.selectable && def.fuse.optionsMs.includes(fuseMs)) fuseByWorm.set(wormKey(), fuseMs);
          const clickFire = input.pointerClicked && def.requiresTargetSelect;
          if (clickFire || (input.fireReleased && aim.power > 0)) {
            const { power } = release(aim);
            startShot(weapon, { angleDeg: aim.angleDeg, power, ...(def.requiresTargetSelect ? { targetPoint: input.pointer } : {}), ...(def.fuse === undefined ? {} : { fuseMs: selectedFuseMs() ?? def.fuse.defaultMs }) });
            aim = { ...aim, power: 0 };
          }
        } else {
          // CPU turn: request a decision once, walk it out, then fire.
          if (!pending.cpuRequested) {
            pending.cpuRequested = true;
            runCpuTurn();
          }
          humanIntent = IDLE_INTENT;
          apply({ type: 'TimerTick', dtMs: TICK_MS });
          emitSim();
          if (pending.refireTicks > 0) pending.refireTicks -= 1;
          if (pending.walk.length === 0 && pending.fireAfterWalk !== null && pending.fireWeapon !== null && !cpuBusy && pending.refireTicks === 0) {
            const weapon = pending.fireWeapon;
            const cpuWorm = activeWormOf(state);
            const cpuBody = cpuWorm === undefined ? undefined : findBody(world, cpuWorm.id);
            if (cpuBody !== undefined) cpuBody.facing = pending.fireFacing;
            aim = setAngle(aim, pending.fireAfterWalk.angleDeg);
            startShot(weapon, pending.fireAfterWalk);
            // A two barrel weapon brings the reducer back to Active with a shot still owed: keep
            // the plan and fire again after a beat. Dropping it here left the CPU standing with an
            // open shot until the 45 s timer.
            const barrelOwed = state.phase === 'Active' && state.shot !== null && state.shot.shotsRemaining > 0;
            if (barrelOwed) {
              pending.refireTicks = REFIRE_TICKS;
            } else {
              pending.fireAfterWalk = null;
              pending.fireWeapon = null;
            }
          } else if (pending.cpuDecided && !cpuBusy && pending.walk.length === 0 && pending.fireAfterWalk === null && pending.burst === null && pending.sequence === null && state.phase === 'Active') {
            // The decision came back with nothing to do (or failed): pass instead of riding the clock.
            apply({ type: 'SkipTurn', reason: 'skip' });
          }
        }
        return;
      }

      if (isSimPhase(state.phase)) {
        playStrikes();
        // The retreat window belongs to the player: walk, jump, and steer a parachute or jetpack.
        // The CPU never walks in it, so its retreat ends at once instead of standing 3 s (RetreatDone
        // was sent by nobody in production before this).
        if (state.phase === 'Retreat' && !isHumanTurn()) apply({ type: 'RetreatDone' });
        humanIntent = state.phase === 'Retreat' && isHumanTurn() ? { moveX: input.moveX, jump: input.jump, backflip: input.backflip, thrust: input.thrust } : IDLE_INTENT;
        // The second fire press detonates the sheep while it runs (its spec's detonateOnSecondFire).
        if (input.fireReleased && isHumanTurn()) detonateOwnSheep();
        guideSheep();
        if (state.phase === 'Firing' && isHumanTurn() && pending.burst !== null && getWeapon(pending.burst.weapon).hitscan?.aimWhileFiring) {
          aim = aimBy(aim, input.aimDelta, TICK_S);
          pending.burst = { ...pending.burst, aim: { ...pending.burst.aim, angleDeg: aim.angleDeg } };
        }
        stepBurst();
        stepSequence();
        apply({ type: 'TimerTick', dtMs: TICK_MS });
        emitSim();
        if (state.phase === 'Resolving' && worldAtRest(world)) {
          state = snapshotPositions(state, world);
          apply({ type: 'AllBodiesAtRest' });
        }
      }
    },
    state: () => state,
    world: () => world,
    aim: () => aim,
    selectedWeapon,
    selectedFuseMs,
    selectWeapon,
    stepsRemaining,
    stepsPerTurn: () => MOVE.stepsPerTurn,
    drainEvents: () => events.splice(0, events.length),
    skipTurn() {
      if (state.phase !== 'Active') return;
      apply({ type: 'SkipTurn', reason: 'skip' });
    },
    surrender(teamId) {
      apply({ type: 'Surrender', teamId });
      endFightsAtMatchEnd();
      syncMatchToSim(state, world);
      observeCasualties();
    },
    advanceRoundClock(ms) {
      apply({ type: 'TimerTick', dtMs: ms });
    },
    banner() {
      const team = activeTeamOf(state);
      switch (state.phase) {
        case 'TurnStart':
          // Only sealed worms left: the turn goes to the Tesoro del Cielo, they have no senses to fight with.
          if (team !== undefined && activeWormSealed(state)) return `${team.name}: ¡SIN SENTIDOS!`;
          return `${team?.name ?? ''}: ${activeWormOf(state)?.name ?? ''}`;
        case 'SuddenDeathCheck':
          return state.suddenDeath ? 'Sudden death' : null;
        case 'MatchEnd':
          return 'Game over';
        default:
          return null;
      }
    },
  };
}

export { WEAPONS };
