/**
 * Builds a ready to play game: a procedural island, a match ledger for the given teams, worms
 * spawned on the surface, and a sim world whose bodies mirror the match worms. Returns everything
 * the controller drives. Deterministic given the seed.
 */

import { createRng, mixSeed } from '../core/rng.ts';
import { buildInitialState, type MatchSetup } from '../match/setup.ts';
import { applySpawnPoints, placeWorms, spawnOptions } from '../match/spawn.ts';
import type { MatchState } from '../match/state.ts';
import { createMatchDeps, type MatchDeps } from '../match/deps.ts';
import { createWorld, addWorm, type SimWorld } from '../sim/world.ts';
import { createProcedural, type TerrainData } from '../terrain/terrain.ts';
import type { ContextFactory } from '../terrain/context.ts';
import { computeTops } from '../terrain/generate.ts';
import { BORDER_BEDROCK_PX } from '../terrain/mask.ts';
import { WORM_HEIGHT } from '../sim/constants.ts';
import { GRAVITY_PX_PER_S2 } from '../sim/constants.ts';
import { err, ok, type Result } from '../core/result.ts';

export interface GameSetupOptions {
  readonly setup: MatchSetup;
  readonly createContext: ContextFactory;
  readonly generateSeed?: number;
}

export interface Game {
  readonly state: MatchState;
  readonly world: SimWorld;
  readonly terrain: TerrainData;
  readonly deps: MatchDeps;
}

export interface GameSetupError {
  readonly code: 'setup' | 'terrain' | 'spawn';
  readonly message: string;
}

const SPAWN_SEED_SALT = 0xa17;

export function buildGame(options: GameSetupOptions): Result<Game, GameSetupError> {
  const { setup } = options;
  const size = setup.worldSize;
  const terrainResult = createProcedural(
    { generate: { width: size.w, height: size.h, seed: options.generateSeed ?? setup.seed }, maxAttempts: 12 },
    options.createContext,
  );
  if (!terrainResult.ok) return err({ code: 'terrain', message: terrainResult.error.message });
  const terrain = terrainResult.value.terrain;

  const base = buildInitialState(setup);
  if (!base.ok) return err({ code: 'setup', message: base.error.message });

  const totalWorms = setup.teams.reduce((sum, team) => sum + team.wormNames.length, 0);
  // Skip the top bedrock border (the outer 2 px ring) so the surface is the land, not the ceiling.
  const tops = computeTops(terrain.mask, BORDER_BEDROCK_PX + 1);
  const rng = createRng(mixSeed(setup.seed, SPAWN_SEED_SALT));
  const points = placeWorms(tops, totalWorms, spawnOptions(terrain.water.y), rng);
  if (!points.ok) return err({ code: 'spawn', message: points.error.message });
  const placed = applySpawnPoints(base.value, points.value);
  if (!placed.ok) return err({ code: 'spawn', message: placed.error.message });

  const world = createWorld(terrain, { seed: setup.seed, gravity: GRAVITY_PX_PER_S2 });
  for (const team of placed.value.teams) {
    for (const worm of team.worms) {
      addWorm(world, { id: worm.id, teamId: team.id, x: worm.x, y: worm.y - 1, facing: worm.x < size.w / 2 ? 1 : -1 });
    }
  }

  return ok({ state: placed.value, world, terrain, deps: createMatchDeps(setup.seed) });
}

/** A quick 2 team game (red human, blue cpu) for the first playable and the smoke test. */
export function quickGame(seed: number, createContext: ContextFactory, size = { w: 1920, h: 696 }): Result<Game, GameSetupError> {
  const setup: MatchSetup = {
    seed,
    worldSize: size,
    waterY: size.h - 24,
    startingTeamIndex: 0,
    teams: [
      { name: 'Reds', colorIndex: 0, controller: 'human', wormNames: ['Rojo', 'Rita', 'Rex'] },
      { name: 'Blues', colorIndex: 1, controller: 'cpu', cpu: { difficulty: 'normal', personality: 'aggressive' }, wormNames: ['Azul', 'Ana', 'Ash'] },
    ],
  };
  return buildGame({ setup, createContext });
}

export { WORM_HEIGHT };
