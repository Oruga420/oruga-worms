/**
 * Sprite-first visual regression contract: Alejandro rejected the code-looking vector FX
 * (hex polygons, wireframe rings, arc based bursts) and approved painted raster sprites instead.
 * This suite pins the contract power-scenes.ts (and the power-assets.ts atlas wiring) must meet
 * once that work lands: when PowerAssets are supplied, every scene and status draws a sprite via
 * drawImage and stops emitting the large procedural vector shapes; when assets are unavailable
 * (null), the existing procedural fallback keeps the game playable, unchanged.
 *
 * It also pins the raster victim-head finisher to both the gore setting and a confirmed kill.
 * Rendering must never change the underlying combat state.
 */
import { describe, expect, it } from 'vitest';
import { drawPowerScene, drawPowerStatuses, drawRoomPreview } from '@/game/power-scenes.ts';
import { createCamera, worldToScreen } from '@/engine/camera.ts';
import { createAtlas } from '@/engine/atlas.ts';
import { validateAtlasManifest, type AtlasManifest } from '@/engine/atlas-schema.ts';
import { roomPreview } from '@/match/room.ts';
import type { ClawsBody, ForceFieldBody, RoomBody, TimeStopBody } from '@/sim/types.ts';
import type { ImageSource } from '@/engine/canvas-types.ts';
import type { PowerAssets } from '@/game/power-assets.ts';
import { createRecordingContext, type RecordedCall, type RecordingContext } from '../ui/recording-context.ts';

const viewport = { w: 800, h: 600 };
const camera = createCamera({ x: 100, y: 100, bounds: { w: 1000, h: 600 } });

/** Full-square 192px frames, one per row slot, default center pivot via meta. */
const FRAME = 192;
const SPRITE_IDS = ['hex-shield', 'slash-spark', 'frost-burst', 'room-bloom', 'immortality-wings', 'frozen-plate', 'blast-burst'] as const;
type SpriteId = (typeof SPRITE_IDS)[number];

function frameAt(index: number): Record<string, unknown> {
  const x = index * FRAME;
  return {
    frame: { x, y: 0, w: FRAME, h: FRAME },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: FRAME, h: FRAME },
    sourceSize: { w: FRAME, h: FRAME },
  };
}

function paintedManifestJson(): Record<string, unknown> {
  const frames: Record<string, unknown> = {};
  SPRITE_IDS.forEach((id, index) => { frames[id] = frameAt(index); });
  return {
    meta: {
      image: 'power-sheet.png',
      size: { w: FRAME * SPRITE_IDS.length, h: FRAME },
      pivot: { x: 0.5, y: 0.5 },
    },
    frames,
    animations: {},
    // The rim sits at (160, 96) on a 192x192 frame pivoted at its center (96, 96): 64px out.
    attachPoints: { 'room-bloom': { rim: { x: 160, y: 96 } } },
  };
}

function paintedManifest(): AtlasManifest {
  const result = validateAtlasManifest(paintedManifestJson());
  if (!result.ok) throw new Error(`fixture manifest invalid: ${result.error.message}`);
  return result.value;
}

const paintedImage = { width: FRAME * SPRITE_IDS.length, height: FRAME } as unknown as ImageSource;

function paintedAssets(): PowerAssets {
  const result = createAtlas(paintedManifest(), paintedImage);
  if (!result.ok) throw new Error(`fixture atlas invalid: ${result.error.message}`);
  return Object.freeze({ atlas: result.value, image: paintedImage });
}

function sourceXOf(id: SpriteId): number {
  return SPRITE_IDS.indexOf(id) * FRAME;
}

function drawImageCalls(ctx: RecordingContext): readonly RecordedCall[] {
  return ctx.calls.filter((call) => call.name === 'drawImage');
}

/** Arc calls, optionally only the ones whose radius (args[2]) is bigger than a threshold. */
function arcCalls(ctx: RecordingContext, biggerThanPx = 0): readonly RecordedCall[] {
  return ctx.calls.filter((call) => call.name === 'arc' && Number(call.args[2]) > biggerThanPx);
}

function closePathCalls(ctx: RecordingContext): readonly RecordedCall[] {
  return ctx.calls.filter((call) => call.name === 'closePath');
}

const shieldBody: ForceFieldBody = {
  id: 1, kind: 'force_field', weaponId: 'force_field', attackerId: 'a', ownerTeamId: 'a',
  stage: 'charge', stageTicks: 20, holdX: 100, holdY: 100, facing: 1, applied: false, alive: true,
  spec: { kind: 'force_field', chargeMs: 600, recoverMs: 600, durability: 100, ownTurns: 1 },
};

