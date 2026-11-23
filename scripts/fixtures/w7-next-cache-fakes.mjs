// W7-a offline test double for next/cache (fabricated data only). It follows the unstable_cache semantics that the W7-a
// fix relies on, as read in next@15.5.22 dist/server/web/spec-extension/unstable-cache.js:
//   - a fresh entry is returned without calling the function;
//   - a missing entry calls the function and stores its result only when it resolves (a throw propagates, nothing is stored);
//   - a stale entry is returned at once and refreshed in the background; a failed refresh keeps the stale entry.
// Concurrent misses are not de-duplicated (neither are they in Next). Time comes from globalThis.__w7cache.now.
const store = () => globalThis.__w7cache;

export function resetW7Cache() {
  globalThis.__w7cache = { now: 0, entries: new Map(), sets: [], pending: [] };
}
resetW7Cache();

export function unstable_cache(fn, keyParts, options = {}) {
  const key = (keyParts ?? []).join(",");
  const revalidate = typeof options.revalidate === "number" ? options.revalidate : Infinity;
  const save = (value) => {
    const s = store();
    s.entries.set(key, { value: structuredClone(value), at: s.now, tags: options.tags ?? [] });
    s.sets.push(key);
  };
  return async (...args) => {
    const s = store();
    const entry = s.entries.get(key);
    if (entry && s.now - entry.at < revalidate) return structuredClone(entry.value);
    if (entry) {
      s.pending.push(fn(...args).then(save, () => {}));
      return structuredClone(entry.value);
    }
    const value = await fn(...args);
    save(value);
    return structuredClone(value);
  };
}

export function revalidateTag(tag) {
  for (const [key, entry] of store().entries) if (entry.tags.includes(tag)) store().entries.delete(key);
}
export function revalidatePath() {}
