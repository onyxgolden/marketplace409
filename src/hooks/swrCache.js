// Shared stale-while-revalidate cache for client data fetching.
//
// Problem it solves: every panel used `useState(null)` + fetch-on-mount, so switching
// properties/tenants (often with a `key={...}` remount) blanked the screen to
// "Loading…" even for data viewed seconds ago. This module keeps the last good
// payload per key, serves it synchronously on (re)mount, and revalidates in the
// background — the UI never loses old data while refreshing.
//
// The React binding lives in ./useStaleWhileRevalidate.js; the logic here is pure
// module state so it is unit-testable in node without a renderer.

const entries = new Map(); // key -> { data, error, updatedAt }
const inflight = new Map(); // key -> Promise (dedupe concurrent fetches)
const versions = new Map(); // key -> int (drop stale resolutions after invalidate)
const listeners = new Map(); // key -> Set<() => void>

function notify(key) {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch {
      // A misbehaving subscriber must not break the cache for everyone else.
    }
  }
}

export function getCacheEntry(key) {
  return entries.get(key);
}

/**
 * Synchronously seed a cache entry, e.g. from parent-supplied initial data.
 * First writer wins: never clobbers live data. The seeded entry is fresh, so
 * the hook serves it instantly on mount without a refetch, while refresh()
 * keeps working because the key stays live.
 */
export function seedCacheEntry(key, data) {
  if (key == null || entries.has(key)) return;
  entries.set(key, { data: data ?? null, error: "", updatedAt: Date.now() });
}

export function isInflight(key) {
  return inflight.has(key);
}

export function isFresh(key, ttlMs) {
  const entry = entries.get(key);
  if (!entry) return false;
  if (!(ttlMs > 0)) return true;
  return Date.now() - entry.updatedAt < ttlMs;
}

/** Subscribe to cache updates for a key. Returns an unsubscribe function. */
export function subscribe(key, fn) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(key);
  };
}

function setEntry(key, patch) {
  const prev = entries.get(key);
  entries.set(key, { data: null, error: "", updatedAt: Date.now(), ...prev, ...patch });
  notify(key);
}

/**
 * Fetch for a key, deduping concurrent callers onto one promise. On success the
 * entry is replaced; on failure the previous data is kept and the error is
 * surfaced — callers never lose the last good payload to a failed refresh.
 * A resolution that arrives after invalidate() for the same key is dropped.
 */
export function fetchWithDedupe(key, fetcher) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  const promise = Promise.resolve()
    .then(() => fetcher())
    .then(
      (data) => {
        // Identity-aware cleanup: an orphaned request (e.g. one invalidated while
        // a newer request for the same key started) must not delete the newer
        // request's in-flight entry.
        if (inflight.get(key) === promise) inflight.delete(key);
        if (versions.get(key) !== version) return data; // invalidated since — drop
        setEntry(key, { data, error: "", updatedAt: Date.now() });
        return data;
      },
      (error) => {
        if (inflight.get(key) === promise) inflight.delete(key);
        if (versions.get(key) !== version) throw error; // invalidated since — drop
        const prev = entries.get(key);
        setEntry(key, {
          data: prev?.data ?? null,
          error: error?.message || "Unable to load.",
          updatedAt: Date.now(),
        });
        throw error;
      },
    );
  inflight.set(key, promise);
  notify(key); // flip isRefreshing immediately
  return promise;
}

/** Drop the cached entry so the next read refetches. In-flight work is orphaned. */
export function invalidate(key) {
  versions.set(key, (versions.get(key) ?? 0) + 1);
  inflight.delete(key);
  entries.delete(key);
  notify(key);
}

/** Invalidate every key starting with prefix (e.g. "property-expenses:"). */
export function invalidatePrefix(prefix) {
  for (const key of [...entries.keys(), ...inflight.keys(), ...versions.keys()]) {
    if (key.startsWith(prefix)) invalidate(key);
  }
}

/**
 * Warm the cache in the background when the entry is missing or stale
 * (hover prefetch on cards, etc.). Never throws; never notifies on no-op.
 */
export function prefetch(key, fetcher, ttlMs = 0) {
  if (isFresh(key, ttlMs)) return Promise.resolve(getCacheEntry(key)?.data ?? null);
  return fetchWithDedupe(key, fetcher).catch(() => getCacheEntry(key)?.data ?? null);
}

/** Test/utility escape hatch: clear all cached state. */
export function clearSWRCache() {
  entries.clear();
  inflight.clear();
  versions.clear();
  listeners.clear();
}