const clawsWindup: ClawsBody = {
  id: 2, kind: 'claws', weaponId: 'adamantium_claws', attackerId: 'a', ownerTeamId: 'a',
  stage: 'windup', stageTicks: 10, holdX: 100, holdY: 100, facing: 1, alive: true,
  victimId: 'b', targetX: 150, targetY: 100, struck: false,
  spec: { kind: 'claws', rangePx: 90, windupMs: 600, recoverMs: 600 },
};

const timeStopBody: TimeStopBody = {
  id: 3, kind: 'time_stop', weaponId: 'time_stop', attackerId: 'a', ownerTeamId: 'a',
  stage: 'charge', stageTicks: 10, holdX: 100, holdY: 100, facing: 1, applied: false, alive: true,
  spec: { kind: 'time_stop', chargeMs: 600, recoverMs: 600, freezeTurns: 1 },
};

describe('painted power atlas fixture', () => {
  it('indexes all seven sprite ids as single square frames with the default center pivot', () => {
    const assets = paintedAssets();
    for (const id of SPRITE_IDS) {
      const frame = assets.atlas.frame(id);
      if (!frame) throw new Error(`fixture missing frame ${id}`);
      expect(frame.frame).toEqual({ x: sourceXOf(id), y: 0, w: FRAME, h: FRAME });
      expect(assets.atlas.pivotOf(frame)).toEqual({ x: 0.5, y: 0.5 });
      expect(assets.atlas.frameIds(id)).toEqual([id]);
    }
  });

  it('places the room-bloom rim attach point 64px from the sprite center', () => {
    const assets = paintedAssets();
    const rim = assets.atlas.attachOffset('room-bloom', 'rim');
    expect(rim).toBeDefined();
    if (!rim) return;
    expect(Math.hypot(rim.x, rim.y)).toBeCloseTo(64, 5);
  });
});

describe('drawPowerScene paints sprites and drops the matching vector effect', () => {
  it('draws the force-field cast as a sprite with no hex polygon wireframe', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    drawPowerScene(ctx, viewport, camera, shieldBody, { w: 1000, h: 600 }, 1000, true, assets);
    const draws = drawImageCalls(ctx);
    expect(draws.some((call) => Number(call.args[1]) === sourceXOf('hex-shield'))).toBe(true);
    expect(closePathCalls(ctx)).toHaveLength(0);
  });

  it('draws the claws windup as a sprite with no metal-trail strokes', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    drawPowerScene(ctx, viewport, camera, clawsWindup, { w: 1000, h: 600 }, 1000, true, assets);
    const draws = drawImageCalls(ctx);
    expect(draws.some((call) => Number(call.args[1]) === sourceXOf('slash-spark'))).toBe(true);
    expect(ctx.calls.filter((call) => call.name === 'stroke')).toHaveLength(0);
  });

  it('draws the time-stop cast as a frost-burst sprite with no vector ring or tick marks', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    drawPowerScene(ctx, viewport, camera, timeStopBody, { w: 1000, h: 600 }, 1000, true, assets);
    const draws = drawImageCalls(ctx);
    expect(draws.some((call) => Number(call.args[1]) === sourceXOf('frost-burst'))).toBe(true);
    expect(arcCalls(ctx)).toHaveLength(0);
  });

  it('sizes the ROOM scene sprite from the real region radius and the rim-64 attach point, not a fixed box', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    const world = { w: 1920, h: 696 };
    const body: RoomBody = {
      id: 4, kind: 'room', weaponId: 'room', attackerId: 'a', ownerTeamId: 'a',
      stage: 'charge', stageTicks: 1, holdX: 400, holdY: 300, facing: 1, applied: false, alive: true,
      angleDeg: 10, spec: { kind: 'room', minPct: 1, maxPct: 99, defaultPct: 50, chargeMs: 600, recoverMs: 600 },
    };
    drawPowerScene(ctx, viewport, camera, body, world, 1000, true, assets);

    const region = roomPreview(body.angleDeg, world, { x: body.holdX, y: body.holdY });
    const center = worldToScreen(camera, viewport, { x: body.holdX, y: body.holdY });
    const rim = assets.atlas.attachOffset('room-bloom', 'rim');
    if (!rim) throw new Error('fixture missing rim attach point');
    const rimRadiusPx = Math.hypot(rim.x, rim.y);
    const expectedSize = (FRAME * region.radiusPx * camera.zoom) / rimRadiusPx;

    const draws = drawImageCalls(ctx);
    expect(draws).toHaveLength(1);
    const args = draws[0]?.args ?? [];
    expect(Number(args[1])).toBe(sourceXOf('room-bloom'));
    expect(Number(args[2])).toBe(0);
    expect(Number(args[3])).toBe(FRAME);
    expect(Number(args[4])).toBe(FRAME);
    expect(Number(args[7])).toBeCloseTo(expectedSize, 1);
    expect(Number(args[8])).toBeCloseTo(expectedSize, 1);
    expect(Number(args[5])).toBeCloseTo(center.x - expectedSize / 2, 1);
    expect(Number(args[6])).toBeCloseTo(center.y - expectedSize / 2, 1);
    expect(arcCalls(ctx)).toHaveLength(0);
  });

  it('keeps the procedural hex-field fallback when assets are unavailable, so the game stays playable', () => {
    const ctx = createRecordingContext();
    drawPowerScene(ctx, viewport, camera, shieldBody, { w: 1000, h: 600 }, 1000, true, null);
    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(closePathCalls(ctx)).toHaveLength(7);
  });
});

