/**
 * Super moves in the sim (Ryuko Ranbu): a timeline the world steps once per tick, like the sheep.
 * The fire behavior locks the victim and plans the rush (weapons/behaviors/combo.ts); this module
 * plays it: the super freeze, the rush, the flurry of blows, the finisher that throws the victim,
 * and the recovery pose. The attacker, and the victim until the finisher, are HELD: stepWorld
 * skips them in the worm controller and the combo places them every tick, so gravity, landings and
 * the drowning check never interfere with the beating.
 *
 * Damage is emitted, never applied (the match reducer applies it), and every blow says where it
 * landed and which way it pushed, so the presentation can spray the blood the right way. Mutates
 * the bodies in place (hot path), like the rest of the sim.
 */

import { MELEE_KNOCKBACK_SCALE, TICK_S, WORM_HEIGHT } from './constants.ts';
import type { ComboBody, ComboStage, HitPoint, WormBody } from './types.ts';
import type { SimWorld } from './world.ts';
import type { ComboSpec } from '../weapons/types.ts';

/** Cues of the beating, all present in the audio plan. */
export const COMBO_SOUNDS = Object.freeze({
  flash: 'wpn_teleport_zap',
  rush: 'wpn_firepunch_whoosh',
  blows: Object.freeze(['wpn_firepunch_thud', 'wpn_bat_crack']),
  grunts: Object.freeze(['wrm_hurt_grunt_1', 'wrm_hurt_grunt_2', 'wrm_hurt_grunt_3']),
  finisher: Object.freeze(['wpn_bat_crack', 'exp_small_2']),
});

/**
 * Every blow lands somewhere else on the body at another angle, so the flurry reads as a beating
 * and the blood fans out instead of spraying one line. lift is radians above the horizontal of the
 * rush, height the fraction of the worm's height above its feet. Fixed, so replays match.
 */
const BLOW_PATTERN: readonly { readonly lift: number; readonly height: number }[] = Object.freeze([
  { lift: 0.2, height: 0.58 },
  { lift: -0.3, height: 0.74 },
  { lift: 0.6, height: 0.42 },
  { lift: 0.05, height: 0.82 },
  { lift: 0.4, height: 0.5 },
  { lift: -0.15, height: 0.66 },
  { lift: 0.75, height: 0.36 },
  { lift: 0.25, height: 0.7 },
]);

/** The finisher is an uppercut: the blood and the victim go up and away. */
const FINISHER_LIFT = 0.95;

const NOBODY: ReadonlySet<string> = new Set();

export function ticksFor(ms: number): number {
  return Math.max(1, Math.round(ms / 1000 / TICK_S));
}

/** Total length of a landed combo in ticks: freeze, rush, flurry, the finisher tick and the pose. */
export function comboTicks(spec: ComboSpec): number {
  return ticksFor(spec.startupMs) + ticksFor(spec.dashMs) + spec.hits * ticksFor(spec.hitIntervalMs) + 1 + ticksFor(spec.recoverMs);
}

export interface SpawnComboParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly victim: WormBody | null;
  readonly spec: ComboSpec;
  readonly facing: 1 | -1;
  /** Where the attacker plants its feet for the beating (or where a whiffed rush ends). */
  readonly toX: number;
  readonly toY: number;
  /** Where the attacker is left standing when it is over. */
  readonly restX: number;
  readonly restY: number;
}

export function spawnCombo(world: SimWorld, params: SpawnComboParams): ComboBody {
  const { attacker, victim } = params;
  attacker.facing = params.facing;
  const combo: ComboBody = {
    id: world.nextId(),
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    victimId: victim === null ? null : victim.id,
    spec: params.spec,
    stage: 'startup',
    stageTicks: 0,
    fromX: attacker.x,
    fromY: attacker.y,
    toX: params.toX,
    toY: params.toY,
    restX: params.restX,
    restY: params.restY,
    holdX: victim === null ? params.toX : victim.x,
    holdY: victim === null ? params.toY : victim.y,
    facing: params.facing,
    hitsLanded: 0,
    alive: true,
  };
  world.combos.push(combo);
  world.events.push({ type: 'comboStart', comboId: combo.id, attackerId: attacker.id, victimId: combo.victimId, x: attacker.x, y: attacker.y });
  world.events.push({ type: 'sound', id: COMBO_SOUNDS.flash, x: attacker.x, y: attacker.y });
  return combo;
}

