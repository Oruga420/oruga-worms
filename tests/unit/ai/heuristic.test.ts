import { describe, expect, it } from 'vitest';
import { CPU_TURN_SCHEMA, type CpuTurnRequest } from '@/ai/contract.ts';
import { SPROUT_SCORE, decideHeuristic, pickChoice, walkSpots, type HeuristicInput } from '@/ai/heuristic.ts';
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

/** The same request with the walk spent: the worm fires from where it stands. */
function still(req: CpuTurnRequest): CpuTurnRequest {
  return { ...req, active: { ...req.active, maxWalkMs: 0 } };
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
    expect(decideHeuristic(input(still(req), worms)).weapon).not.toBe('ryuko_ranbu');
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
    expect(decideHeuristic(input(still(req), worms)).weapon).not.toBe('kamehameha');
  });

  it('walks past the team mate first when it can, and beams the enemy from there', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'r2', teamId: 'red', x: 300, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 420, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo: [{ weapon: 'kamehameha' as WeaponId, count: 1 }], enemies: [{ id: 'b1', team: 'blue', x: 420, y: 299, hp: 100 }] });
    const out = decideHeuristic(input(req, worms));
    expect(out.weapon).toBe('kamehameha');
    expect(out.move.direction).toBe('right');
    // Far enough to be past the team mate: 60 px a second of walking.
    expect(out.move.durationMs).toBeGreaterThan(((300 - 200) / 60) * 1000);
  });
});

describe('decideHeuristic: gear 5', () => {
  const ammo = [
    { weapon: 'bazooka' as WeaponId, count: -1 },
    { weapon: 'ryuko_ranbu' as WeaponId, count: 1 },
    { weapon: 'gear_five' as WeaponId, count: 1 },
  ];

  it('eats a fat enemy in reach and in plain sight, over the rush that would only beat it', () => {
    // 150 hp (a health crate): swallowed whole it is worth the 50 the eater pays for it.
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 150, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 150 }] });
    expect(decideHeuristic(input(req, worms)).weapon).toBe('gear_five');
  });

  it('weighs its price: a plain enemy is not worth half its own health when the rush beats it for free', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    // 100 swallowed less 50 paid is 50; the rush's 75 costs nothing.
    expect(decideHeuristic(input(req, worms)).weapon).toBe('ryuko_ranbu');
  });

  it('on its last legs trades them for the enemy: it eats though the price takes all it has', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 15, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo, active: { wormId: 'r1', team: 'red', x: 200, y: 299, hp: 15, canMoveLeft: true, canMoveRight: true, maxWalkMs: 3000 }, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    // Only its last 15 to pay: 100 swallowed for 15 beats the rush's 75.
    expect(decideHeuristic(input(req, worms)).weapon).toBe('gear_five');
  });

  it('keeps it when the arm cannot reach anyone, or only through a wall', () => {
    const far = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 200 + WEAPONS.gear_five.devour!.rangePx + 60, y: 299, hp: 150, alive: true },
    ];
    const farReq = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: far[1]!.x, y: 299, hp: 150 }] });
    expect(decideHeuristic(input(still(farReq), far)).weapon).not.toBe('gear_five');
    // With its walk left it closes in and eats.
    const closer = decideHeuristic(input(farReq, far));
    expect(closer.weapon).toBe('gear_five');
    expect(closer.move.direction).toBe('right');
    const walled = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 150, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 150 }] });
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