describe('drawRoomPreview accepts an optional assets param and paints the same sprite the cast will use', () => {
  it('sizes the sprite from the live radius and the rim-64 point, keeping the text hint but dropping the vector ring', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    const world = { w: 1920, h: 696 };
    const caster = { id: 'a', alive: true, x: 400, y: 300 };
    const angleDeg = 90;
    drawRoomPreview(ctx, viewport, camera, caster, world, angleDeg, 1000, assets);

    const region = roomPreview(angleDeg, world, caster);
    const center = worldToScreen(camera, viewport, caster);
    const rim = assets.atlas.attachOffset('room-bloom', 'rim');
    if (!rim) throw new Error('fixture missing rim attach point');
    const rimRadiusPx = Math.hypot(rim.x, rim.y);
    const expectedSize = (FRAME * region.radiusPx * camera.zoom) / rimRadiusPx;

    const draws = drawImageCalls(ctx);
    expect(draws).toHaveLength(1);
    const args = draws[0]?.args ?? [];
    expect(Number(args[1])).toBe(sourceXOf('room-bloom'));
    expect(Number(args[7])).toBeCloseTo(expectedSize, 1);
    expect(Number(args[8])).toBeCloseTo(expectedSize, 1);
    expect(Number(args[5])).toBeCloseTo(center.x - expectedSize / 2, 1);
    expect(Number(args[6])).toBeCloseTo(center.y - expectedSize / 2, 1);
    expect(arcCalls(ctx)).toHaveLength(0);
    expect(ctx.calls.some((call) => call.name === 'fillText' && String(call.args[0]).includes('ROOM 99%'))).toBe(true);
  });

  it('keeps today drawing (text hint plus the procedural ring) when no assets are passed', () => {
    const ctx = createRecordingContext();
    const world = { w: 1920, h: 696 };
    drawRoomPreview(ctx, viewport, camera, { id: 'a', alive: true, x: 0, y: 0 }, world, 90, 1000);
    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(ctx.calls.some((call) => call.name === 'fillText' && String(call.args[0]).includes('ROOM 99%'))).toBe(true);
    expect(ctx.calls.some((call) => call.name === 'arc' && Number(call.args[2]) > 1500 * camera.zoom)).toBe(true);
  });
});

