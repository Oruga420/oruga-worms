import { describe, expect, it } from 'vitest';
import { cancelTechniques, heldByTechniques } from '@/sim/technique.ts';
import { KILL_DAMAGE } from '@/sim/techniques/common.ts';
import type { SimEvent, TechniqueBeat } from '@/sim/types.ts';
import { addWorm, stepWorld, type SimWorld } from '@/sim/world.ts';
import { fire } from '@/weapons/fire.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import { flatWorld, type FlatWorldOptions } from './fixture.ts';

function arena(options: Partial<FlatWorldOptions> = {}) {
  const world = flatWorld({ width: 1200, height: 500, floorY: 350, waterY: 480, ...options });
  const hero = addWorm(world, { id: 'hero', teamId: 'a', x: 300, y: 349, facing: 1 });
  return { world, hero };
}

/** Steps until no technique is left (or a cap), returning every event on the way. */
function playOut(world: SimWorld, cap = 3000): SimEvent[] {
  const events: SimEvent[] = [...world.events.splice(0)];
  for (let i = 0; i < cap && world.techniques.length > 0; i += 1) events.push(...stepWorld(world));
  return events;
}

function beats(events: readonly SimEvent[]): TechniqueBeat[] {
  return events.flatMap((e) => (e.type === 'techniqueBeat' ? [e.beat] : []));
}

function damageTo(events: readonly SimEvent[], wormId: string): number[] {
  return events.flatMap((e) => (e.type === 'damage' && e.wormId === wormId ? [e.amount] : []));
}

describe('time_stop', () => {
  const TIME_STOP = WEAPONS.time_stop;
  const SPEC = TIME_STOP.technique!.kind === 'time_stop' ? TIME_STOP.technique! : null;

  it('is a technique row, one per worm, open from the second turn, never in a crate', () => {
    expect(TIME_STOP.category).toBe('anime');
    expect(TIME_STOP.ammo).toBe(1);
    expect(TIME_STOP.crateWeight).toBe(0);
    expect(TIME_STOP.delayTurns).toBe(2);
  });

  it('holds the caster through the charge, then hands the freeze to the match layer and lets go', () => {
    const { world, hero } = arena();
    const result = fire(world, hero, TIME_STOP, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['hero']));
    const events = playOut(world);
    expect(beats(events)).toEqual(['freeze']);
    const freeze = events.find((e) => e.type === 'freeze');
    expect(freeze).toMatchObject({ casterId: 'hero', turns: SPEC?.freezeTurns });
    expect(events.find((e) => e.type === 'techniqueEnd')).toMatchObject({ kind: 'time_stop', landed: true });
    expect(heldByTechniques(world.techniques).size).toBe(0);
  });

  it('cancels clean mid charge (a surrender) and lets the caster go without a freeze', () => {
    const { world, hero } = arena();
    fire(world, hero, TIME_STOP, { angleDeg: 0, power: 1 });
    stepWorld(world);
    world.events.splice(0);
    cancelTechniques(world);
    expect(world.events.some((e) => e.type === 'freeze')).toBe(false);
    expect(world.events.find((e) => e.type === 'techniqueEnd')).toMatchObject({ landed: false });
    expect(world.techniques).toHaveLength(0);
  });
});

describe('force_field', () => {
  const FORCE_FIELD = WEAPONS.force_field;
  const SPEC = FORCE_FIELD.technique!.kind === 'force_field' ? FORCE_FIELD.technique! : null;

  it('holds the caster through the charge, then hands the shield to the match layer and lets go', () => {
    const { world, hero } = arena();
    const result = fire(world, hero, FORCE_FIELD, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['hero']));
    const events = playOut(world);
    expect(beats(events)).toEqual(['shield']);
    const shield = events.find((e) => e.type === 'shield');
    expect(shield).toMatchObject({ casterId: 'hero', durability: SPEC?.durability, ownTurns: SPEC?.ownTurns });
    expect(events.find((e) => e.type === 'techniqueEnd')).toMatchObject({ kind: 'force_field', landed: true });
  });
});

describe('adamantium_claws', () => {
  const CLAWS = WEAPONS.adamantium_claws;
  const SPEC = CLAWS.technique!.kind === 'claws' ? CLAWS.technique! : null;

  it('strikes the first worm on the aim, in range and before a wall: a one hit kill, like Antares', () => {
    const { world, hero } = arena();
    addWorm(world, { id: 'enemy', teamId: 'b', x: 350, y: 349 });
    const result = fire(world, hero, CLAWS, { angleDeg: 0, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['hero', 'enemy']));
    const events = playOut(world);
    expect(beats(events)).toEqual(['slash']);
    expect(damageTo(events, 'enemy')).toEqual([KILL_DAMAGE]);
    const blow = events.find((e) => e.type === 'damage' && e.wormId === 'enemy');
    expect(blow).toMatchObject({ sourceTeamId: 'a', sourceWormId: 'hero', cause: 'hit' });
    expect(events.find((e) => e.type === 'techniqueEnd')).toMatchObject({ landed: true, victimId: 'enemy' });
    expect(hero.x).toBe(300);
  });

  it('swipes at the air when nobody is in reach: no damage, the turn still spent', () => {
    const { world, hero } = arena();
    expect(SPEC).not.toBeNull();
    if (SPEC === null) return;
    addWorm(world, { id: 'enemy', teamId: 'b', x: 300 + SPEC.rangePx + 80, y: 349 });
    fire(world, hero, CLAWS, { angleDeg: 0, power: 1 });
    const events = playOut(world);
    expect(beats(events)).toEqual(['miss']);
    expect(damageTo(events, 'enemy')).toEqual([]);
    expect(events.find((e) => e.type === 'techniqueEnd')).toMatchObject({ landed: false, victimId: null });
  });

  it('never reaches past a wall, even with an enemy right behind it', () => {
    const { world, hero } = arena({ wall: { x: 340, height: 40, width: 6 } });
    addWorm(world, { id: 'enemy', teamId: 'b', x: 350, y: 349 });
    fire(world, hero, CLAWS, { angleDeg: 0, power: 1 });
    const events = playOut(world);
    expect(beats(events)).toEqual(['miss']);
  });
});

describe('ROOM', () => {
  const ROOM = WEAPONS.room;

  it('holds the caster through the charge, then hands the raw aim angle to the match layer', () => {
    const { world, hero } = arena();
    const result = fire(world, hero, ROOM, { angleDeg: 37, power: 1 });
    expect(result).toMatchObject({ endsTurn: true, sequence: true });
    expect(heldByTechniques(world.techniques)).toEqual(new Set(['hero']));
    const events = playOut(world);
    expect(beats(events)).toEqual(['open']);
    const cast = events.find((e) => e.type === 'roomCast');
    expect(cast).toMatchObject({ casterId: 'hero', angleDeg: 37 });
    expect(events.find((e) => e.type === 'techniqueEnd')).toMatchObject({ kind: 'room', landed: true });
  });

  it('holds the angle fixed through the charge even if the live aim were to change afterward', () => {
    const { world, hero } = arena();
    fire(world, hero, ROOM, { angleDeg: -60, power: 1 });
    const body = world.techniques[0];
    expect(body?.kind).toBe('room');
    const events = playOut(world);
    const cast = events.find((e) => e.type === 'roomCast');
    expect(cast).toMatchObject({ angleDeg: -60 });
  });
});
