/**
 * Boundary validation of the browser's CpuTurnRequest before anything else looks at it
 * (ultraplan rev 2, Security requirements: strict schema on the request, caps on every list).
 * A rejected body never reaches a prompt or a model. Player typed strings are only bounded here;
 * prompt.ts strips them further when it builds the data block.
 */

import {
  CPU_MOVE_MAX_MS,
  CPU_TURN_SCHEMA,
  type CpuDifficulty,
  type CpuPersonality,
  type CpuTurnRequest,
  type CpuWorm,
} from '../src/ai/contract.ts';
import type { WeaponId } from '../src/weapons/types.ts';
import { isWeaponId } from '../src/weapons/registry.ts';
import { err, ok, type Result } from '../src/core/result.ts';

export const LIMITS = Object.freeze({
  maxAllies: 8,
  maxEnemies: 32,
  maxAmmoEntries: 32,
  maxProfileSamples: 256,
  maxLineOfSight: 32,
  maxStringChars: 64,
  maxSummaryChars: 400,
  minWorld: 64,
  maxWorld: 8192,
});

const DIFFICULTIES: ReadonlySet<string> = new Set<CpuDifficulty>(['easy', 'normal', 'hard']);
const PERSONALITIES: ReadonlySet<string> = new Set<CpuPersonality>(['aggressive', 'cautious', 'chaotic', 'sniper']);

type Rec = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, field: string): Result<number, string> {
  return typeof value === 'number' && Number.isFinite(value) ? ok(value) : err(`${field} must be a finite number`);
}

function text(value: unknown, field: string, max: number): Result<string, string> {
  if (typeof value !== 'string') return err(`${field} must be a string`);
  if (value.length > max) return err(`${field} is longer than ${max} characters`);
  return ok(value);
}

function list(value: unknown, field: string, max: number): Result<readonly unknown[], string> {
  if (!Array.isArray(value)) return err(`${field} must be an array`);
  if (value.length > max) return err(`${field} has more than ${max} entries`);
  return ok(value);
}

function worm(value: unknown, field: string): Result<CpuWorm, string> {
  if (!isRecord(value)) return err(`${field} must be an object`);
  const id = text(value['id'], `${field}.id`, LIMITS.maxStringChars);
  if (!id.ok) return id;
  const team = text(value['team'], `${field}.team`, LIMITS.maxStringChars);
  if (!team.ok) return team;
  const x = finite(value['x'], `${field}.x`);
  if (!x.ok) return x;
  const y = finite(value['y'], `${field}.y`);
  if (!y.ok) return y;
  const hp = finite(value['hp'], `${field}.hp`);
  if (!hp.ok) return hp;
  return ok({ id: id.value, team: team.value, x: x.value, y: y.value, hp: hp.value });
}

function worms(value: unknown, field: string, max: number): Result<readonly CpuWorm[], string> {
  const items = list(value, field, max);
  if (!items.ok) return items;
  const out: CpuWorm[] = [];
  for (const [i, item] of items.value.entries()) {
    const w = worm(item, `${field}[${i}]`);
    if (!w.ok) return w;
    out.push(w.value);
  }
  return ok(out);
}

function active(value: unknown): Result<CpuTurnRequest['active'], string> {
  const base = worm(isRecord(value) ? { ...value, id: value['wormId'] } : value, 'active');
  if (!base.ok) return base;
  const rec = value as Rec;
  if (typeof rec['canMoveLeft'] !== 'boolean' || typeof rec['canMoveRight'] !== 'boolean') {
    return err('active.canMoveLeft and active.canMoveRight must be booleans');
  }
  // Optional so requests from before the movement budget still validate; absent means the full
  // contract cap. Present, it must be a whole number of ms inside [0, CPU_MOVE_MAX_MS].
  const rawWalk = rec['maxWalkMs'];
  let maxWalkMs = CPU_MOVE_MAX_MS;
  if (rawWalk !== undefined) {
    if (typeof rawWalk !== 'number' || !Number.isInteger(rawWalk) || rawWalk < 0 || rawWalk > CPU_MOVE_MAX_MS) {
      return err(`active.maxWalkMs must be an integer in [0, ${CPU_MOVE_MAX_MS}]`);
    }
    maxWalkMs = rawWalk;
  }
  return ok({
    wormId: base.value.id,
    team: base.value.team,
    x: base.value.x,
    y: base.value.y,
    hp: base.value.hp,
    canMoveLeft: rec['canMoveLeft'],
    canMoveRight: rec['canMoveRight'],
    maxWalkMs,
  });
}

function ammo(value: unknown): Result<CpuTurnRequest['ammo'], string> {
  const items = list(value, 'ammo', LIMITS.maxAmmoEntries);
  if (!items.ok) return items;
  const out: { weapon: WeaponId; count: number }[] = [];
  for (const [i, item] of items.value.entries()) {
    if (!isRecord(item)) return err(`ammo[${i}] must be an object`);
    const weapon = text(item['weapon'], `ammo[${i}].weapon`, LIMITS.maxStringChars);
    if (!weapon.ok) return weapon;
    // Constrain to a known weapon id: this is the one untrusted field that reaches the model prompt,
    // so a free string here is a prompt injection surface. An id that passes can only be a real id.
    if (!isWeaponId(weapon.value)) return err(`ammo[${i}].weapon is not a known weapon id`);
    const count = finite(item['count'], `ammo[${i}].count`);
    if (!count.ok) return count;
    if (!Number.isInteger(count.value) || count.value < -1) return err(`ammo[${i}].count must be -1 or a non negative integer`);
    out.push({ weapon: weapon.value, count: count.value });
  }
  return ok(out);
}

