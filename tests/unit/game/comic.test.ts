import { describe, expect, it } from 'vitest';
import { advanceComic, applyComicEvents, comicSay, createComic, drainComicCues, drawComicScreen, popScale, wrapLines, PANEL_MS } from '@/game/comic.ts';
import type { GameEvent } from '@/game/controller.ts';

const lookup = { nameOf: (id: string) => (id === 'w1' ? 'Raúl' : 'Ana') };

describe('comic layer', () => {
  it('slams a panel in when a beam super starts and a splat when it fires', () => {
    const c = createComic();
    const events: GameEvent[] = [
      { type: 'beamStart', beamId: 1, weapon: 'kamehameha', attackerId: 'w1', x: 0, y: 0, dx: 1, dy: 0 },
      { type: 'beamFire', beamId: 1, attackerId: 'w1', x: 0, y: 0, dx: 1, dy: 0 },
    ];
    applyComicEvents(c, events, lookup);
    expect(c.panels[0]?.caption).toBe('RAÚL CARGA SU PODER...');
    expect(c.splats[0]?.text).toBe('¡HAAAAA!');
  });

  it('gives the supers that cost health a panel of their own', () => {
    const c = createComic();
    applyComicEvents(c, [{ type: 'toll', wormId: 'w1', lost: 50, fatal: false, x: 0, y: 0 }], lookup);
    expect(c.panels[0]?.title).toBe('¡PENITENCIA!');
  });

  it('counts steps, clicks while the AI calculates, and lets panels expire', () => {
    const c = createComic();
    applyComicEvents(
      c,
      [
        { type: 'step', wormId: 'w1', n: 1, total: 3, x: 0, y: 0 },
        { type: 'aiScan', wormId: 'w1', name: 'Raúl', weapon: 'kamehameha', targets: [{ id: 'w2', x: 10, y: 0 }], targetId: 'w2', angleDeg: 30, power: 0.8, confidence: 0.7, message: '¡Toma!', ticks: 120, x: 0, y: 0 },
      ],
      lookup,
    );
    expect(c.steps).toHaveLength(1);
    expect(c.bubbles[0]?.text).toBe('¡Toma!');
    for (let i = 0; i < 200; i += 1) advanceComic(c, 1000 / 60);
    const cues = drainComicCues(c);
    expect(cues.filter((cue) => cue === 'ui_select_click').length).toBeGreaterThanOrEqual(3);
    expect(cues).toContain('ui_confirm');
    for (let i = 0; i < Math.ceil(PANEL_MS / 16) + 300; i += 1) advanceComic(c, 1000 / 60);
    expect(c.panels).toHaveLength(0);
    expect(c.steps).toHaveLength(0);
  });

  it('keeps one bubble per worm', () => {
    const c = createComic();
    comicSay(c, 'w1', 'uno');
    comicSay(c, 'w1', 'dos');
    expect(c.bubbles.map((b) => b.text)).toEqual(['dos']);
  });

  it('pops in with an overshoot and wraps long lines', () => {
    expect(popScale(0)).toBe(0);
    expect(popScale(120)).toBeGreaterThan(1);
    expect(popScale(500)).toBe(1);
    expect(wrapLines('uno dos tres cuatro cinco seis', 9)).toEqual(['uno dos', 'tres', 'cuatro', 'cinco'].slice(0, 4));
  });

  it('draws without throwing on a minimal context', () => {
    const c = createComic();
    applyComicEvents(c, [{ type: 'comboStart', comboId: 1, weapon: 'ryuko_ranbu', attackerId: 'w1', victimId: 'w2', x: 0, y: 0 }, { type: 'gib', wormId: 'w2', x: 0, y: 0, vx: 0, vy: 0, colorIndex: 0 }], lookup);
    advanceComic(c, 100);
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => calls.push(String(key))),
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      },
    });
    drawComicScreen(ctx as never, c, { w: 800, h: 600 });
    expect(calls).toContain('fillText');
  });
});
