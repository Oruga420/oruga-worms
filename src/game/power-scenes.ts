import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { worldToScreen, type Camera } from '../engine/camera.ts';
import { roomPreview } from '../match/room.ts';
import { techniqueProgress } from '../sim/technique.ts';
import type { TechniqueBody } from '../sim/types.ts';
import { drawClawFinish, drawClawStrike, drawFrozenMark, drawHexField, drawImmortalMark, drawRoomField, drawTimeStop } from './power-art.ts';
import { drawAuthoredPower, type AuthoredPower, type PowerAssets } from './power-assets.ts';

const CLIPS: Readonly<Record<PowerBody['kind'], AuthoredPower>> = {
  time_stop: 'time-stop-clock', force_field: 'hex-shield', claws: 'slash-spark', room: 'room-bloom',
};

export type PowerBody = Extract<TechniqueBody, { kind: 'time_stop' | 'force_field' | 'claws' | 'room' }>;

export function drawPowerScene(ctx: Ctx2D, viewport: Size, camera: Camera, body: PowerBody, world: Size, timeMs: number, gore: boolean, assets?: PowerAssets | null, victimKilled = false): void {
  const home = worldToScreen(camera, viewport, { x: body.holdX, y: body.holdY - 12 });
  const p = techniqueProgress(body);
  const z = camera.zoom;
  const authoredAt = body.kind === 'claws' ? worldToScreen(camera, viewport, { x: body.targetX, y: body.targetY }) : home;
  drawAuthoredPower(ctx, assets, CLIPS[body.kind], body.stage === 'recover' ? 0.5 + p * 0.5 : p * 0.5, authoredAt.x, authoredAt.y, 120 * z);
  switch (body.kind) {
    case 'time_stop':
      drawTimeStop(ctx, home.x, home.y, z, body.stage === 'charge' ? p * 0.5 : 0.5 + p * 0.5);
      return;
    case 'force_field':
      drawHexField(ctx, home.x, home.y, z, body.stage === 'charge' ? p : 1 - p, timeMs);
      return;
    case 'claws': {
      const at = worldToScreen(camera, viewport, { x: body.targetX, y: body.targetY });
      drawClawStrike(ctx, at.x, at.y, z, body.stage === 'windup' ? p * 0.5 : 0.5 + p * 0.5, gore && body.struck);
      if (gore && victimKilled && body.struck && body.stage === 'recover') drawClawFinish(ctx, at.x, at.y - 8 * z, z, p, body.facing);
      return;
    }
    case 'room': {
      const region = roomPreview(body.angleDeg, world, { x: body.holdX, y: body.holdY });
      const center = worldToScreen(camera, viewport, { x: body.holdX, y: body.holdY });
      const grow = body.stage === 'charge' ? Math.max(0.01, p) : 1;
      drawRoomField(ctx, center.x, center.y, region.radiusPx * z * grow, body.stage === 'charge' ? p : 1 - p, timeMs);
      return;
    }
  }
}

interface StatusWorm {
  readonly id: string;
  readonly alive: boolean;
  readonly frozenTurns?: number;
  readonly shieldDurability?: number;
  readonly immortalityCharges?: number;
}
interface PositionedWorm {
  readonly id: string;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
}

export function drawPowerStatuses(ctx: Ctx2D, viewport: Size, camera: Camera, worms: readonly StatusWorm[], bodies: readonly PositionedWorm[], timeMs: number, assets?: PowerAssets | null): void {
  const positions = new Map(bodies.filter((body) => body.alive).map((body) => [body.id, body]));
  for (const worm of worms) {
    if (!worm.alive) continue;
    const body = positions.get(worm.id);
    if (body === undefined) continue;
    const p = worldToScreen(camera, viewport, body);
    if ((worm.shieldDurability ?? 0) > 0) drawHexField(ctx, p.x, p.y - 12 * camera.zoom, camera.zoom, Math.min(1, (worm.shieldDurability ?? 0) / 100), timeMs);
    drawFrozenMark(ctx, p.x, p.y, camera.zoom, worm.frozenTurns ?? 0);
    drawImmortalMark(ctx, p.x, p.y, camera.zoom, worm.immortalityCharges ?? 0, timeMs);
    if ((worm.immortalityCharges ?? 0) > 0) drawAuthoredPower(ctx, assets, 'immortality-wings', 0.3 + Math.sin(timeMs / 500) * 0.15, p.x, p.y - 12 * camera.zoom, 76 * camera.zoom);
  }
}

export function drawRoomPreview(ctx: Ctx2D, viewport: Size, camera: Camera, caster: PositionedWorm, world: Size, angleDeg: number, timeMs: number): void {
  const region = roomPreview(angleDeg, world, caster);
  const at = worldToScreen(camera, viewport, caster);
  drawRoomField(ctx, at.x, at.y, region.radiusPx * camera.zoom, 0.25, timeMs);
  ctx.save();
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#132b42';
  ctx.fillRect(at.x - 136, at.y - 87, 272, 24);
  ctx.fillStyle = '#d7f6ff';
  ctx.fillText(`ROOM ${region.coveragePct}% / HP -${region.coveragePct}% / UP-DOWN`, at.x, at.y - 71, 260);
  ctx.restore();
}
