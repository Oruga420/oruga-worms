/**
 * What the techniques of the anime row share in the sim (sim/technique.ts steps them all): the stage
 * clock, holding a worm where the technique wants it and handing it back to physics, the first worm
 * along a line, and the events every technique sends: its start, its beats and its end.
 *
 * Mutates the bodies in place (hot path), like the rest of the sim.
 */

import { msToTicks } from '../../config/units.ts';
import { sweep } from '../collision.ts';
import { wormHalfWidth, wormMiddleY } from '../worm-size.ts';
import type { DiceCell, TechniqueBeat, TechniqueBody, WormBody } from '../types.ts';
import type { SimWorld } from '../world.ts';

/** What a one hit kill takes: everything, whatever a health crate added. The ledger stops at 0. */
export const KILL_DAMAGE = 1_000_000;

/** How thick a body thrown from the hands is against the land, world px (flightStop). */
export const THROWN_CORE_PX = 2;

export function ticksFor(ms: number): number {
  return Math.max(1, msToTicks(ms));
}

export function wormById(world: SimWorld, id: string | null): WormBody | undefined {
  if (id === null) return undefined;
  return world.worms.find((w) => w.id === id);
}

/** The worm a technique is aimed at, for the ones that have one. */
export function victimOf(body: TechniqueBody): string | null {
  return body.kind === 'needle' || body.kind === 'treasure' ? body.victimId : null;
}

/** Holds a worm at (x, y): the technique places it every tick, the worm controller leaves it be. */
export function place(worm: WormBody, x: number, y: number): void {
  worm.x = x;
  worm.y = y;
  worm.vx = 0;
  worm.vy = 0;
  worm.restTicks = 0;
  if (worm.motion !== 'dead') worm.motion = 'idle';
}

/** Hands a held worm back to physics: it settles, or falls, from where the technique left it. */
export function release(worm: WormBody | undefined): void {
  if (worm === undefined || !worm.alive) return;
  worm.vx = 0;
  worm.vy = 0;
  worm.motion = 'falling';
  worm.onGround = false;
  worm.restTicks = 0;
  worm.fallStartY = worm.y;
}

export function enter<S extends string>(body: { stage: S; stageTicks: number }, stage: S): void {
  body.stage = stage;
  body.stageTicks = 0;
}

export function sound(world: SimWorld, id: string, x: number, y: number): void {
  world.events.push({ type: 'sound', id, x, y });
}

export function started(world: SimWorld, body: TechniqueBody, x: number, y: number): void {
  const strike = body.kind === 'treasure' && body.mode === 'strike' ? { strike: body.hit } : {};
  world.events.push({ type: 'techniqueStart', techniqueId: body.id, kind: body.kind, weaponId: body.weaponId, attackerId: body.attackerId, victimId: victimOf(body), x, y, facing: body.facing, ...strike });
}

export function beat(world: SimWorld, body: TechniqueBody, kind: TechniqueBeat, n: number, x: number, y: number, cells?: readonly DiceCell[]): void {
  world.events.push({ type: 'techniqueBeat', techniqueId: body.id, kind: body.kind, attackerId: body.attackerId, victimId: victimOf(body), beat: kind, n, x, y, facing: body.facing, ...(cells === undefined ? {} : { cells }) });
}

/** The technique is over: it stops being stepped, and the presentation hears whether it landed. */
export function finished(world: SimWorld, body: TechniqueBody, landed: boolean): void {
  body.alive = false;
  world.events.push({ type: 'techniqueEnd', techniqueId: body.id, kind: body.kind, attackerId: body.attackerId, victimId: victimOf(body), landed });
}

/** A one hit kill: all the worm's health, credited to the technique's team. (x, y) is where it lands. */
export function kill(world: SimWorld, body: TechniqueBody, worm: WormBody, cause: 'blast' | 'hit', dx = 0, dy = -1): void {
  world.events.push({ type: 'damage', wormId: worm.id, amount: KILL_DAMAGE, sourceTeamId: body.ownerTeamId, sourceWormId: body.attackerId, cause, at: { x: worm.x, y: wormMiddleY(worm), dx, dy } });
}

/** A worm along a line: its id, and how far along the line its middle is. */
export interface LineHit {
  readonly worm: WormBody;
  readonly t: number;
}

/**
 * The first living worm, other than `skip`, whose hitbox a line from (x0, y0) along the unit (dx, dy)
 * passes within `pad` of, before `range` px: the way the gun's rays find their mark, so a Saibaman is
 * a smaller target. A worm drowning is out of reach.
 */
export function firstWormOnLine(world: SimWorld, x0: number, y0: number, dx: number, dy: number, range: number, skip: string | null, pad = 2): LineHit | null {
  let best: LineHit | null = null;
  for (const worm of world.worms) {
    if (!worm.alive || worm.id === skip || worm.motion === 'drowning') continue;
    const cx = worm.x;
    const cy = wormMiddleY(worm);
    const t = (cx - x0) * dx + (cy - y0) * dy;
    if (t < 0 || t > range || (best !== null && t >= best.t)) continue;
    if (Math.abs((cx - x0) * dy - (cy - y0) * dx) <= wormHalfWidth(worm) + pad) best = { worm, t };
  }
  return best;
}

/** Where a line from (x0, y0) along the unit (dx, dy) first meets the land within range, or null when it never does. */
export function landOnLine(world: SimWorld, x0: number, y0: number, dx: number, dy: number, range: number, radius = 0): { readonly x: number; readonly y: number; readonly t: number } | null {
  const path = sweep(world.terrain.mask, x0, y0, x0 + dx * range, y0 + dy * range, radius);
  if (path.hit === null) return null;
  return { x: path.x, y: path.y, t: Math.hypot(path.x - x0, path.y - y0) };
}

/**
 * Moves a flying body (a galaxy, a fist of fire, a meteor) from `from` px along its line to `to`,
 * and says where it is stopped first: land (swept with landRadius), a worm it touches (within its
 * radius, other than `skip`), or the water. Null when it flies on. A body thrown from the hands
 * meets the land with a thin core only: swept with its whole radius it went off in the thrower's
 * face on any upward slope.
 */
export function flightStop(world: SimWorld, x0: number, y0: number, dx: number, dy: number, from: number, to: number, radius: number, skip: string | null, landRadius = radius): { readonly x: number; readonly y: number; readonly t: number; readonly worm: WormBody | null } | null {
  const ax = x0 + dx * from;
  const ay = y0 + dy * from;
  const span = to - from;
  const land = span > 0 ? landOnLine(world, ax, ay, dx, dy, span, landRadius) : null;
  const landT = land === null ? Infinity : from + land.t;
  const worm = firstWormOnLine(world, ax, ay, dx, dy, span + radius, skip, radius);
  const wormT = worm === null ? Infinity : from + Math.max(0, worm.t - radius);
  const waterY = world.terrain.water.y;
  const waterT = dy > 0 && y0 + dy * to >= waterY ? Math.max(from, (waterY - y0) / dy) : Infinity;
  const t = Math.min(landT, wormT, waterT);
  if (!Number.isFinite(t) || t > to) return null;
  return { x: x0 + dx * t, y: y0 + dy * t, t, worm: t === wormT && worm !== null ? worm.worm : null };
}