describe('drawPowerStatuses paints persistent statuses as sprites and drops the matching vector shape', () => {
  it('draws the persistent shield as a sprite with no hex polygon', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    const worms = [{ id: 'a', alive: true, shieldDurability: 100 }];
    const bodies = [{ id: 'a', alive: true, x: 100, y: 100 }];
    drawPowerStatuses(ctx, viewport, camera, worms, bodies, 1000, assets);
    const draws = drawImageCalls(ctx);
    expect(draws.some((call) => Number(call.args[1]) === sourceXOf('hex-shield'))).toBe(true);
    expect(closePathCalls(ctx)).toHaveLength(0);
  });

  it('draws the frozen status as a sprite plus the FROZEN label, with no ice polygon', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    const worms = [{ id: 'a', alive: true, frozenTurns: 2 }];
    const bodies = [{ id: 'a', alive: true, x: 100, y: 100 }];
    drawPowerStatuses(ctx, viewport, camera, worms, bodies, 1000, assets);
    const draws = drawImageCalls(ctx);
    expect(draws.some((call) => Number(call.args[1]) === sourceXOf('frozen-plate'))).toBe(true);
    expect(ctx.calls.some((call) => call.name === 'fillText' && String(call.args[0]) === 'FROZEN 2')).toBe(true);
    expect(closePathCalls(ctx)).toHaveLength(0);
  });

  it('draws the immortal status as a sprite plus up to 3 tiny counter beads, with no big gold ring', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    const worms = [{ id: 'a', alive: true, immortalityCharges: 3 }];
    const bodies = [{ id: 'a', alive: true, x: 100, y: 100 }];
    drawPowerStatuses(ctx, viewport, camera, worms, bodies, 1000, assets);
    const draws = drawImageCalls(ctx);
    expect(draws.some((call) => Number(call.args[1]) === sourceXOf('immortality-wings'))).toBe(true);
    // The 3 tiny counter dots are UI, not spell geometry: they stay.
    expect(arcCalls(ctx, 0).filter((call) => Number(call.args[2]) <= 10)).toHaveLength(3);
    // The large gold ring behind them is the vector effect that must go.
    expect(arcCalls(ctx, 10)).toHaveLength(0);
  });

  it('keeps the procedural fallback (polygon ring, mark, label) when assets are unavailable', () => {
    const ctx = createRecordingContext();
    const worms = [{ id: 'a', alive: true, frozenTurns: 1, shieldDurability: 100, immortalityCharges: 3 }];
    const bodies = [{ id: 'a', alive: true, x: 100, y: 100 }];
    drawPowerStatuses(ctx, viewport, camera, worms, bodies, 1000, null);
    expect(drawImageCalls(ctx)).toHaveLength(0);
    expect(ctx.calls.some((call) => call.name === 'fillText' && call.args[0] === 'FROZEN 1')).toBe(true);
  });

  it('does not mutate the worm or body records it reads while drawing', () => {
    const assets = paintedAssets();
    const ctx = createRecordingContext();
    const worm = Object.freeze({ id: 'a', alive: true, frozenTurns: 2, shieldDurability: 50, immortalityCharges: 1 });
    const body = Object.freeze({ id: 'a', alive: true, x: 100, y: 100 });
    const beforeWorm = { ...worm };
    const beforeBody = { ...body };
    expect(() => drawPowerStatuses(ctx, viewport, camera, [worm], [body], 1000, assets)).not.toThrow();
    expect(worm).toEqual(beforeWorm);
    expect(body).toEqual(beforeBody);
  });
});

describe('the claws kill finisher stays gated by gore and outcome, with painted assets wired in', () => {
  it('only draws the actual victim portrait when gore is on and the strike killed', () => {
    const assets = paintedAssets();
    const body: ClawsBody = {
      id: 5, kind: 'claws', weaponId: 'adamantium_claws', attackerId: 'a', ownerTeamId: 'a',
      stage: 'recover', stageTicks: 20, holdX: 100, holdY: 100, facing: 1, alive: true,
      struck: true, victimId: 'b', targetX: 150, targetY: 100,
      spec: { kind: 'claws', rangePx: 90, windupMs: 600, recoverMs: 600 },
    };
    const protectedTarget = createRecordingContext();
    const deadTarget = createRecordingContext();
    const clean = createRecordingContext();
    const headFrame = {
      frame: { x: 0, y: 0, w: 96, h: 96 }, rotated: false as const, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 96, h: 96 }, sourceSize: { w: 96, h: 96 },
    };
    const portrait = { image: { width: 96, height: 96 } as ImageSource, atlas: { ...assets.atlas, frame: (id: string) => id === 'idle_a' ? headFrame : undefined } };
    drawPowerScene(protectedTarget, viewport, camera, body, viewport, 1000, true, assets, false, portrait);
    drawPowerScene(deadTarget, viewport, camera, body, viewport, 1000, true, assets, true, portrait);
    drawPowerScene(clean, viewport, camera, body, viewport, 1000, false, assets, true, portrait);
    expect(arcCalls(protectedTarget)).toHaveLength(0);
    expect(arcCalls(deadTarget)).toHaveLength(0);
    expect(arcCalls(clean)).toHaveLength(0);
    expect(drawImageCalls(deadTarget).some((call) => call.args[0] === portrait.image)).toBe(true);
    expect(drawImageCalls(protectedTarget).some((call) => call.args[0] === portrait.image)).toBe(false);
    expect(drawImageCalls(clean).some((call) => call.args[0] === portrait.image)).toBe(false);
    expect(drawImageCalls(deadTarget).some((call) => Number(call.args[1]) === sourceXOf('slash-spark'))).toBe(true);
  });
});
