/** Serializes work per key. PostgreSQL implementation uses session advisory locks (design decision 3). */
export interface LockManager {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Runs fn only if the lock is free right now; returns null otherwise. */
  tryWithLock<T>(key: string, fn: () => Promise<T>): Promise<T | null>;
}

export const businessLockKey = (businessId: string): string => `business:${businessId}`;
export const turnLockKey = (businessId: string): string => `turn:${businessId}`;

export class MemoryLockManager implements LockManager {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly held = new Set<string>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    this.held.add(key);
    try {
      return await fn();
    } finally {
      this.held.delete(key);
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  async tryWithLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (this.held.has(key) || this.tails.has(key)) {
      return null;
    }
    return this.withLock(key, fn);
  }
}
