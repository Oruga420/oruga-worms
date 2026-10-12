import { describe, expect, it } from 'vitest';
import { clawVictimDefeated, drawPowerScene, drawPowerStatuses, drawRoomPreview, powerHoldProgress } from '@/game/power-scenes.ts';
import { createCamera } from '@/engine/camera.ts';
import type { ClawsBody, ForceFieldBody } from '@/sim/types.ts';
import { createRecordingContext } from '../ui/recording-context.ts';

const viewport = { w: 800, h: 600 };
const camera = createCamera({ x: 100, y: 100, bounds: { w: 1000, h: 600 } });
const shield: ForceFieldBody = { id: 1, kind: 'force_field', weaponId: 'force_field', attackerId: 'a', ownerTeamId: 'a', stage: 'charge', stageTicks: 20, holdX: 100, holdY: 100, facing: 1, applied: false, alive: true, spec: { kind: 'force_field', chargeMs: 600, recoverMs: 600, durability: 100, ownTurns: 1 } };

describe('power scene wiring', () => {
  it('shows the finisher on confirmed zero HP without waiting for the end-of-turn alive flag', () => {
    expect(clawVictimDefeated({ hp: 0, alive: true })).toBe(true);
    expect(clawVictimDefeated({ hp: 1, alive: true })).toBe(false);
    expect(clawVictimDefeated(undefined)).toBe(false);
  });

  it('keeps persistent sprite playback inside intact hold frames', () => {
    for (let time = 0; time < 2400; time += 17) {
      expect([8, 9, 10, 11]).toContain(Math.floor(powerHoldProgress('hex-shield', time) * 16));
      expect([6, 7, 8, 9]).toContain(Math.floor(powerHoldProgress('immortality-wings', time) * 16));
      expect([0, 1, 2, 3]).toContain(Math.floor(powerHoldProgress('frozen-plate', time) * 4));
    }
  });
  it('draws the real 99-percent ROOM preview and the input hint', () => {
    const ctx = createRecordingContext();
    drawRoomPreview(ctx, viewport, camera, { id: 'a', alive: true, x: 0, y: 0 }, { w: 1920, h: 696 }, 90, 1000);
    expect(ctx.calls.some((call) => call.name === 'fillText' && String(call.args[0]).includes('ROOM 99%'))).toBe(true);
    expect(ctx.calls.some((call) => call.name === 'arc' && Number(call.args[2]) > 1500 * camera.zoom)).toBe(true);
  });

  it('ignores missing bodies and harmless empty status records', () => {
    const ctx = createRecordingContext();
    drawPowerStatuses(ctx, viewport, camera, [{ id: 'missing', alive: true }], [], 0);
    drawPowerStatuses(ctx, viewport, camera, [{ id: 'plain', alive: true }], [{ id: 'plain', alive: true, x: 1, y: 1 }], 0);
    expect(ctx.calls).toHaveLength(0);
  });
  it('only detaches a head when claws actually killed and gore is enabled', () => {
    const body: ClawsBody = { ...shield, kind: 'claws', stage: 'recover', struck: true, victimId: 'b', targetX: 150, targetY: 100, spec: { kind: 'claws', rangePx: 90, windupMs: 600, recoverMs: 600 } };
    const protectedTarget = createRecordingContext();
    const deadTarget = createRecordingContext();
    const clean = createRecordingContext();
    drawPowerScene(protectedTarget, viewport, camera, body, viewport, 1000, true, null, false);
    drawPowerScene(deadTarget, viewport, camera, body, viewport, 1000, true, null, true);
    drawPowerScene(clean, viewport, camera, body, viewport, 1000, false, null, true);
    expect(protectedTarget.calls.filter((call) => call.name === 'arc')).toHaveLength(0);
    expect(deadTarget.calls.filter((call) => call.name === 'arc').length).toBeGreaterThan(0);
    expect(clean.calls.filter((call) => call.name === 'arc')).toHaveLength(0);
  });
  it('draws the hexagonal field during the real force-field charge', () => {
    const ctx = createRecordingContext();
    drawPowerScene(ctx, viewport, camera, shield, { w: 1000, h: 600 }, 1000, true);
    expect(ctx.calls.filter((call) => call.name === 'closePath')).toHaveLength(7);
  });

  it('renders active protections from authoritative ledger state and hides dead statuses', () => {
    const ctx = createRecordingContext();
    const worms = [
      { id: 'a', alive: true, frozenTurns: 1, shieldDurability: 100, immortalityCharges: 3 },
      { id: 'b', alive: false, frozenTurns: 9, shieldDurability: 100, immortalityCharges: 3 },
    ];
    drawPowerStatuses(ctx, viewport, camera, worms, [{ id: 'a', x: 100, y: 100, alive: true }, { id: 'b', x: 200, y: 100, alive: true }], 1000);
    const labels = ctx.calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
    expect(labels).toContain('FROZEN 1');
    expect(labels).not.toContain('FROZEN 9');
    expect(ctx.calls.filter((call) => call.name === 'closePath')).toHaveLength(8);
  });
});
