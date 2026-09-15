import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '@/core/events.ts';

interface TestEvents extends Record<string, unknown> {
  readonly explode: { readonly x: number; readonly y: number; readonly radius: number };
  readonly turnStart: { readonly team: number };
  readonly ping: undefined;
}

describe('events: on, off, emit', () => {
  it('delivers payloads to every listener in registration order', () => {
    const bus = createEventBus<TestEvents>();
    const order: string[] = [];
    bus.on('explode', (p) => order.push(`a${p.radius}`));
    bus.on('explode', (p) => order.push(`b${p.radius}`));
    const ran = bus.emit('explode', { x: 1, y: 2, radius: 30 });
    expect(order).toEqual(['a30', 'b30']);
    expect(ran).toBe(2);
  });

  it('keeps events separate', () => {
    const bus = createEventBus<TestEvents>();
    const explode = vi.fn();
    const turn = vi.fn();
    bus.on('explode', explode);
    bus.on('turnStart', turn);
    bus.emit('turnStart', { team: 1 });
    expect(explode).not.toHaveBeenCalled();
    expect(turn).toHaveBeenCalledWith({ team: 1 });
  });

  it('removes with off and with the returned unsubscribe', () => {
    const bus = createEventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubscribeA = bus.on('ping', a);
    bus.on('ping', b);
    unsubscribeA();
    expect(bus.off('ping', b)).toBe(true);
    expect(bus.off('ping', b)).toBe(false);
    bus.emit('ping', undefined);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('emitting with no listeners returns 0', () => {
    const bus = createEventBus<TestEvents>();
    expect(bus.emit('ping', undefined)).toBe(0);
  });
});

describe('events: once', () => {
  it('fires exactly once and drops itself before running', () => {
    const bus = createEventBus<TestEvents>();
    const seen: number[] = [];
    bus.once('turnStart', (p) => {
      seen.push(p.team);
      expect(bus.listenerCount('turnStart')).toBe(0);
    });
    bus.emit('turnStart', { team: 1 });
    bus.emit('turnStart', { team: 2 });
    expect(seen).toEqual([1]);
  });

  it('can be removed before it fires', () => {
    const bus = createEventBus<TestEvents>();
    const fn = vi.fn();
    bus.once('ping', fn);
    expect(bus.off('ping', fn)).toBe(true);
    bus.emit('ping', undefined);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('events: mutation during emit', () => {
  it('a listener removing a later listener still lets that listener run this emit', () => {
    const bus = createEventBus<TestEvents>();
    const calls: string[] = [];
    const second = (): void => {
      calls.push('second');
    };
    bus.on('ping', () => {
      calls.push('first');
      bus.off('ping', second);
    });
    bus.on('ping', second);
    bus.emit('ping', undefined);
    expect(calls).toEqual(['first', 'second']);
    bus.emit('ping', undefined);
    expect(calls).toEqual(['first', 'second', 'first']);
  });

  it('a listener added during emit runs from the next emit on', () => {
    const bus = createEventBus<TestEvents>();
    const calls: string[] = [];
    bus.on('ping', () => {
      calls.push('outer');
      if (calls.length === 1) bus.on('ping', () => calls.push('inner'));
    });
    bus.emit('ping', undefined);
    expect(calls).toEqual(['outer']);
    bus.emit('ping', undefined);
    expect(calls).toEqual(['outer', 'outer', 'inner']);
  });

  it('clear removes everything', () => {
    const bus = createEventBus<TestEvents>();
    bus.on('ping', vi.fn());
    bus.on('turnStart', vi.fn());
    expect(bus.listenerCount()).toBe(2);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});
