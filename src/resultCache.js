// Bounded, single-flight cache: failed requests are never retained.
export function createResultCache({ ttlMs = 30_000, maxEntries = 100 } = {}) {
  const entries = new Map();
  return {
    async get(key, load) {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && (hit.pending || hit.expiresAt > now)) return structuredClone(await hit.promise);
      for (const [oldKey, entry] of entries) {
        if (!entry.pending && entry.expiresAt <= now) entries.delete(oldKey);
      }
      while (entries.size >= maxEntries) {
        const oldest = [...entries].find(([, entry]) => !entry.pending);
        if (!oldest) break;
        entries.delete(oldest[0]);
      }
      // If all entries are in flight, do not grow the cache beyond its bound.
      if (entries.size >= maxEntries) return load();
      const entry = { pending: true, expiresAt: 0 };
      entry.promise = Promise.resolve().then(load).then(value => {
        entry.pending = false;
        entry.expiresAt = Date.now() + ttlMs;
        return value;
      }).catch(error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      return structuredClone(await entry.promise);
    }
  };
}
