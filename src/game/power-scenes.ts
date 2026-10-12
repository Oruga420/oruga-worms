import type { Ctx2D, Size } from '../engine/canvas-types.ts';
import { worldToScreen, type Camera } from '../engine/camera.ts';
import { roomPreview } from '../match/room.ts';
import { techniqueProgress } from '../sim/technique.ts';
import type { TechniqueBody } from '../sim/types.ts';
import { drawClawFinish, drawClawStrike, drawFrozenMark, drawHexField, drawImmortalMark, drawRoomField, drawTimeStop } from './power-art.ts';
import { drawAuthoredPower, drawVictimHead, type PowerAssets, type VictimSprite } from './power-assets.ts';

export type PowerBody = Extract<TechniqueBody, { kind: 'time_stop' | 'force_field' | 'claws' | 'room' }>;
const HOLD_CYCLE = [0, 1, 2, 3, 2, 1] as const;
const HOLD_FRAME_MS = 120;

export function clawVictimDefeated(worm: { readonly hp: number; readonly alive: boolean } | undefined): boolean {
  return worm !== undefined && (worm.hp <= 0 || !worm.alive);
}

/** Ping-pong only the intact frames; an active buff must never play its shattering frames. */
export function powerHoldProgress(kind: 'hex-shield' | 'immortality-wings' | 'frozen-plate' | 'room-bloom', timeMs: number): number {
  const offset = HOLD_CYCLE[Math.floor(Math.max(0, timeMs) / HOLD_FRAME_MS) % HOLD_CYCLE.length] ?? 0;
  const first = kind === 'immortality-wings' ? 6 : kind === 'frozen-plate' ? 0 : 8;
  return (first + offset + 0.5) / (kind === 'frozen-plate' ? 4 : 16);
}

export function drawPowerScene(ctx: Ctx2D, viewport: Size, camera: Camera, body: PowerBody, world: Size, timeMs: number, gore: boolean, assets?: PowerAssets | null, victimKilled = false, portrait?: VictimSprite): void {
  const home = worldToScreen(camera, viewport, { x: body.holdX, y: body.holdY - 12 });
  const p = techniqueProgress(body);
  const z = camera.zoom;
  switch (body.kind) {
    case 'time_stop': {
      const frame = body.stage === 'charge' ? p * 0.25 : 0.75 + p * 0.25;
      if (!drawAuthoredPower(ctx, assets, 'frost-burst', frame, { x: home.x, y: home.y, sizePx: 120 * z })) {
        drawTimeStop(ctx, home.x, home.y, z, body.stage === 'charge' ? p * 0.5 : 0.5 + p * 0.5);
      }
      return;
    }
    case 'force_field':
      // The ledger-driven status owns the barrier once raised, so it is never painted twice.
      if (body.applied) return;
      if (!drawAuthoredPower(ctx, assets, 'hex-shield', p * 0.5, { x: home.x, y: home.y, sizePx: 100 * z, alpha: 0.8 })) {
        drawHexField(ctx, home.x, home.y, z, body.stage === 'charge' ? p : 1 - p, timeMs);
      }
      return;
    case 'claws': {
      const at = worldToScreen(camera, viewport, { x: body.targetX, y: body.targetY });
      const frame = body.stage === 'windup' ? p * 0.25 : 0.25 + p * 0.75;
      const painted = drawAuthoredPower(ctx, assets, 'slash-spark', frame, { x: at.x, y: at.y, sizePx: 115 * z, flipX: body.facing < 0 });
      if (!painted) drawClawStrike(ctx, at.x, at.y, z, body.stage === 'windup' ? p * 0.5 : 0.5 + p * 0.5, gore && body.struck);
      if (gore && victimKilled && body.struck && body.stage === 'recover') {
        const head = drawVictimHead(ctx, portrait, at.x, at.y - 8 * z, z, p, body.facing);
        if (!head && !painted) drawClawFinish(ctx, at.x, at.y - 8 * z, z, p, body.facing);
      }
      return;
    }
    case 'room':
      drawRoomScene(ctx, viewport, camera, body, world, timeMs, assets);
      return;
  }
}

