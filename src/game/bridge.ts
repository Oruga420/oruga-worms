/**
 * The bridge between the mutable sim (SimWorld, worm bodies at 60 Hz) and the immutable match
 * ledger (MatchState, the pure reducer). The sim owns positions and physics; the reducer owns
 * hp, turns, scoring and phase. Each tick the sim emits events; this module turns them into
 * MatchEvents the reducer applies, and syncs worm positions and hp both ways at the phase
 * boundaries the reducer defines. Pure translation: no drawing, no input.
 */

import type { MatchEvent } from '../match/events.ts';
import type { MatchState } from '../match/state.ts';
import type { SimEvent, WormBody } from '../sim/types.ts';
import type { SimWorld } from '../sim/world.ts';

/** Sim damage, drown and activity events become the match events the reducer understands. */
export function translateSimEvents(events: readonly SimEvent[]): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'damage':
        out.push({ type: 'DamageApplied', wormId: event.wormId, amount: event.amount, sourceTeamId: event.sourceTeamId, sourceWormId: event.sourceWormId });
        break;
      case 'drown':
        out.push({ type: 'WormDrowned', wormId: event.wormId });
        break;
      case 'activity':
        out.push({ type: 'ActivityPing', kind: event.kind });
        break;
      case 'crateLanded':
        out.push({ type: 'CrateLanded', crate: event.kind });
        break;
      case 'cratePicked':
        out.push({ type: 'CratePicked', wormId: event.wormId, crate: event.kind });
        break;
      case 'crateDestroyed':
        out.push({ type: 'CrateDestroyed', wasCounted: event.wasCounted });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Copies each match worm's alive and hp state onto its sim body, so a queued death removes the body. */
export function syncMatchToSim(state: MatchState, world: SimWorld): void {
  const byId = new Map<string, WormBody>();
  for (const body of world.worms) byId.set(body.id, body);
  for (const team of state.teams) {
    for (const worm of team.worms) {
      const body = byId.get(worm.id);
      if (body === undefined) continue;
      if (!worm.alive && body.alive) {
        body.alive = false;
        body.motion = 'dead';
      }
    }
  }
}

/** Snapshots the sim body positions back into the match ledger at a phase boundary. */
export function snapshotPositions(state: MatchState, world: SimWorld): MatchState {
  const byId = new Map<string, WormBody>();
  for (const body of world.worms) byId.set(body.id, body);
  return {
    ...state,
    teams: state.teams.map((team) => ({
      ...team,
      worms: team.worms.map((worm) => {
        const body = byId.get(worm.id);
        return body === undefined ? worm : { ...worm, x: Math.round(body.x), y: Math.round(body.y) };
      }),
    })),
  };
}

/** True when the reducer is in a phase where the sim should be stepping (bodies in motion). */
export function isSimPhase(phase: MatchState['phase']): boolean {
  return phase === 'Active' || phase === 'Firing' || phase === 'Retreat' || phase === 'Resolving';
}