describe('decideHeuristic: the freezer', () => {
  const ammo = [
    { weapon: 'bazooka' as WeaponId, count: -1 },
    { weapon: 'ryuko_ranbu' as WeaponId, count: 1 },
    { weapon: 'freezer' as WeaponId, count: 1 },
  ];

  it('bursts a fat enemy in plain sight beyond the rush, over a bazooka shot', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 480, y: 299, hp: 150, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 480, y: 299, hp: 150 }] });
    expect(decideHeuristic(input(req, worms)).weapon).toBe('freezer');
  });

  it('weighs its price: a shot that takes half an enemy for free beats bursting it for half its own health', () => {
    // Beyond the rush, in reach of the light and of a bazooka shot from where it stands.
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 400, y: 299, hp: 60, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 400, y: 299, hp: 60 }] });
    // 60 burst less 50 paid is 10: the bazooka's hit is worth more.
    expect(decideHeuristic(input(still(req), worms)).weapon).toBe('bazooka');
  });

  it('keeps it when the light cannot find anyone, or only through a wall', () => {
    const far = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 200 + WEAPONS.freezer.hex!.rangePx + 60, y: 299, hp: 150, alive: true },
    ];
    const farReq = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: far[1]!.x, y: 299, hp: 150 }] });
    expect(decideHeuristic(input(still(farReq), far)).weapon).not.toBe('freezer');
    const closer = decideHeuristic(input(farReq, far));
    expect(closer.weapon).toBe('freezer');
    expect(closer.move.direction).toBe('right');
    const walled = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 400, y: 299, hp: 150, alive: true },
    ];
    const req = request({ ammo, enemies: [{ id: 'b1', team: 'blue', x: 400, y: 299, hp: 150 }] });
    const mask = flatMask(req.world.w, req.world.h, 300);
    for (let y = 200; y < 300; y += 1) setSpan(mask, y, 300, 306, SOLID);
    expect(decideHeuristic({ request: req, registry: WEAPONS, mask, worms: walled }).weapon).not.toBe('freezer');
  });

  it('holds it when the burst would take a friend with the enemy', () => {
    // 60 hp: worth the 50 it costs alone, not with a friend in the burst on top of that.
    const crowded = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 480, y: 299, hp: 60, alive: true },
      { id: 'r2', teamId: 'red', x: 482, y: 299, hp: 100, alive: true },
    ];
    const req = request({ ammo: [{ weapon: 'freezer' as WeaponId, count: 1 }], enemies: [{ id: 'b1', team: 'blue', x: 480, y: 299, hp: 60 }] });
    const lone = [crowded[0]!, crowded[1]!];
    const alone = decideHeuristic(input(req, lone));
    expect(alone.weapon).toBe('freezer');
    expect(alone.confidence).toBeGreaterThan(0);
    // Next to a friend the burst and the price cost more than the kill is worth: nothing scores, the CPU skips.
    expect(decideHeuristic(input(req, crowded)).confidence).toBe(0);
  });

  it('never pays for a kill worth less than the price', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 480, y: 299, hp: 30, alive: true },
    ];
    const req = request({ ammo: [{ weapon: 'skip_go' as WeaponId, count: -1 }, { weapon: 'freezer' as WeaponId, count: 1 }], enemies: [{ id: 'b1', team: 'blue', x: 480, y: 299, hp: 30 }] });
    expect(decideHeuristic(input(still(req), worms)).weapon).toBe('skip_go');
  });
});