function drawRoomScene(ctx: Ctx2D, viewport: Size, camera: Camera, body: Extract<PowerBody, { kind: 'room' }>, world: Size, timeMs: number, assets?: PowerAssets | null): void {
  const p = techniqueProgress(body);
  const region = roomPreview(body.angleDeg, world, { x: body.holdX, y: body.holdY });
  const center = worldToScreen(camera, viewport, { x: body.holdX, y: body.holdY });
  const frame = body.stage === 'charge' ? p * 0.5 : 0.5 + p * 0.5;
  // Growth is already painted into the source frames. The full-size rim stays anchored to the real region.
  if (!drawAuthoredPower(ctx, assets, 'room-bloom', frame, { x: center.x, y: center.y, radiusPx: region.radiusPx * camera.zoom, alpha: 0.65 })) {
    const grow = body.stage === 'charge' ? Math.max(0.01, p) : 1;
    drawRoomField(ctx, center.x, center.y, region.radiusPx * camera.zoom * grow, body.stage === 'charge' ? p : 1 - p, timeMs);
  }
}

interface StatusWorm {
  readonly id: string;
  readonly alive: boolean;
  readonly hp?: number;
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
  const z = camera.zoom;
  for (const worm of worms) {
    if (!worm.alive || (worm.hp !== undefined && worm.hp <= 0)) continue;
    const body = positions.get(worm.id);
    if (body === undefined) continue;
    const p = worldToScreen(camera, viewport, body);
    if ((worm.shieldDurability ?? 0) > 0) {
      const painted = drawAuthoredPower(ctx, assets, 'hex-shield', powerHoldProgress('hex-shield', timeMs), { x: p.x, y: p.y - 12 * z, sizePx: 100 * z, alpha: 0.8 });
      if (!painted) drawHexField(ctx, p.x, p.y - 12 * z, z, Math.min(1, (worm.shieldDurability ?? 0) / 100), timeMs);
    }
    if ((worm.frozenTurns ?? 0) > 0) {
      const painted = drawAuthoredPower(ctx, assets, 'frozen-plate', powerHoldProgress('frozen-plate', timeMs), { x: p.x, y: p.y - 12 * z, sizePx: 84 * z, alpha: 0.85 });
      drawFrozenMark(ctx, p.x, p.y, z, worm.frozenTurns ?? 0, !painted);
    }
    if ((worm.immortalityCharges ?? 0) > 0) {
      const painted = drawAuthoredPower(ctx, assets, 'immortality-wings', powerHoldProgress('immortality-wings', timeMs), { x: p.x, y: p.y - 12 * z, sizePx: 84 * z });
      const badgeY = p.y - ((worm.frozenTurns ?? 0) > 0 ? 12 * z : 0);
      drawImmortalMark(ctx, p.x, badgeY, z, worm.immortalityCharges ?? 0, timeMs, !painted);
    }
  }
}

export function drawRoomPreview(ctx: Ctx2D, viewport: Size, camera: Camera, caster: PositionedWorm, world: Size, angleDeg: number, timeMs: number, assets?: PowerAssets | null): void {
  const region = roomPreview(angleDeg, world, caster);
  const at = worldToScreen(camera, viewport, caster);
  if (!drawAuthoredPower(ctx, assets, 'room-bloom', powerHoldProgress('room-bloom', timeMs), { x: at.x, y: at.y, radiusPx: region.radiusPx * camera.zoom, alpha: 0.3 })) {
    drawRoomField(ctx, at.x, at.y, region.radiusPx * camera.zoom, 0.25, timeMs);
  }
  ctx.save();
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#132b42';
  ctx.fillRect(at.x - 136, at.y - 87, 272, 24);
  ctx.fillStyle = '#d7f6ff';
  ctx.fillText(`ROOM ${region.coveragePct}% / HP -${region.coveragePct}% / UP-DOWN`, at.x, at.y - 71, 260);
  ctx.restore();
}
