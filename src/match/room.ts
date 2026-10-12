/**
 * ROOM (Trafalgar Law), a pure match layer helper (architecture.md): the sim never computes any of
 * this, it only reports the caster and the raw aim angle at the moment of firing (sim/types.ts
 * 'roomCast'). Everything else lives here, so the reducer and the AI's evaluator share one exact
 * implementation (ai/technique-eval.ts imports the same functions).
 *
 * The region is 1 to 99 percent of the map's STATIC area (world.w * world.h), never remaining
 * terrain, turned into a radius centred on the caster. Every living worm inside it, the caster
 * included, is sorted by id and cyclically given the next one's hp, all read from one snapshot taken
 * before any of it is written, so the permutation never sees an already swapped value. Statuses
 * (frozen turns, a shield, immortality charges) stay on the worm they belong to: only hp moves. The
 * caster then pays a share of what it had BEFORE the cast, capped so it never drops below 1 hp after
 * the swap, and that cost is never handed to anyone else: it is simply spent.
 */

import type { Size } from '../config/constants.ts';
import { appendLog, findWorm, replaceWorm, resetInactivity } from './ledger.ts';
import type { MatchState } from './state.ts';

export const ROOM_MIN_PCT = 1;
export const ROOM_MAX_PCT = 99;

export interface RoomPreview {
  readonly coveragePct: number;
  readonly radiusPx: number;
}

/**
 * ROOM reads the same aim elevation Up/Down and the touch arrows already steer (-90..90) as a
 * percent of the map, 1 at the bottom of the range to 99 at the top: no new input of its own.
 */
export function coveragePctFromAngle(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return ROOM_MIN_PCT;
  const clamped = Math.max(-90, Math.min(90, angleDeg));
  const pct = Math.round(((clamped + 90) / 180) * (ROOM_MAX_PCT - ROOM_MIN_PCT)) + ROOM_MIN_PCT;
  return Math.max(ROOM_MIN_PCT, Math.min(ROOM_MAX_PCT, pct));
}

interface RoomCenter { readonly x: number; readonly y: number }
const RADIUS_STEPS = 40;

/** Area of the disk inside a rectangle extending from its centre to (x,y). */
function diskPrimitive(x: number, y: number, radius: number): number {
  const a = Math.min(radius, Math.abs(x));
  const b = Math.min(radius, Math.abs(y));
  const crossing = Math.sqrt(Math.max(0, radius * radius - b * b));
  if (a <= crossing) return Math.sign(x) * Math.sign(y) * a * b;
  const integral = (t: number): number => 0.5 * (t * Math.sqrt(Math.max(0, radius * radius - t * t)) + radius * radius * Math.asin(Math.min(1, t / radius)));
  return Math.sign(x) * Math.sign(y) * (b * crossing + integral(a) - integral(crossing));
}

/** Exact circle/rectangle intersection, including clipped circles centred at an edge or corner. */
export function circleMapArea(radius: number, world: Size, center: RoomCenter): number {
  if (![radius, world.w, world.h, center.x, center.y].every(Number.isFinite) || radius <= 0 || world.w <= 0 || world.h <= 0) return 0;
  const left = -center.x;
  const top = -center.y;
  const right = world.w - center.x;
  const bottom = world.h - center.y;
  const area = diskPrimitive(right, bottom, radius) - diskPrimitive(left, bottom, radius)
    - diskPrimitive(right, top, radius) + diskPrimitive(left, top, radius);
  return Math.max(0, Math.min(world.w * world.h, area));
}

/** Solve a share of the STATIC map rectangle, not the unbounded circle's area. */
export function roomRadiusPx(coveragePct: number, world: Size, center: RoomCenter = { x: world.w / 2, y: world.h / 2 }): number {
  if (![coveragePct, world.w, world.h, center.x, center.y].every(Number.isFinite) || world.w <= 0 || world.h <= 0) return 0;
  const pct = Math.max(ROOM_MIN_PCT, Math.min(ROOM_MAX_PCT, coveragePct));
  const target = (pct / 100) * world.w * world.h;
  let low = 0;
  let high = Math.hypot(Math.max(Math.abs(center.x), Math.abs(world.w - center.x)), Math.max(Math.abs(center.y), Math.abs(world.h - center.y)));
  for (let i = 0; i < RADIUS_STEPS; i += 1) {
    const middle = (low + high) / 2;
    if (circleMapArea(middle, world, center) < target) low = middle;
    else high = middle;
  }
  return high;
}

