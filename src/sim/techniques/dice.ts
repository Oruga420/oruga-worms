/**
 * The Santoryu in the sim (Roronoa Zoro's three sword style): a timeline the world steps once per
 * tick. The worm draws its three swords, one in its mouth, and slashes the square of the world in
 * front of it along its aim, again and again; the cuts hang in the air for a breath, then it all
 * lands at once: the land in the square falls apart into cubes and is gone, and every worm in the
 * square is cut and thrown.
 *
 * The square is axis aligned, its centre reachPx from the worm's middle along the aim, so the worm
 * can cut ahead, overhead or the ground under its own feet; the worm itself is never cut. Bedrock
 * is not cut either. The cubes are worked out from the land before it goes, for the presentation.
 *
 * The swordsman is HELD until the cut lands. Damage is emitted, never applied.
 */

import { degToRad } from '../../core/math.ts';
import { cutRect } from '../../terrain/terrain.ts';
import { SOLID } from '../../terrain/mask.ts';
import { wormMiddleY } from '../worm-size.ts';
import type { DiceBody, DiceCell, DiceStage, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';
import type { DiceSpec } from '../../weapons/types.ts';
import { beat, enter, finished, place, release, sound, started, ticksFor, wormById } from './common.ts';

/** Cues of the Santoryu; the call is a voice line the mixer skips until it is generated. */
export const DICE_SOUNDS = Object.freeze({
  draw: 'wpn_shotgun_cock',
  call: 'voice_super_santoryu',
  slash: 'wpn_firepunch_whoosh',
  cut: 'wpn_bat_crack',
  crumble: 'exp_medium_1',
});

/** A cube is kept when at least this share of it was land. */
export const CUBE_FILL = 0.3;

/** The square a worm standing at (x, y) cuts aiming at angleDeg, world px: its top left corner and side. */
export function diceSquare(spec: DiceSpec, worm: { readonly x: number; readonly y: number; readonly size?: number }, facing: 1 | -1, angleDeg: number): { readonly x: number; readonly y: number; readonly side: number } {
  const a = degToRad(angleDeg);
  const cx = worm.x + Math.cos(a) * facing * spec.reachPx;
  const cy = wormMiddleY(worm) - Math.sin(a) * spec.reachPx;
  return { x: Math.round(cx - spec.sizePx / 2), y: Math.round(cy - spec.sizePx / 2), side: spec.sizePx };
}

/** The cubes the land in a square falls apart into: every cell of cubePx that was land enough. */
export function diceCells(world: SimWorld, x: number, y: number, side: number, cubePx: number): DiceCell[] {
  const mask = world.terrain.mask;
  const cells: DiceCell[] = [];
  for (let cy = y; cy < y + side; cy += cubePx) {
    for (let cx = x; cx < x + side; cx += cubePx) {
      let land = 0;
      let all = 0;
      for (let py = cy; py < Math.min(cy + cubePx, y + side); py += 1) {
        for (let px = cx; px < Math.min(cx + cubePx, x + side); px += 1) {
          all += 1;
          if (px >= 0 && py >= 0 && px < mask.width && py < mask.height && mask.data[py * mask.width + px] === SOLID) land += 1;
        }
      }
      if (all === 0 || land / all < CUBE_FILL) continue;
      const mid = Math.floor(cx + cubePx / 2);
      const above = cy - 1;
      const surface = above < 0 || mid < 0 || mid >= mask.width || mask.data[above * mask.width + mid] !== SOLID;
      cells.push({ x: cx, y: cy, size: cubePx, surface });
    }
  }
  return cells;
}

export interface SpawnDiceParams {
  readonly weaponId: string;
  readonly attacker: WormBody;
  readonly spec: DiceSpec;
  readonly facing: 1 | -1;
  readonly angleDeg: number;
}

export function spawnDice(world: SimWorld, params: SpawnDiceParams): DiceBody {
  const { attacker, spec, facing } = params;
  attacker.facing = facing;
  const square = diceSquare(spec, attacker, facing, params.angleDeg);
  const body: DiceBody = {
    id: world.nextId(),
    kind: 'dice',
    weaponId: params.weaponId,
    attackerId: attacker.id,
    ownerTeamId: attacker.teamId,
    spec,
    stage: 'draw',
    stageTicks: 0,
    holdX: attacker.x,
    holdY: attacker.y,
    facing,
    squareX: square.x,
    squareY: square.y,
    side: square.side,
    slashes: 0,
    cut: false,
    caught: [],
    alive: true,
  };
  world.techniques.push(body);
  started(world, body, attacker.x, attacker.y);
  beat(world, body, 'draw', 0, attacker.x, attacker.y);
  sound(world, DICE_SOUNDS.draw, attacker.x, attacker.y);
  sound(world, DICE_SOUNDS.call, attacker.x, attacker.y);
  return body;
}

export function diceHolds(body: DiceBody, out: Set<string>): void {
  if (body.stage !== 'recover') out.add(body.attackerId);
}

/** The slashes, then one interval more of the cuts hanging in the air before they land. */
function slashStage(spec: DiceSpec): number {
  return (spec.slashes + 1) * ticksFor(spec.slashIntervalMs);
}

export function diceStageLength(body: DiceBody): number {
  const spec = body.spec;
  const lengths: Readonly<Record<DiceStage, number>> = {
    draw: ticksFor(spec.drawMs),
    slash: slashStage(spec),
    recover: ticksFor(spec.recoverMs),
  };
  return lengths[body.stage];
}

export function diceTicks(spec: DiceSpec): number {
  return ticksFor(spec.drawMs) + slashStage(spec) + ticksFor(spec.recoverMs);
}

export function cancelDice(world: SimWorld, body: DiceBody): void {
  if (body.stage !== 'recover') release(wormById(world, body.attackerId));
  finished(world, body, body.cut);
}

/** The cut lands: the land in the square is gone in cubes, and every worm in it is cut and thrown. */
function cut(world: SimWorld, body: DiceBody, attacker: WormBody): void {
  const spec = body.spec;
  body.cut = true;
  enter(body, 'recover');
  release(attacker);
  const x0 = body.squareX;
  const y0 = body.squareY;
  const x1 = x0 + body.side;
  const y1 = y0 + body.side;
  const cells = diceCells(world, x0, y0, body.side, spec.cubePx);
  const removed = cutRect(world.terrain, x0, y0, body.side, body.side);
  if (removed.spans.length > 0) world.events.push({ type: 'activity', kind: 'carve' });
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  for (const worm of world.worms) {
    if (!worm.alive || worm.id === body.attackerId || worm.motion === 'drowning') continue;
    const middle = wormMiddleY(worm);
    if (worm.x < x0 - 2 || worm.x > x1 + 2 || middle < y0 - 2 || middle > y1 + 2) continue;
    body.caught.push(worm.id);
    // Thrown away from the middle of the square, and up.
    const away = worm.x === cx ? body.facing : Math.sign(worm.x - cx);
    world.events.push({ type: 'damage', wormId: worm.id, amount: spec.damage, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, cause: 'melee', at: { x: worm.x, y: middle, dx: away * 0.7, dy: -0.7 } });
    worm.vx = away * spec.push;
    worm.vy = -spec.lift;
    worm.motion = 'flying';
    worm.onGround = false;
    worm.restTicks = 0;
    worm.exemptNextLanding = true;
  }
  beat(world, body, 'cut', body.caught.length, cx, cy, cells);
  sound(world, DICE_SOUNDS.cut, cx, cy);
  sound(world, DICE_SOUNDS.crumble, cx, cy);
}

/** One tick of the Santoryu. Runs after the worm controller, so the placement here is final. */
export function stepDice(world: SimWorld, body: DiceBody): void {
  const attacker = wormById(world, body.attackerId);
  if (attacker === undefined || !attacker.alive) {
    cancelDice(world, body);
    return;
  }
  const spec = body.spec;
  body.stageTicks += 1;
  if (body.stage !== 'recover') place(attacker, body.holdX, body.holdY);
  switch (body.stage) {
    case 'draw':
      if (body.stageTicks >= ticksFor(spec.drawMs)) enter(body, 'slash');
      return;
    case 'slash': {
      const every = ticksFor(spec.slashIntervalMs);
      if (body.slashes < spec.slashes && body.stageTicks % every === 1 % every) {
        body.slashes += 1;
        beat(world, body, 'slash', body.slashes, body.squareX + body.side / 2, body.squareY + body.side / 2);
        sound(world, DICE_SOUNDS.slash, body.squareX + body.side / 2, body.squareY + body.side / 2);
      }
      if (body.stageTicks >= slashStage(spec)) cut(world, body, attacker);
      return;
    }
    case 'recover':
      if (body.stageTicks >= ticksFor(spec.recoverMs)) finished(world, body, body.cut);
      return;
  }
}
