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
import { reduce } from '../match/machine.ts';
import type { MatchEvent } from '../match/events.ts';
import type { MatchState } from '../match/state.ts';
import { activeTeamOf, activeWormOf } from '../match/ledger.ts';
import { WEAPONS, WEAPON_IDS, getWeapon } from '../weapons/registry.ts';
import { fire, type FireAim, type FireResult } from '../weapons/fire.ts';
import { worldAtRest, findWorm as findBody, type SimWorld } from '../sim/world.ts';
import { stepWorld } from '../sim/world.ts';
import { IDLE_INTENT, type SimEvent, type WormIntent } from '../sim/types.ts';
import { pickCrateColumn, spawnCrate } from '../sim/crate.ts';
import { detonate } from '../sim/projectile.ts';
import { detonateSheep } from '../sim/sheep.ts';
import { createCpuState, decideCpuTurn, type CpuControllerOptions, type CpuControllerState } from '../ai/cpu-controller.ts';
import { buildPlan, capWalkTicks, quantizePower } from '../ai/plan-executor.ts';
import { windFractionFromStep } from '../match/state.ts';
import { GRAVITY_PX_PER_S2 } from '../sim/constants.ts';
import type { SnapshotInput } from '../ai/snapshot.ts';
import { INITIAL_AIM, aimBy, release, setAngle, tickCharge, type AimState } from './aim.ts';
import { isSimPhase, snapshotPositions, syncMatchToSim, translateSimEvents } from './bridge.ts';
import type { Game } from './setup.ts';
import type { WeaponId } from '../weapons/types.ts';

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

export interface GameEvent {
  readonly type: 'sound' | 'explosion';
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
  readonly shake?: number;
  /** Blast tier from the weapon row, so the presentation can scale the fireworks to the weapon. */
  readonly particle?: 'small' | 'medium' | 'big' | 'holy';
}

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
  /**
   * Advances the round clock by ms. A large value also expires the current turn timer, which is
   * the normal path into TurnEnd and the SuddenDeathCheck, so the verification harness uses this
   * to reach sudden death without playing out the whole round.
   */
  advanceRoundClock(ms: number): void;
}

interface Pending {
  /** Queued human or CPU walk intents to feed before firing. */
  walk: WormIntent[];
  fireAfterWalk: FireAim | null;
  fireWeapon: WeaponId | null;
  cpuRequested: boolean;
  /** The CPU decision has come back (with or without a plan), so standing still is not "waiting". */
  cpuDecided: boolean;
  /** Ticks before the CPU may fire the next barrel of a multi shot weapon. */
  refireTicks: number;
  /** A gun burst in progress: the remaining rounds fire one per interval while the phase is Firing. */
  burst: Burst | null;
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
  const pending: Pending = { walk: [], fireAfterWalk: null, fireWeapon: null, cpuRequested: false, cpuDecided: false, refireTicks: 0, burst: null };

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

  const selectWeapon = (id: WeaponId): void => {
    const index = WEAPON_IDS.indexOf(id);
    if (index === -1) return;
    const worm = activeWormOf(state);
    // The panel greys out empty and delayed weapons, but a stale click or a script must not slip
    // one through: no ammo, or a scheme delay not yet elapsed (the panel's isUnlocked rule).
    const count = worm?.ammo[id] ?? 0;
    if (count === 0) return;
    if (state.turn < (getWeapon(id).delayTurns ?? 0)) return;
    setSlot(index);
  };

  const apply = (event: MatchEvent): void => {
    state = reduce(state, event, game.deps);
  };

