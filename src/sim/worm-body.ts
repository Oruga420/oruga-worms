/**
 * A worm body entering the world: at the start of a match (game/setup.ts) or in the middle of one,
 * a Saibaman out of the ground (sim/sprout.ts). Its own module so the sim modules that add worms
 * need not import the world's stepping, which imports them.
 */

import type { WormBody } from './types.ts';

export interface AddWormParams {
  readonly id: string;
  readonly teamId: string;
  readonly x: number;
  readonly y: number;
  readonly facing?: 1 | -1;
  /** 1 for a worm (the default), 0.5 for a Saibaman. */
  readonly size?: number;
}

export function addWorm(world: { readonly worms: WormBody[] }, params: AddWormParams): WormBody {
  const worm: WormBody = {
    id: params.id,
    teamId: params.teamId,
    size: params.size ?? 1,
    x: params.x,
    y: params.y,
    vx: 0,
    vy: 0,
    facing: params.facing ?? 1,
    motion: 'idle',
    onGround: true,
    fallStartY: params.y,
    exemptNextLanding: false,
    restTicks: 0,
    alive: true,
    fuelMs: 0,
    drownTicks: 0,
  };
  world.worms.push(worm);
  return worm;
}