/** The renderer, reducer and CPU must pass the same caster centre. */
export function roomPreview(angleDeg: number, world: Size, center?: RoomCenter): RoomPreview {
  const coveragePct = coveragePctFromAngle(angleDeg);
  return Object.freeze({ coveragePct, radiusPx: roomRadiusPx(coveragePct, world, center) });
}

export interface RoomParticipant {
  readonly id: string;
  readonly hp: number;
}

/** Every living worm within radiusPx of (cx, cy), the caster included, sorted by id for a deterministic cycle. */
export function roomParticipants(state: MatchState, cx: number, cy: number, radiusPx: number): readonly RoomParticipant[] {
  const out: RoomParticipant[] = [];
  for (const team of state.teams) {
    for (const worm of team.worms) {
      if (!worm.alive || worm.hp <= 0) continue;
      if (Math.hypot(worm.x - cx, worm.y - cy) > radiusPx) continue;
      out.push({ id: worm.id, hp: worm.hp });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Participant i gets what participant i - 1 had, wrapping, all from one snapshot. */
export function cyclicExchange(participants: readonly RoomParticipant[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  participants.forEach((participant, index) => {
    const giver = participants[(index - 1 + participants.length) % participants.length];
    if (giver !== undefined) out.set(participant.id, giver.hp);
  });
  return out;
}

/** What the cast costs the caster: a share of what it had before, never enough to take it below 1 hp after the swap. */
export function roomCost(preCastHp: number, coveragePct: number, postSwapHp: number): number {
  const requested = Math.max(0, Math.ceil((preCastHp * coveragePct) / 100));
  return Math.max(0, Math.min(requested, postSwapHp - 1));
}

/**
 * The reducer's entry point: validates the coverage, finds the caster, resolves the exchange and
 * charges the cost. An invalid or nonfinite coverage, or a caster no longer standing, changes
 * nothing; a caster alone in its own region (nobody else inside it) still pays nothing, since there
 * is nobody to cycle with.
 */
export function applyRoomExchange(state: MatchState, casterId: string, coveragePct: number): MatchState {
  if (!Number.isFinite(coveragePct) || coveragePct < ROOM_MIN_PCT || coveragePct > ROOM_MAX_PCT) return state;
  const caster = findWorm(state, casterId);
  if (caster === null || !caster.worm.alive || caster.worm.hp <= 0) return state;
  const radiusPx = roomRadiusPx(coveragePct, state.world, caster.worm);
  const participants = roomParticipants(state, caster.worm.x, caster.worm.y, radiusPx);
  if (participants.length <= 1) return state;
  const preCastHp = caster.worm.hp;
  const exchanged = cyclicExchange(participants);
  let next = state;
  for (const participant of participants) {
    const hp = exchanged.get(participant.id);
    if (hp === undefined) continue;
    const ref = findWorm(next, participant.id);
    if (ref === null) continue;
    next = replaceWorm(next, ref.teamIndex, ref.wormIndex, { ...ref.worm, hp });
  }
  const casterRef = findWorm(next, casterId);
  if (casterRef === null) return next;
  const cost = roomCost(preCastHp, coveragePct, casterRef.worm.hp);
  const charged = cost > 0 ? replaceWorm(next, casterRef.teamIndex, casterRef.wormIndex, { ...casterRef.worm, hp: casterRef.worm.hp - cost }) : next;
  const text = `${caster.worm.name} opens ROOM over ${coveragePct}% of the map, trading ${participants.length} and paying ${cost}`;
  return appendLog(resetInactivity(charged), 'room.cast', text);
}