/** The victim stays held through the finisher tick; after it the throw is free physics. */
export function holdsVictim(stage: ComboStage): boolean {
  return stage === 'startup' || stage === 'dash' || stage === 'flurry' || stage === 'finisher';
}

/** Ids of the worms live combos hold this tick; the worm controller leaves them alone. */
export function heldWormIds(combos: readonly ComboBody[]): ReadonlySet<string> {
  if (combos.length === 0) return NOBODY;
  const held = new Set<string>();
  for (const combo of combos) {
    if (!combo.alive) continue;
    held.add(combo.attackerId);
    if (combo.victimId !== null && holdsVictim(combo.stage)) held.add(combo.victimId);
  }
  return held;
}

/** 0..1 through the current stage, for the presentation. */
export function stageProgress(combo: ComboBody): number {
  const spec = combo.spec;
  const length =
    combo.stage === 'startup' ? ticksFor(spec.startupMs)
    : combo.stage === 'dash' ? ticksFor(spec.dashMs)
    : combo.stage === 'flurry' ? spec.hits * ticksFor(spec.hitIntervalMs)
    : combo.stage === 'recover' ? ticksFor(spec.recoverMs)
    : 1;
  return Math.min(1, Math.max(0, combo.stageTicks / length));
}

function wormById(world: SimWorld, id: string | null): WormBody | undefined {
  if (id === null) return undefined;
  return world.worms.find((w) => w.id === id);
}

function place(worm: WormBody, x: number, y: number): void {
  worm.x = x;
  worm.y = y;
  worm.vx = 0;
  worm.vy = 0;
  worm.restTicks = 0;
  if (worm.motion !== 'dead') worm.motion = 'idle';
}

/** Hands a held worm back to physics: it settles, or falls, from where the combo left it. */
function release(worm: WormBody): void {
  if (!worm.alive) return;
  worm.vx = 0;
  worm.vy = 0;
  worm.motion = 'falling';
  worm.onGround = false;
  worm.restTicks = 0;
  worm.fallStartY = worm.y;
}

function enter(world: SimWorld, combo: ComboBody, stage: ComboStage, attacker: WormBody): void {
  combo.stage = stage;
  combo.stageTicks = 0;
  if (stage === 'dash') world.events.push({ type: 'sound', id: COMBO_SOUNDS.rush, x: attacker.x, y: attacker.y });
}

function end(world: SimWorld, combo: ComboBody, attacker: WormBody | undefined, victim: WormBody | undefined): void {
  combo.alive = false;
  if (attacker !== undefined) release(attacker);
  // A combo cut short before its finisher still holds the victim: let it go.
  if (victim !== undefined && holdsVictim(combo.stage)) release(victim);
  world.events.push({ type: 'comboEnd', comboId: combo.id, attackerId: combo.attackerId, victimId: combo.victimId, hits: combo.hitsLanded });
}

function blowPoint(combo: ComboBody, victim: WormBody, finisher: boolean): HitPoint {
  const blow = BLOW_PATTERN[combo.hitsLanded % BLOW_PATTERN.length] ?? { lift: 0, height: 0.6 };
  const lift = finisher ? FINISHER_LIFT : blow.lift;
  const height = finisher ? 0.55 : blow.height;
  return {
    x: victim.x - combo.facing * 2,
    y: victim.y - WORM_HEIGHT * height,
    dx: Math.cos(lift) * combo.facing,
    dy: -Math.sin(lift),
  };
}

