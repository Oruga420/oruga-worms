import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '@/config/game-config.ts';
import { translateSimEvents } from '@/game/bridge.ts';
import { createMatchDeps } from '@/match/deps.ts';
import { findWorm } from '@/match/ledger.ts';
import { reduce } from '@/match/machine.ts';
import { buildInitialState } from '@/match/setup.ts';
import type { MatchState } from '@/match/state.ts';
import { spawnFinal } from '@/sim/techniques/final.ts';
import { addWorm, stepWorld } from '@/sim/world.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld } from './fixture.ts';

describe('Final Explosion sacrifice', () => {
  it('kills its protected caster as a toll while leaving a shielded victim alive', () => {
    const built = buildInitialState({ seed: 1, teams: [
      { name: 'A', colorIndex: 0, controller: 'human', wormNames: ['A'] },
      { name: 'B', colorIndex: 1, controller: 'human', wormNames: ['B'] },
    ], worldSize: { w: 1200, h: 500 }, waterY: 480, startingTeamIndex: 0 }, GAME_CONFIG);
    if (!built.ok) throw new Error(built.error.message);
    const state: MatchState = { ...built.value, teams: built.value.teams.map((team) => ({ ...team, worms: team.worms.map((worm) => ({ ...worm, shieldDurability: 100, immortalityCharges: 3 })) })) };
    const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480 });
    const caster = addWorm(world, { id: 'team-1-worm-1', teamId: 'team-1', x: 100, y: 349 });
    addWorm(world, { id: 'team-2-worm-1', teamId: 'team-2', x: 130, y: 349 });
    const spec = WEAPONS.final_explosion.technique;
    if (spec?.kind !== 'final') throw new Error('Missing final explosion spec');
    spawnFinal(world, { weaponId: 'final_explosion', attacker: caster, spec: { ...spec, chargeMs: 1 } });
    const events = stepWorld(world);
    const deps = createMatchDeps(1, GAME_CONFIG);
    const after = translateSimEvents(events).reduce((current, event) => reduce(current, event, deps), state);
    expect(findWorm(after, caster.id)?.worm.hp).toBe(0);
    expect(findWorm(after, caster.id)?.worm.immortalityCharges).toBe(3);
    expect(findWorm(after, 'team-2-worm-1')?.worm.hp).toBe(100);
    expect(findWorm(after, 'team-2-worm-1')?.worm.shieldDurability).toBe(0);
  });
});
