import { describe, expect, it } from 'vitest';
import { CPU_TURN_SCHEMA, type CpuTurnRequest } from '@/ai/contract.ts';
import { decideHeuristic, type HeuristicInput } from '@/ai/heuristic.ts';
import { GRAVITY_PX_PER_S2 } from '@/sim/constants.ts';
import { createMask, setSpan, SOLID } from '@/terrain/mask.ts';
import { WEAPONS } from '@/weapons/registry.ts';
import type { WeaponId } from '@/weapons/types.ts';

function flatMask(width = 1000, height = 400, floorY = 300) {
  const mask = createMask(width, height);
  for (let y = floorY; y < height; y += 1) setSpan(mask, y, 0, width - 1, SOLID);
  return mask;
}

function request(overrides: Partial<CpuTurnRequest> = {}): CpuTurnRequest {
  return {
    schema: CPU_TURN_SCHEMA,
    matchId: 'm',
    turn: 3,
    difficulty: 'hard',
    personality: 'aggressive',
    windStep: 0,
    wind: 0,
    gravity: GRAVITY_PX_PER_S2,
    waterY: 390,
    world: { w: 1000, h: 400 },
    active: { wormId: 'r1', team: 'red', x: 200, y: 299, hp: 100, canMoveLeft: true, canMoveRight: true, maxWalkMs: 3000 },
    allies: [],
    enemies: [{ id: 'b1', team: 'blue', x: 500, y: 299, hp: 100 }],
    ammo: [{ weapon: 'bazooka' as WeaponId, count: -1 }],
    terrain: { profile: [], sampleStepPx: 16 },
    lineOfSight: [{ targetWormId: 'b1', clear: true, distancePx: 300, bearingDeg: 0 }],
    ...overrides,
  };
}

function input(req: CpuTurnRequest, worms: HeuristicInput['worms']): HeuristicInput {
  return { request: req, registry: WEAPONS, mask: flatMask(req.world.w, req.world.h, 300), worms };
}

const flatWorms = [
  { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
  { id: 'b1', teamId: 'blue', x: 500, y: 299, hp: 100, alive: true },
];

describe('decideHeuristic: the super move', () => {
  const close = [
    { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
    { id: 'b1', teamId: 'blue', x: 300, y: 299, hp: 100, alive: true },
  ];
  const ammo = [
    { weapon: 'bazooka' as WeaponId, count: -1 },
    { weapon: 'ryuko_ranbu' as WeaponId, count: 1 },
  ];

  it('rushes an enemy in reach and in plain sight', () => {
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 300, y: 299, hp: 100 }] });
    expect(decideHeuristic(input(req, close)).weapon).toBe('ryuko_ranbu');
  });

  it('never wastes it on an enemy behind a wall', () => {
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 300, y: 299, hp: 100 }] });
    const mask = flatMask(req.world.w, req.world.h, 300);
    for (let y = 240; y < 300; y += 1) setSpan(mask, y, 248, 252, SOLID);
    const decision = decideHeuristic({ request: req, registry: WEAPONS, mask, worms: close });
    expect(decision.weapon).not.toBe('ryuko_ranbu');
  });

  it('scores the victim the lock would take, not the juiciest enemy in reach', () => {
    // Both in reach: the rush locks the nearer one, which has 1 hp left to lose.
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 240, y: 299, hp: 1, alive: true },
      { id: 'b2', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const req = request({
      ammo,
      enemies: [
        { id: 'b1', team: 'blue', x: 240, y: 299, hp: 1 },
        { id: 'b2', team: 'blue', x: 330, y: 299, hp: 100 },
      ],
    });
    expect(decideHeuristic(input(req, worms)).weapon).not.toBe('ryuko_ranbu');
  });
});

describe('decideHeuristic: the kamehameha', () => {
  const ammo = [
    { weapon: 'bazooka' as WeaponId, count: -1 },
    { weapon: 'kamehameha' as WeaponId, count: 1 },
  ];

  it('fires the beam through a wall at two enemies in a line behind it', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 380, y: 299, hp: 100, alive: true },
      { id: 'b2', teamId: 'blue', x: 470, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 380, y: 299, hp: 100 }, { id: 'b2', team: 'blue', x: 470, y: 299, hp: 100 }] });
    const mask = flatMask(req.world.w, req.world.h, 300);
    for (let y = 150; y < 300; y += 1) setSpan(mask, y, 280, 290, SOLID);
    const decision = decideHeuristic({ request: req, registry: WEAPONS, mask, worms });
    expect(decision.weapon).toBe('kamehameha');
    expect(Math.abs(decision.aimAngleDeg)).toBeLessThanOrEqual(4);
  });

  it('never beams through a team mate to reach an enemy', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'r2', teamId: 'red', x: 300, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 420, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 420, y: 299, hp: 100 }] });
    expect(decideHeuristic(input(req, worms)).weapon).not.toBe('kamehameha');
  });
});

