import { describe, expect, it } from 'vitest';
import { drawClawStrike, drawFrozenMark, drawHexField, drawImmortalMark, drawRoomField, drawTimeStop } from '@/game/power-art.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

function numbersAreFinite(args: readonly unknown[]): boolean {
  return args.every((arg) => typeof arg !== 'number' || Number.isFinite(arg));
}

describe('power artwork', () => {
  it('draws seven connected six-sided shields', () => {
    const ctx = createRecordingContext();
    drawHexField(ctx, 100, 100, 1, 1, 200);
    expect(ctx.calls.filter((call) => call.name === 'closePath')).toHaveLength(7);
    expect(ctx.calls.filter((call) => call.name === 'stroke')).toHaveLength(7);
    expect(ctx.calls.length).toBeLessThan(150);
  });

  it('uses the real ROOM radius and leaves context state isolated', () => {
    const ctx = createRecordingContext();
    drawRoomField(ctx, 100, 80, 375, 0.5, 1000);
    expect(ctx.calls.some((call) => call.name === 'arc' && call.args[2] === 375)).toBe(true);
    expect(ctx.calls.at(-1)?.name).toBe('restore');
  });

  it('does not draw a ROOM with invalid or zero radius', () => {
    for (const radius of [Number.NaN, Infinity, -1, 0]) {
      const ctx = createRecordingContext();
      drawRoomField(ctx, 10, 10, radius, 1, 0);
      expect(ctx.calls).toHaveLength(0);
    }
  });

  it.each([0, 1, 2, 3])('draws exactly %i remaining immortality beads', (charges) => {
    const ctx = createRecordingContext();
    drawImmortalMark(ctx, 100, 100, 1, charges, 0);
    expect(ctx.calls.filter((call) => call.name === 'arc' && call.args[2] === 3)).toHaveLength(charges);
  });

  it('shows freeze as a status rather than changing body positions', () => {
    const ctx = createRecordingContext();
    drawFrozenMark(ctx, 100, 100, 1, 1);
    expect(ctx.calls.some((call) => call.name === 'fillText' && call.args[0] === 'FROZEN 1')).toBe(true);
  });

  it('keeps all effects finite throughout their animation', () => {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const ctx = createRecordingContext();
      drawClawStrike(ctx, 100, 100, 1, progress, false);
      drawClawStrike(ctx, 100, 100, 1, progress, true);
      drawTimeStop(ctx, 100, 100, 1, progress);
      drawHexField(ctx, 100, 100, 1, progress, 1000);
      expect(ctx.calls.every((call) => numbersAreFinite(call.args))).toBe(true);
      expect(ctx.calls.length).toBeLessThan(500);
    }
  });
});
