/**
 * Generic object pool (architecture.md section I: "mutation justified by allocation churn").
 * Particles, projectiles and kinematic bodies are acquired and released hundreds of times per
 * second; allocating them would make the GC pause the very frames the loop cannot afford.
 *
 * MUTATION NOTE: this is one of the two places in the codebase that mutates in place on purpose
 * (the other is per frame hot paths that say so). The pool owns a dense array partitioned into
 * [0, active) live items and [active, length) parked items, and swaps on release so iteration
 * over live items is contiguous. Items handed out are mutable by design; callers reset them
 * through the reset hook, never by replacing the object.
 */

export interface PoolOptions<T extends object> {
  /** Hard cap on live items; acquire returns null past it instead of allocating. */
  readonly capacity: number;
  readonly create: () => T;
  /** Runs on release so a parked item carries no stale state into its next life. */
  readonly reset?: (item: T) => void;
  /** Items allocated up front so the first frames do not pay the allocations. */
  readonly prewarm?: number;
}

export interface Pool<T extends object> {
  readonly capacity: number;
  activeCount(): number;
  /** Parked items ready to be reused without allocating. */
  freeCount(): number;
  /** A live item, or null when the pool is at capacity. */
  acquire(): T | null;
  /** Parks an item; false when it was not live (double release or foreign object). */
  release(item: T): boolean;
  /** Visits live items. Do not release inside the callback; use sweep for that. */
  forEach(visit: (item: T, index: number) => void): void;
  /** Releases every live item the predicate accepts; safe during iteration. Returns the count. */
  sweep(shouldRelease: (item: T) => boolean): number;
  /** Parks every live item. */
  clear(): void;
}

export function createPool<T extends object>(options: PoolOptions<T>): Pool<T> {
  const { capacity, create, reset } = options;
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(`pool capacity must be a positive integer, got ${String(capacity)}`);
  }
  const prewarm = Math.min(capacity, Math.max(0, options.prewarm ?? 0));

  // Mutable pool state (see the file comment).
  const items: T[] = [];
  const indexOf = new Map<T, number>();
  let active = 0;

  for (let i = 0; i < prewarm; i += 1) {
    const item = create();
    indexOf.set(item, items.length);
    items.push(item);
  }

  const swap = (a: number, b: number): void => {
    if (a === b) return;
    const itemA = items[a];
    const itemB = items[b];
    if (itemA === undefined || itemB === undefined) return;
    items[a] = itemB;
    items[b] = itemA;
    indexOf.set(itemB, a);
    indexOf.set(itemA, b);
  };

  const releaseAt = (index: number): void => {
    const item = items[index];
    if (item === undefined) return;
    swap(index, active - 1);
    active -= 1;
    reset?.(item);
  };

  return {
    capacity,
    activeCount: () => active,
    freeCount: () => items.length - active,
    acquire: () => {
      if (active >= capacity) return null;
      if (active === items.length) {
        const item = create();
        indexOf.set(item, items.length);
        items.push(item);
      }
      const item = items[active];
      if (item === undefined) return null;
      active += 1;
      return item;
    },
    release: (item) => {
      const index = indexOf.get(item);
      if (index === undefined || index >= active) return false;
      releaseAt(index);
      return true;
    },
    forEach: (visit) => {
      for (let i = 0; i < active; i += 1) {
        const item = items[i];
        if (item !== undefined) visit(item, i);
      }
    },
    sweep: (shouldRelease) => {
      let released = 0;
      // Walk backwards so the swap on release never moves an unvisited item behind the cursor.
      for (let i = active - 1; i >= 0; i -= 1) {
        const item = items[i];
        if (item !== undefined && shouldRelease(item)) {
          releaseAt(i);
          released += 1;
        }
      }
      return released;
    },
    clear: () => {
      for (let i = active - 1; i >= 0; i -= 1) releaseAt(i);
    },
  };
}