function terrain(value: unknown): Result<CpuTurnRequest['terrain'], string> {
  if (!isRecord(value)) return err('terrain must be an object');
  const profile = list(value['profile'], 'terrain.profile', LIMITS.maxProfileSamples);
  if (!profile.ok) return profile;
  const samples: number[] = [];
  for (const [i, sample] of profile.value.entries()) {
    const n = finite(sample, `terrain.profile[${i}]`);
    if (!n.ok) return n;
    samples.push(n.value);
  }
  const step = finite(value['sampleStepPx'], 'terrain.sampleStepPx');
  if (!step.ok) return step;
  if (step.value <= 0) return err('terrain.sampleStepPx must be positive');
  return ok({ profile: samples, sampleStepPx: step.value });
}

function lineOfSight(value: unknown): Result<CpuTurnRequest['lineOfSight'], string> {
  const items = list(value, 'lineOfSight', LIMITS.maxLineOfSight);
  if (!items.ok) return items;
  const out: { targetWormId: string; clear: boolean; distancePx: number; bearingDeg: number }[] = [];
  for (const [i, item] of items.value.entries()) {
    if (!isRecord(item)) return err(`lineOfSight[${i}] must be an object`);
    const target = text(item['targetWormId'], `lineOfSight[${i}].targetWormId`, LIMITS.maxStringChars);
    if (!target.ok) return target;
    if (typeof item['clear'] !== 'boolean') return err(`lineOfSight[${i}].clear must be a boolean`);
    const distance = finite(item['distancePx'], `lineOfSight[${i}].distancePx`);
    if (!distance.ok) return distance;
    const bearing = finite(item['bearingDeg'], `lineOfSight[${i}].bearingDeg`);
    if (!bearing.ok) return bearing;
    out.push({ targetWormId: target.value, clear: item['clear'], distancePx: distance.value, bearingDeg: bearing.value });
  }
  return ok(out);
}

function world(value: unknown): Result<CpuTurnRequest['world'], string> {
  if (!isRecord(value)) return err('world must be an object');
  const w = finite(value['w'], 'world.w');
  if (!w.ok) return w;
  const h = finite(value['h'], 'world.h');
  if (!h.ok) return h;
  const inRange = (n: number): boolean => n >= LIMITS.minWorld && n <= LIMITS.maxWorld;
  if (!inRange(w.value) || !inRange(h.value)) return err(`world size must be between ${LIMITS.minWorld} and ${LIMITS.maxWorld}`);
  return ok({ w: w.value, h: h.value });
}

/** Validates an unknown body into a CpuTurnRequest, or explains the first problem found. */
export function validateCpuTurnRequest(body: unknown): Result<CpuTurnRequest, string> {
  if (!isRecord(body)) return err('body must be a JSON object');
  if (body['schema'] !== CPU_TURN_SCHEMA) return err(`schema must be ${CPU_TURN_SCHEMA}`);
  const matchId = text(body['matchId'], 'matchId', LIMITS.maxStringChars);
  if (!matchId.ok) return matchId;
  const turn = finite(body['turn'], 'turn');
  if (!turn.ok) return turn;
  if (!Number.isInteger(turn.value) || turn.value < 0) return err('turn must be a non negative integer');
  const difficulty = body['difficulty'];
  if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty)) return err('difficulty is not valid');
  const personality = body['personality'];
  if (typeof personality !== 'string' || !PERSONALITIES.has(personality)) return err('personality is not valid');
  const windStep = finite(body['windStep'], 'windStep');
  if (!windStep.ok) return windStep;
  if (!Number.isInteger(windStep.value) || windStep.value < -10 || windStep.value > 10) return err('windStep must be an integer from -10 to 10');
  const wind = finite(body['wind'], 'wind');
  if (!wind.ok) return wind;
  if (wind.value < -1 || wind.value > 1) return err('wind must be between -1 and 1');
  const gravity = finite(body['gravity'], 'gravity');
  if (!gravity.ok) return gravity;
  const waterY = finite(body['waterY'], 'waterY');
  if (!waterY.ok) return waterY;
  const size = world(body['world']);
  if (!size.ok) return size;
  const act = active(body['active']);
  if (!act.ok) return act;
  const allies = worms(body['allies'], 'allies', LIMITS.maxAllies);
  if (!allies.ok) return allies;
  const enemies = worms(body['enemies'], 'enemies', LIMITS.maxEnemies);
  if (!enemies.ok) return enemies;
  const ammoList = ammo(body['ammo']);
  if (!ammoList.ok) return ammoList;
  const terr = terrain(body['terrain']);
  if (!terr.ok) return terr;
  const los = lineOfSight(body['lineOfSight']);
  if (!los.ok) return los;
  let summary: string | undefined;
  if (body['lastTurnSummary'] !== undefined) {
    const s = text(body['lastTurnSummary'], 'lastTurnSummary', LIMITS.maxSummaryChars);
    if (!s.ok) return s;
    summary = s.value;
  }
  return ok({
    schema: CPU_TURN_SCHEMA,
    matchId: matchId.value,
    turn: turn.value,
    difficulty: difficulty as CpuDifficulty,
    personality: personality as CpuPersonality,
    windStep: windStep.value,
    wind: wind.value,
    gravity: gravity.value,
    waterY: waterY.value,
    world: size.value,
    active: act.value,
    allies: allies.value,
    enemies: enemies.value,
    ammo: ammoList.value,
    terrain: terr.value,
    lineOfSight: los.value,
    ...(summary === undefined ? {} : { lastTurnSummary: summary }),
  });
}
