/**
 * Match setup: validates the team sheet (security requirements: 2 to 4 teams, 1 to 8 worms
 * each, names of 1 to 16 printable characters) and builds the first TurnStart state through the
 * same entry function the reducer uses, so setup and play share one code path. The starting
 * team is drawn from the seed (prior-art.md Part B: random starting team, then rotation) unless
 * the sheet pins it.
 *
 * Starting ammo is the Intermediate scheme as reconciled in the ultraplan roster; Phase 2.3
 * replaces DEFAULT_STARTING_AMMO with WeaponDef.ammo from the registry. Worms start unplaced
 * (x 0, y 0): spawn.ts places them once the terrain exists.
 */

import { isValidWorldSize, type Size } from '../config/constants.ts';
import { GAME_CONFIG } from '../config/game-config.ts';
import { err, ok, type Result } from '../core/result.ts';
import { createRng, mixSeed } from '../core/rng.ts';
import { PANEL_WEAPON_IDS, type WeaponId } from '../weapons/types.ts';
import type { MatchConfig } from './deps.ts';
import { deepFreeze } from './immutable.ts';
import { ZERO_TIMERS } from './ledger.ts';
import { enterTurnStart } from './machine-phases.ts';
import { emptyScore } from './scoring.ts';
import {
  makeWindState,
  type CpuTeamSettings,
  type MatchState,
  type TeamColorIndex,
  type TeamController,
  type TeamState,
  type VoiceId,
  type WormState,
} from './state.ts';

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;
export const MIN_WORMS_PER_TEAM = 1;
export const MAX_WORMS_PER_TEAM = 8;
export const NAME_MAX_CHARS = 16;
export const MAX_SEED = 0xffffffff;

/** Salt for the setup stream so it never correlates with the match rng of the same seed. */
const SETUP_SALT = 0x5e7;

const TEAM_COLORS: readonly TeamColorIndex[] = Object.freeze([0, 1, 2, 3]);
const CONTROLLERS: readonly TeamController[] = Object.freeze(['human', 'cpu']);

/** Control, format, line and paragraph separator code points are never printable. */
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export const DEFAULT_VOICE: VoiceId = 'default';
export const DEFAULT_CPU_SETTINGS: CpuTeamSettings = Object.freeze({ difficulty: 'normal', personality: 'cautious' });

/** Intermediate scheme ammo (ultraplan roster); -1 is infinite. Ids missing here start at 0. */
export const DEFAULT_STARTING_AMMO: Readonly<Partial<Record<WeaponId, number>>> = Object.freeze({
  bazooka: -1,
  homing_missile: 1,
  mortar: 5,
  // One of each of the additions so a team can actually try them; crates refill from there.
  tank: 1,
  napalm: 1,
  sonic_blast: 1,
  longbow: 2,
  grenade: -1,
  cluster_bomb: 3,
  banana_bomb: 0,
  holy_hand_grenade: 1,
  handgun: -1,
  shotgun: -1,
  uzi: -1,
  minigun: 0,
  fire_punch: -1,
  baseball_bat: 1,
  dynamite: 1,
  mine: 2,
  sheep: 1,
  air_strike: 1,
  parachute: 2,
  jetpack: 1,
  teleport: 2,
  girder: 3,
  skip_go: -1,
});

export interface TeamSetup {
  readonly name: string;
  readonly colorIndex: TeamColorIndex;
  readonly controller: TeamController;
  readonly cpu?: CpuTeamSettings;
  readonly wormNames: readonly string[];
  readonly voice?: VoiceId;
  /** Per weapon overrides on DEFAULT_STARTING_AMMO. */
  readonly ammo?: Readonly<Partial<Record<WeaponId, number>>>;
}

export interface MatchSetup {
  readonly seed: number;
  readonly teams: readonly TeamSetup[];
  readonly worldSize: Size;
  readonly waterY: number;
  /** Pins the first team instead of drawing it from the seed. */
  readonly startingTeamIndex?: number;
}

export type SetupErrorCode =
  | 'SEED'
  | 'TEAM_COUNT'
  | 'WORM_COUNT'
  | 'TEAM_NAME'
  | 'WORM_NAME'
  | 'COLOR'
  | 'CONTROLLER'
  | 'WORLD'
  | 'WATER'
  | 'STARTING_TEAM';

export interface SetupError {
  readonly code: SetupErrorCode;
  readonly message: string;
  readonly teamIndex?: number;
  readonly wormIndex?: number;
}

export function isPrintableName(name: string): boolean {
  const length = Array.from(name).length;
  return length >= 1 && length <= NAME_MAX_CHARS && name.trim().length > 0 && !FORBIDDEN_CHARS.test(name);
}

function teamError(code: SetupErrorCode, message: string, teamIndex: number, wormIndex?: number): SetupError {
  return wormIndex === undefined ? { code, message, teamIndex } : { code, message, teamIndex, wormIndex };
}