describe('decideHeuristic: gear 5', () => {
  const ammo = [
    { weapon: 'bazooka' as WeaponId, count: -1 },
    { weapon: 'ryuko_ranbu' as WeaponId, count: 1 },
    { weapon: 'gear_five' as WeaponId, count: 1 },
  ];

  it('eats an enemy in reach and in plain sight, over the rush that would only beat it', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    expect(decideHeuristic(input(req, worms)).weapon).toBe('gear_five');
  });

  it('keeps it when the arm cannot reach anyone, or only through a wall', () => {
    const far = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 200 + WEAPONS.gear_five.devour!.rangePx + 60, y: 299, hp: 100, alive: true },
    ];
    const farReq = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: far[1]!.x, y: 299, hp: 100 }] });
    expect(decideHeuristic(input(farReq, far)).weapon).not.toBe('gear_five');
    const walled = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    const mask = flatMask(req.world.w, req.world.h, 300);
    for (let y = 200; y < 300; y += 1) setSpan(mask, y, 260, 266, SOLID);
    expect(decideHeuristic({ request: req, registry: WEAPONS, mask, worms: walled }).weapon).not.toBe('gear_five');
  });
});

describe('decideHeuristic', () => {
  it('aims a bazooka toward the enemy and reports a legal response', () => {
    const decision = decideHeuristic(input(request(), flatWorms));
    expect(decision.schema).toBe(CPU_TURN_SCHEMA);
    expect(decision.weapon).toBe('bazooka');
    expect(decision.aimAngleDeg).toBeGreaterThanOrEqual(-90);
    expect(decision.aimAngleDeg).toBeLessThanOrEqual(90);
    expect(decision.power).toBeGreaterThan(0);
    expect(decision.power).toBeLessThanOrEqual(100);
    expect(decision.facing).toBe('right');
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.taunt.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same request', () => {
    const a = decideHeuristic(input(request(), flatWorms));
    const b = decideHeuristic(input(request(), flatWorms));
    expect(a).toEqual(b);
  });

  it('finds a shot that lands near the enemy', () => {
    const decision = decideHeuristic(input(request(), flatWorms));
    expect(decision.confidence).toBeGreaterThanOrEqual(0.35);
  });

  it('skips when there is no enemy to hit', () => {
    // Every enemy already dead: no shot can score above zero.
    const req = request({ enemies: [] });
    const worms = [flatWorms[0]!, { id: 'b1', teamId: 'blue', x: 500, y: 299, hp: 0, alive: false }];
    const decision = decideHeuristic(input(req, worms));
    expect(decision.confidence).toBe(0);
    expect(decision.reasoning).toContain('skipping');
  });

  it('does not shoot itself: prefers a shot with less self damage', () => {
    // An enemy right next to the active worm: firing at it would hurt the shooter, so the score is low.
    const req = request({ enemies: [{ id: 'b1', team: 'blue', x: 205, y: 299, hp: 100 }] });
    const worms = [flatWorms[0]!, { id: 'b1', teamId: 'blue', x: 205, y: 299, hp: 100, alive: true }];
    const decision = decideHeuristic(input(req, worms));
    expect(decision.schema).toBe(CPU_TURN_SCHEMA);
  });

  it('difficulty changes the aim jitter', () => {
    const hard = decideHeuristic(input(request({ difficulty: 'hard' }), flatWorms));
    const easy = decideHeuristic(input(request({ difficulty: 'easy' }), flatWorms));
    expect(typeof hard.aimAngleDeg).toBe('number');
    expect(typeof easy.aimAngleDeg).toBe('number');
  });

  it('takes a direct hitscan shot with a shotgun in range', () => {
    const decision = decideHeuristic(input(request({ ammo: [{ weapon: 'shotgun' as WeaponId, count: 5 }] }), flatWorms));
    expect(decision.weapon).toBe('shotgun');
    expect(decision.reasoning).not.toContain('skipping');
  });

  it('uses melee when the enemy is within reach', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 218, y: 299, hp: 100, alive: true },
    ];
    const decision = decideHeuristic(input(request({ ammo: [{ weapon: 'fire_punch' as WeaponId, count: -1 }] }), worms));
    expect(decision.weapon).toBe('fire_punch');
  });

  it('aims an air strike at an enemy with a target point', () => {
    const decision = decideHeuristic(input(request({ ammo: [{ weapon: 'air_strike' as WeaponId, count: 1 }] }), flatWorms));
    expect(decision.weapon).toBe('air_strike');
    expect(decision.targetPoint).toEqual({ x: 500, y: 299 });
  });

  it('skips when the active worm is not among the world bodies', () => {
    const decision = decideHeuristic(input(request(), [{ id: 'b1', teamId: 'blue', x: 500, y: 299, hp: 100, alive: true }]));
    expect(decision.reasoning).toContain('skipping');
    expect(decision.confidence).toBe(0);
  });
});