  const emitSim = (): void => {
    const active = activeWormOf(state);
    const body = active === undefined ? undefined : findBody(world, active.id);
    const beforeX = body?.x;
    // Sampled once: the CPU walk queue is consumed by this call, a second one would skip a tick.
    const intents = currentIntents();
    const commandedWalk = active !== undefined && (intents.get(active.id)?.moveX ?? 0) !== 0;
    const simEvents = stepWorld(world, intents);
    // Bill only the phase the budget governs and only ticks the player actually asked to walk.
    if (state.phase === 'Active' && commandedWalk && body !== undefined && beforeX !== undefined) {
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
    for (const e of simEvents) {
      if (e.type === 'sound') events.push({ type: 'sound', id: e.id, x: e.x, y: e.y });
      else if (e.type === 'explosion') events.push({ type: 'explosion', x: e.x, y: e.y, radius: e.radius, shake: e.shake, particle: e.particle });
    }
    for (const matchEvent of translateSimEvents(simEvents)) apply(matchEvent);
    syncMatchToSim(state, world);
  };

  /** Drains what fire() just emitted through the same path as a tick's events. */
  const drainSimAfterFire = (): void => {
    applySimEvents(world.events.splice(0, world.events.length));
  };

  let humanIntent: WormIntent = IDLE_INTENT;

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
    // Damage a gun or a punch dealt inside fire() is booked while the phase is still Firing, so
    // the shot window credits it and a lethal hit resolves the way a projectile kill does.
    drainSimAfterFire();
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
    drainSimAfterFire();
    burst.roundsLeft -= 1;
    burst.ticksUntilNext = burst.intervalTicks;
    if (burst.roundsLeft <= 0 || body === undefined) {
      pending.burst = null;
      completeShot(def, body?.motion ?? 'idle', result);
    }
  };

  /** A second fire press while the sim runs detonates the active team's sheep, as its spec promises. */
  const detonateOwnSheep = (): void => {
    const team = activeTeamOf(state);
    if (team === undefined) return;
    for (const sheep of world.sheep) {
      if (sheep.alive && sheep.ownerTeamId === team.id && sheep.spec.detonateOnSecondFire) sheep.detonateRequested = true;
    }
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
    const worms = world.worms.map((b) => ({ id: b.id, teamId: b.teamId, x: b.x, y: b.y, hp: hpOf(b.id), alive: b.alive && hpOf(b.id) > 0 }));
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
      ammo: active === undefined ? [] : (Object.entries(active.ammo) as [WeaponId, number][]).filter(([id, n]) => n !== 0 && state.turn >= (getWeapon(id).delayTurns ?? 0)).map(([weapon, count]) => ({ weapon, count })),
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
      const body = activeWormOf(state);
      const simBody = body === undefined ? undefined : findBody(world, body.id);
      if (simBody !== undefined) simBody.facing = plan.facing;
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

  return {
    tick(input) {
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
          // A fresh turn, a fresh movement budget and the first barrel.
          spentPx = 0;
          shotIndex = 0;
        }
        return;
      }

      if (state.phase === 'Active') {
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
          } else if (pending.cpuDecided && !cpuBusy && pending.walk.length === 0 && pending.fireAfterWalk === null && pending.burst === null && state.phase === 'Active') {
            // The decision came back with nothing to do (or failed): pass instead of riding the clock.
            apply({ type: 'SkipTurn', reason: 'skip' });
          }
        }
        return;
      }

      if (isSimPhase(state.phase)) {
        // The retreat window belongs to the player: walk, jump, and steer a parachute or jetpack.
        // The CPU never walks in it, so its retreat ends at once instead of standing 3 s (RetreatDone
        // was sent by nobody in production before this).
        if (state.phase === 'Retreat' && !isHumanTurn()) apply({ type: 'RetreatDone' });
        humanIntent = state.phase === 'Retreat' && isHumanTurn() ? { moveX: input.moveX, jump: input.jump, backflip: input.backflip, thrust: input.thrust } : IDLE_INTENT;
        // The second fire press detonates the sheep while it runs (its spec's detonateOnSecondFire).
        if (input.fireReleased && isHumanTurn()) detonateOwnSheep();
        if (state.phase === 'Firing' && isHumanTurn() && pending.burst !== null && getWeapon(pending.burst.weapon).hitscan?.aimWhileFiring) {
          aim = aimBy(aim, input.aimDelta, TICK_S);
          pending.burst = { ...pending.burst, aim: { ...pending.burst.aim, angleDeg: aim.angleDeg } };
        }
        stepBurst();
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
    surrender(teamId) {
      apply({ type: 'Surrender', teamId });
    },
    advanceRoundClock(ms) {
      apply({ type: 'TimerTick', dtMs: ms });
    },
    banner() {
      const team = activeTeamOf(state);
      switch (state.phase) {
        case 'TurnStart':
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
