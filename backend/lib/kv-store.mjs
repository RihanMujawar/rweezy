/**
 * A generic Key-Value store interface for state management.
 * In production, this can be swapped with a Redis-backed implementation.
 */
export class KVStore {
  async get(key) { throw new Error("Not implemented"); }
  async set(key, value, ttlMs) { throw new Error("Not implemented"); }
  async delete(key) { throw new Error("Not implemented"); }
  async increment(key, windowMs) { throw new Error("Not implemented"); }
}

export class MemoryKVStore extends KVStore {
  constructor() {
    super();
    this.data = new Map();
  }

  async get(key) {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlMs) {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.data.set(key, { value, expiresAt });
  }

  async delete(key) {
    this.data.delete(key);
  }

  async increment(key, windowMs) {
    const now = Date.now();
    let entry = this.data.get(key);
    if (!entry || (entry.expiresAt && entry.expiresAt < now)) {
      entry = { value: 0, expiresAt: now + windowMs };
    }
    entry.value += 1;
    this.data.set(key, entry);
    return entry.value;
  }
}

// Global instance for the application
export const store = new MemoryKVStore();