function validateTeam(team: TeamSetup, teamIndex: number, seenColors: ReadonlySet<TeamColorIndex>): SetupError | null {
  if (!isPrintableName(team.name)) {
    return teamError('TEAM_NAME', `team ${teamIndex} name must be 1 to ${NAME_MAX_CHARS} printable characters`, teamIndex);
  }
  if (!TEAM_COLORS.includes(team.colorIndex)) return teamError('COLOR', `team ${teamIndex} color index out of range`, teamIndex);
  if (seenColors.has(team.colorIndex)) return teamError('COLOR', `team ${teamIndex} repeats a color`, teamIndex);
  if (!CONTROLLERS.includes(team.controller)) return teamError('CONTROLLER', `team ${teamIndex} controller unknown`, teamIndex);
  const worms = team.wormNames.length;
  if (worms < MIN_WORMS_PER_TEAM || worms > MAX_WORMS_PER_TEAM) {
    return teamError('WORM_COUNT', `team ${teamIndex} needs ${MIN_WORMS_PER_TEAM} to ${MAX_WORMS_PER_TEAM} worms`, teamIndex);
  }
  const badWorm = team.wormNames.findIndex((name) => !isPrintableName(name));
  if (badWorm >= 0) {
    return teamError('WORM_NAME', `worm ${badWorm} of team ${teamIndex} has an invalid name`, teamIndex, badWorm);
  }
  return null;
}

function validateTeams(teams: readonly TeamSetup[]): SetupError | null {
  if (teams.length < MIN_TEAMS || teams.length > MAX_TEAMS) {
    return { code: 'TEAM_COUNT', message: `a match needs ${MIN_TEAMS} to ${MAX_TEAMS} teams` };
  }
  const seen = new Set<TeamColorIndex>();
  for (let index = 0; index < teams.length; index += 1) {
    const team = teams[index];
    if (team === undefined) continue;
    const error = validateTeam(team, index, seen);
    if (error !== null) return error;
    seen.add(team.colorIndex);
  }
  return null;
}

export function validateSetup(setup: MatchSetup): SetupError | null {
  if (!Number.isInteger(setup.seed) || setup.seed < 0 || setup.seed > MAX_SEED) {
    return { code: 'SEED', message: 'seed must be an integer in 0..2^32-1' };
  }
  const teamsError = validateTeams(setup.teams);
  if (teamsError !== null) return teamsError;
  if (!isValidWorldSize(setup.worldSize)) return { code: 'WORLD', message: 'world size out of bounds' };
  if (!Number.isInteger(setup.waterY) || setup.waterY <= 0 || setup.waterY > setup.worldSize.h) {
    return { code: 'WATER', message: 'waterY must be an integer inside the world height' };
  }
  const start = setup.startingTeamIndex;
  if (start !== undefined && (!Number.isInteger(start) || start < 0 || start >= setup.teams.length)) {
    return { code: 'STARTING_TEAM', message: 'startingTeamIndex must index a team' };
  }
  return null;
}

/** Full ammo table over every weapon id: defaults, then overrides, then 0 for anything missing. */
export function buildAmmoTable(overrides: Readonly<Partial<Record<WeaponId, number>>> = {}): Readonly<Record<WeaponId, number>> {
  const merged: Readonly<Partial<Record<WeaponId, number>>> = { ...DEFAULT_STARTING_AMMO, ...overrides };
  const table: Partial<Record<WeaponId, number>> = {};
  // Only panel weapons carry ammo; cluster children are nested inside their parent def.
  for (const id of PANEL_WEAPON_IDS) table[id] = merged[id] ?? 0;
  // Every id was written above, so the partial is complete.
  return Object.freeze(table) as Readonly<Record<WeaponId, number>>;
}

function buildWorm(teamId: string, name: string, index: number, config: MatchConfig, ammo: TeamSetup['ammo']): WormState {
  return { id: `${teamId}-worm-${index + 1}`, name, hp: config.wormHp, maxHp: config.wormHp, alive: true, x: 0, y: 0, ammo: buildAmmoTable(ammo) };
}

function buildTeam(team: TeamSetup, index: number, config: MatchConfig): TeamState {
  const id = `team-${index + 1}`;
  const base: TeamState = {
    id,
    name: team.name,
    colorIndex: team.colorIndex,
    controller: team.controller,
    worms: team.wormNames.map((name, wormIndex) => buildWorm(id, name, wormIndex, config, team.ammo)),
    activeWormIndex: -1,
    score: emptyScore(),
    voice: team.voice ?? DEFAULT_VOICE,
  };
  const cpu = team.controller === 'cpu' ? (team.cpu ?? DEFAULT_CPU_SETTINGS) : team.cpu;
  return cpu === undefined ? base : { ...base, cpu };
}

export function buildInitialState(setup: MatchSetup, config: MatchConfig = GAME_CONFIG): Result<MatchState, SetupError> {
  const error = validateSetup(setup);
  if (error !== null) return err(error);
  const teams = setup.teams.map((team, index) => buildTeam(team, index, config));
  const rng = createRng(mixSeed(setup.seed, SETUP_SALT));
  const starting = setup.startingTeamIndex ?? rng.nextInt(0, teams.length - 1);
  const beforeStart: MatchState = {
    phase: 'TurnStart',
    seed: setup.seed,
    round: 1,
    turn: 0,
    activeTeamIndex: (starting - 1 + teams.length) % teams.length,
    teams,
    wind: makeWindState(0),
    waterY: setup.waterY,
    suddenDeath: false,
    roundElapsedMs: 0,
    timers: ZERO_TIMERS,
    log: [],
    world: { w: setup.worldSize.w, h: setup.worldSize.h },
    cratesOnMap: 0,
    crateDrop: null,
    turnsSinceCrateDrop: 0,
    pendingDeaths: [],
    lastHitBy: {},
    shot: null,
    settle: null,
  };
  return ok(deepFreeze(enterTurnStart(beforeStart, { config, rng })));
}