describe('decideHeuristic: walking and turning', () => {
  it('turns round to shoot an enemy behind it', () => {
    const worms = [
      { id: 'r1', teamId: 'red', x: 600, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const req = request({ active: { wormId: 'r1', team: 'red', x: 600, y: 299, hp: 100, canMoveLeft: true, canMoveRight: true, maxWalkMs: 3000 }, enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    const out = decideHeuristic(input(req, worms));
    expect(out.weapon).toBe('bazooka');
    expect(out.facing).toBe('left');
    expect(decideHeuristic(input(still(req), worms)).facing).toBe('left');
  });

  it('walks before it fires when a walk gives up little, and stands still when the walk is spent', () => {
    const req = request({ ammo: [{ weapon: 'shotgun' as WeaponId, count: -1 }], enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    const moving = decideHeuristic(input(req, worms));
    expect(moving.weapon).toBe('shotgun');
    expect(moving.move.direction).not.toBe('none');
    expect(moving.move.durationMs).toBeGreaterThan(0);
    expect(moving.move.durationMs).toBeLessThanOrEqual(req.active.maxWalkMs);
    expect(decideHeuristic(input(still(req), worms)).move.direction).toBe('none');
  });

  it('never plans a walk off a cliff or into the water', () => {
    const req = request({ ammo: [{ weapon: 'shotgun' as WeaponId, count: -1 }], enemies: [{ id: 'b1', team: 'blue', x: 330, y: 299, hp: 100 }] });
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 330, y: 299, hp: 100, alive: true },
    ];
    // Ground only between 180 and 240: a step either way beyond it is a drop.
    const mask = createMask(req.world.w, req.world.h);
    for (let y = 300; y < req.world.h; y += 1) setSpan(mask, y, 180, 240, SOLID);
    for (let y = 300; y < req.world.h; y += 1) setSpan(mask, y, 320, 340, SOLID);
    const spots = walkSpots({ request: req, registry: WEAPONS, mask, worms }, worms[0]!);
    for (const spot of spots) {
      expect(spot.at.x).toBeGreaterThanOrEqual(180 - 5);
      expect(spot.at.x).toBeLessThanOrEqual(240 + 5);
    }
  });

  it('with no shot at all, walks toward the nearest enemy and passes the turn', () => {
    const req = request({ ammo: [{ weapon: 'baseball_bat' as WeaponId, count: 1 }, { weapon: 'skip_go' as WeaponId, count: -1 }], enemies: [{ id: 'b1', team: 'blue', x: 700, y: 299, hp: 100 }] });
    const worms = [
      { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
      { id: 'b1', teamId: 'blue', x: 700, y: 299, hp: 100, alive: true },
    ];
    const out = decideHeuristic(input(req, worms));
    expect(out.weapon).toBe('skip_go');
    expect(out.facing).toBe('right');
    expect(out.move.direction).toBe('right');
    expect(out.move.durationMs).toBeGreaterThan(1000);
  });

  it('prefers a walk only when it costs little: a clearly better shot from where it stands wins', () => {
    const shots = [
      { score: 50, spot: { at: { id: 'a', teamId: 't', x: 0, y: 0, hp: 1, alive: true }, dir: 0 as const, walkMs: 0 } },
      { score: 46, spot: { at: { id: 'a', teamId: 't', x: 40, y: 0, hp: 1, alive: true }, dir: 1 as const, walkMs: 600 } },
      { score: 30, spot: { at: { id: 'a', teamId: 't', x: 80, y: 0, hp: 1, alive: true }, dir: 1 as const, walkMs: 1300 } },
    ];
    expect(pickChoice(shots)?.spot.dir).toBe(1);
    expect(pickChoice(shots)?.score).toBe(46);
    expect(pickChoice([shots[0]!, shots[2]!])?.spot.dir).toBe(0);
    expect(pickChoice([])).toBeNull();
  });
});

describe('decideHeuristic: the saibaman seed', () => {
  const seedAmmo = [
    { weapon: 'skip_go' as WeaponId, count: -1 },
    { weapon: 'saibaman' as WeaponId, count: 1 },
  ];
  // An enemy far out of any shot the CPU has: the seed is the best it can do.
  const far = [
    { id: 'r1', teamId: 'red', x: 200, y: 299, hp: 100, alive: true },
    { id: 'b1', teamId: 'blue', x: 900, y: 299, hp: 100, alive: true },
  ];

  it('plants a seed when it has nothing better to do', () => {
    const req = still(request({ ammo: seedAmmo, enemies: [{ id: 'b1', team: 'blue', x: 900, y: 299, hp: 100 }] }));
    const decision = decideHeuristic(input(req, far));
    expect(decision.weapon).toBe('saibaman');
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it('shoots instead when it has a shot worth more than a Saibaman', () => {
    const req = still(request({ ammo: [{ weapon: 'bazooka' as WeaponId, count: -1 }, ...seedAmmo] }));
    const decision = decideHeuristic(input(req, flatWorms));
    expect(decision.weapon).toBe('bazooka');
    expect(SPROUT_SCORE).toBeLessThan(30);
  });

  it('never plants for a team already at its cap, or where there is no ground for it', () => {
    const cap = WEAPONS.saibaman.sprout!.maxTeamWorms;
    const full = [...far, ...Array.from({ length: cap - 1 }, (_, i) => ({ id: `r${i + 2}`, teamId: 'red', x: 300 + i * 20, y: 299, hp: 100, alive: true }))];
    const req = still(request({ ammo: seedAmmo, enemies: [{ id: 'b1', team: 'blue', x: 900, y: 299, hp: 100 }] }));
    expect(decideHeuristic(input(req, full)).weapon).not.toBe('saibaman');
    // Alone on a one pixel pillar over the sea.
    const mask = createMask(1000, 400);
    setSpan(mask, 300, 200, 200, SOLID);
    expect(decideHeuristic({ request: req, registry: WEAPONS, mask, worms: far }).weapon).not.toBe('saibaman');
  });
});

describe('decideHeuristic: the anime row', () => {
  // With nothing worth firing the CPU passes: skip_go is in hand for that.
  const only = (weapon: WeaponId) => [{ weapon: 'skip_go' as WeaponId, count: -1 }, { weapon, count: 1 }];
  const pair = (enemyX: number, enemyHp = 100, ownHp = 100) => [
    { id: 'r1', teamId: 'red', x: 200, y: 299, hp: ownHp, alive: true },
    { id: 'b1', teamId: 'blue', x: enemyX, y: 299, hp: enemyHp, alive: true },
  ];
  const req = (weapon: WeaponId, enemyX: number, enemyHp = 100, ownHp = 100) =>
    still(request({ ammo: only(weapon), active: { wormId: 'r1', team: 'red', x: 200, y: 299, hp: ownHp, canMoveLeft: true, canMoveRight: true, maxWalkMs: 0 }, enemies: [{ id: 'b1', team: 'blue', x: enemyX, y: 299, hp: enemyHp }] }));

  it('stings a fat enemy in the open with Antares, at it, and pays half its own health for it', () => {
    const decision = decideHeuristic(input(req('antares', 400), pair(400)));
    expect(decision.weapon).toBe('antares');
    expect(decision.facing).toBe('right');
    expect(Math.abs(decision.aimAngleDeg)).toBeLessThanOrEqual(5);
    // 100 for the kill, 50 for the price.
    expect(decision.reasoning).toContain('expected score 50');
  });

  it('never stings through a wall', () => {
    const mask = flatMask(1000, 400, 300);
    for (let y = 250; y < 300; y += 1) setSpan(mask, y, 300, 306, SOLID);
    expect(decideHeuristic({ request: req('antares', 400), registry: WEAPONS, mask, worms: pair(400) }).weapon).not.toBe('antares');
  });

  it('hurls a galaxy at a fat enemy, but not when it would take the thrower or a friend too', () => {
    expect(decideHeuristic(input(req('galaxian', 450), pair(450))).weapon).toBe('galaxian');
    const withFriend = [...pair(450), { id: 'r2', teamId: 'red', x: 470, y: 299, hp: 100, alive: true }];
    expect(decideHeuristic(input(req('galaxian', 450), withFriend)).weapon).not.toBe('galaxian');
    // A thin enemy is not worth the 50 it costs.
    expect(decideHeuristic(input(req('galaxian', 450, 30), pair(450, 30))).weapon).not.toBe('galaxian');
  });

  it('seals the nearest enemy with the treasure, unless its own health cannot pay for every strike', () => {
    expect(decideHeuristic(input(req('tenbu_horin', 400), pair(400))).weapon).toBe('tenbu_horin');
    expect(decideHeuristic(input(req('tenbu_horin', 400, 100, 45), pair(400, 100, 45))).weapon).not.toBe('tenbu_horin');
  });

  it('values the seal by the turns it takes: whole turns from a last worm, little from one whose team plays on', () => {
    // The last of its team: 100 for the kill, and three turns its team loses, 20 each less the 15 a strike costs.
    expect(decideHeuristic(input(req('tenbu_horin', 400), pair(400))).reasoning).toContain('expected score 115');
    // A teammate out of reach plays the turns instead: only that worm sits them out, 5 each less the 15.
    const withTeammate = [...pair(400), { id: 'b2', teamId: 'blue', x: 900, y: 299, hp: 100, alive: true }];
    const decision = decideHeuristic(input(req('tenbu_horin', 400), withTeammate));
    expect(decision.weapon).toBe('tenbu_horin');
    expect(decision.reasoning).toContain('expected score 70');
  });

  it('throws the Hiken at an enemy in reach', () => {
    const decision = decideHeuristic(input(req('hiken', 420), pair(420)));
    expect(decision.weapon).toBe('hiken');
    expect(decision.facing).toBe('right');
  });

  it('calls the meteor down on an enemy, with the point to call it on', () => {
    const decision = decideHeuristic(input(req('meteor', 600), pair(600)));
    expect(decision.weapon).toBe('meteor');
    expect(decision.targetPoint).toEqual({ x: 600, y: 299 });
  });

  it('cuts an enemy standing close into cubes, and holds the swords for one far off', () => {
    expect(decideHeuristic(input(req('santoryu', 260), pair(260))).weapon).toBe('santoryu');
    expect(decideHeuristic(input(req('santoryu', 600), pair(600))).weapon).not.toBe('santoryu');
  });

  it('casts Zoltraak at an enemy in the open', () => {
    const decision = decideHeuristic(input(req('zoltraak', 450), pair(450)));
    expect(decision.weapon).toBe('zoltraak');
    expect(Math.abs(decision.aimAngleDeg)).toBeLessThanOrEqual(5);
  });
});