function landBlow(world: SimWorld, combo: ComboBody, victim: WormBody, finisher: boolean): void {
  const spec = combo.spec;
  const at = blowPoint(combo, victim, finisher);
  if (!finisher) combo.hitsLanded += 1;
  const amount = finisher ? spec.finisherDamage : spec.damagePerHit;
  world.events.push({ type: 'damage', wormId: victim.id, amount, sourceTeamId: combo.ownerTeamId, sourceWormId: combo.attackerId, cause: 'melee', at });
  world.events.push({ type: 'comboHit', comboId: combo.id, attackerId: combo.attackerId, victimId: victim.id, hit: combo.hitsLanded + (finisher ? 1 : 0), finisher, at });
  if (finisher) {
    for (const id of COMBO_SOUNDS.finisher) world.events.push({ type: 'sound', id, x: victim.x, y: victim.y });
    victim.vx = spec.finisherKnockback.x * combo.facing * MELEE_KNOCKBACK_SCALE;
    victim.vy = -spec.finisherKnockback.y * MELEE_KNOCKBACK_SCALE;
    victim.motion = 'flying';
    victim.onGround = false;
    victim.restTicks = 0;
    // Like the bat's victim, the thrown worm pays for its landing.
    victim.exemptNextLanding = false;
    victim.fallStartY = victim.y;
    return;
  }
  const blow = COMBO_SOUNDS.blows[combo.hitsLanded % COMBO_SOUNDS.blows.length] ?? 'wpn_firepunch_thud';
  world.events.push({ type: 'sound', id: blow, x: victim.x, y: victim.y });
  if (combo.hitsLanded % 4 === 0) {
    const grunt = COMBO_SOUNDS.grunts[(combo.hitsLanded / 4) % COMBO_SOUNDS.grunts.length] ?? 'wrm_hurt_grunt_1';
    world.events.push({ type: 'sound', id: grunt, x: victim.x, y: victim.y });
  }
}

/** One tick of a combo. Runs after the worm controller, so the placements here are final for the tick. */
export function stepCombo(world: SimWorld, combo: ComboBody): void {
  if (!combo.alive) return;
  const attacker = wormById(world, combo.attackerId);
  const victim = wormById(world, combo.victimId);
  if (attacker === undefined || !attacker.alive) {
    end(world, combo, attacker, victim);
    return;
  }
  const spec = combo.spec;
  combo.stageTicks += 1;
  const victimUp = victim !== undefined && victim.alive;
  switch (combo.stage) {
    case 'startup':
      place(attacker, combo.fromX, combo.fromY);
      if (victimUp) place(victim, combo.holdX, combo.holdY);
      if (combo.stageTicks >= ticksFor(spec.startupMs)) enter(world, combo, 'dash', attacker);
      return;
    case 'dash': {
      const t = Math.min(1, combo.stageTicks / ticksFor(spec.dashMs));
      // Explosive start, soft arrival: the rush reads as a flash step.
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      place(attacker, combo.fromX + (combo.toX - combo.fromX) * eased, combo.fromY + (combo.toY - combo.fromY) * eased);
      if (victimUp) place(victim, combo.holdX, combo.holdY);
      if (t >= 1) enter(world, combo, victimUp ? 'flurry' : 'recover', attacker);
      return;
    }
    case 'flurry': {
      place(attacker, combo.toX, combo.toY);
      if (!victimUp) {
        enter(world, combo, 'recover', attacker);
        return;
      }
      place(victim, combo.holdX, combo.holdY);
      const interval = ticksFor(spec.hitIntervalMs);
      if ((combo.stageTicks - 1) % interval === 0 && combo.hitsLanded < spec.hits) landBlow(world, combo, victim, false);
      if (combo.stageTicks >= spec.hits * interval) enter(world, combo, 'finisher', attacker);
      return;
    }
    case 'finisher':
      place(attacker, combo.toX, combo.toY);
      if (victimUp) landBlow(world, combo, victim, true);
      enter(world, combo, 'recover', attacker);
      return;
    case 'recover':
      place(attacker, combo.restX, combo.restY);
      if (combo.stageTicks >= ticksFor(spec.recoverMs)) end(world, combo, attacker, victim);
      return;
  }
}
