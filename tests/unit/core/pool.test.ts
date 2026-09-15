import { describe, expect, it } from 'vitest';
import { createPool } from '@/core/pool.ts';

interface Particle {
  id: number;
  life: number;
}

let nextId = 0;

function makePool(capacity: number, prewarm = 0) {
  return createPool<Particle>({
    capacity,
    prewarm,
    create: () => {
      nextId += 1;
      return { id: nextId, life: 0 };
    },
    reset: (p) => {
      p.life = 0;
    },
  });
}

describe('pool: acquire and release', () => {
  it('hands out items up to the cap and then returns null', () => {
    const pool = makePool(3);
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(pool.acquire()).toBeNull();
    expect(pool.activeCount()).toBe(3);
    expect(pool.capacity).toBe(3);
  });

  it('reuses released items instead of allocating', () => {
    const pool = makePool(2);
    const a = pool.acquire();
    if (a === null) throw new Error('expected an item');
    a.life = 99;
    expect(pool.release(a)).toBe(true);
    expect(pool.freeCount()).toBe(1);
    const again = pool.acquire();
    expect(again).toBe(a);
    expect(again?.life).toBe(0);
  });

  it('rejects double release and foreign objects', () => {
    const pool = makePool(2);
    const a = pool.acquire();
    if (a === null) throw new Error('expected an item');
    expect(pool.release(a)).toBe(true);
    expect(pool.release(a)).toBe(false);
    expect(pool.release({ id: -1, life: 0 })).toBe(false);
  });

  it('prewarms without making items live', () => {
    const pool = makePool(5, 3);
    expect(pool.activeCount()).toBe(0);
    expect(pool.freeCount()).toBe(3);
    pool.acquire();
    expect(pool.freeCount()).toBe(2);
  });

  it('caps prewarm at the capacity', () => {
    const pool = makePool(2, 10);
    expect(pool.freeCount()).toBe(2);
  });

  it('rejects a non positive capacity', () => {
    expect(() => makePool(0)).toThrow(RangeError);
    expect(() => makePool(1.5)).toThrow(RangeError);
  });
});

describe('pool: iteration', () => {
  it('forEach visits only live items, contiguous after releases', () => {
    const pool = makePool(4);
    const items = [pool.acquire(), pool.acquire(), pool.acquire(), pool.acquire()].filter(
      (p): p is Particle => p !== null,
    );
    expect(items).toHaveLength(4);
    const second = items[1];
    if (second === undefined) throw new Error('expected 4 items');
    pool.release(second);
    const visited: number[] = [];
    pool.forEach((p, i) => {
      visited.push(p.id);
      expect(i).toBeLessThan(3);
    });
    expect(visited).toHaveLength(3);
    expect(visited).not.toContain(second.id);
  });

  it('sweep releases matching items during iteration without skipping any', () => {
    const pool = makePool(10);
    for (let i = 0; i < 10; i += 1) {
      const p = pool.acquire();
      if (p !== null) p.life = i;
    }
    const released = pool.sweep((p) => p.life % 2 === 0);
    expect(released).toBe(5);
    expect(pool.activeCount()).toBe(5);
    const lives: number[] = [];
    pool.forEach((p) => lives.push(p.life));
    expect(lives.sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9]);
  });

  it('clear parks everything and lets the pool refill', () => {
    const pool = makePool(3);
    pool.acquire();
    pool.acquire();
    pool.clear();
    expect(pool.activeCount()).toBe(0);
    expect(pool.freeCount()).toBe(2);
    expect(pool.acquire()).not.toBeNull();
  });
});
