/**
 * Typed event bus (architecture.md section I, core/events.ts). The event map type binds every
 * event name to its payload, so emit and on are checked at compile time.
 *
 * Listener lists are copy on write: on, once and off replace the array for that event instead
 * of splicing it, and emit iterates the array it read at the start. A listener that removes
 * itself or others while an emit is in flight therefore never skips or double fires anything in
 * that emit; the change applies from the next emit on.
 */

export type EventMap = Record<string, unknown>;

export type Listener<Payload> = (payload: Payload) => void;

export type Unsubscribe = () => void;

interface Entry<Payload> {
  readonly listener: Listener<Payload>;
  readonly once: boolean;
}

export interface EventBus<M extends EventMap> {
  on<K extends keyof M & string>(name: K, listener: Listener<M[K]>): Unsubscribe;
  once<K extends keyof M & string>(name: K, listener: Listener<M[K]>): Unsubscribe;
  /** Removes one listener; true when it was registered. */
  off<K extends keyof M & string>(name: K, listener: Listener<M[K]>): boolean;
  /** Invokes every listener registered at the start of the call; returns how many ran. */
  emit<K extends keyof M & string>(name: K, payload: M[K]): number;
  listenerCount(name?: keyof M & string): number;
  clear(): void;
}

export function createEventBus<M extends EventMap>(): EventBus<M> {
  const lists = new Map<string, readonly Entry<unknown>[]>();

  const read = (name: string): readonly Entry<unknown>[] => lists.get(name) ?? [];

  const write = (name: string, entries: readonly Entry<unknown>[]): void => {
    if (entries.length === 0) lists.delete(name);
    else lists.set(name, Object.freeze(entries));
  };

  const remove = (name: string, listener: Listener<unknown>): boolean => {
    const current = read(name);
    const next = current.filter((entry) => entry.listener !== listener);
    if (next.length === current.length) return false;
    write(name, next);
    return true;
  };

  const add = (name: string, listener: Listener<unknown>, once: boolean): Unsubscribe => {
    write(name, [...read(name), Object.freeze({ listener, once })]);
    return () => {
      remove(name, listener);
    };
  };

  return {
    on: (name, listener) => add(name, listener as Listener<unknown>, false),
    once: (name, listener) => add(name, listener as Listener<unknown>, true),
    off: (name, listener) => remove(name, listener as Listener<unknown>),
    emit: (name, payload) => {
      const snapshot = read(name);
      for (const entry of snapshot) {
        if (entry.once) remove(name, entry.listener);
        entry.listener(payload);
      }
      return snapshot.length;
    },
    listenerCount: (name) => {
      if (name !== undefined) return read(name).length;
      let total = 0;
      for (const entries of lists.values()) total += entries.length;
      return total;
    },
    clear: () => {
      lists.clear();
    },
  };
}
