// The Financial Overview page's three parallel loads (dashboard view model, dashboard
// intelligence, property-operating obligations) take 10-15s combined on a real dataset -- see
// canonicalIntelligenceContextBuilder.build()'s read-model queries. Every full remount of the page
// (leaving the Financial tab and coming back) re-ran all three from scratch, so the owner's family
// saw that multi-second loading state on every single visit. This caches the combined result for a
// short TTL so a revisit within that window renders instantly from the last known-good result
// instead of re-fetching.
//
// IndexedDB, not sessionStorage (revised after the real account import): the cached payload
// includes the full transaction read-models behind the dashboard, and against the real imported
// account data that payload can run several megabytes -- comfortably past sessionStorage's ~5MB
// per-origin quota. A write past quota threw QuotaExceededError, which the original version caught
// and treated as "caching is a pure optimization, never worth failing the page over" -- correct
// per-write, but it meant every write silently failed against real data, so every single visit paid
// the full 10-15s+ cold load despite the cache existing and reporting no error. IndexedDB's quota is
// a large fraction of available disk (far beyond anything this payload will reach), so the cache
// actually holds against real data volume. Reads/writes are necessarily async now (IndexedDB has no
// synchronous API); callers await them.
//
// Per-user key isolation (added after re-review): unlike sessionStorage, IndexedDB survives a tab
// close and even a browser restart -- it is NOT automatically wiped when someone simply closes the
// tab instead of clicking Sign Out. The cache key is scoped to the authenticated user's id
// (buildCacheKey), so one user's cached financial data physically cannot be looked up under a
// different user's key -- a shared device where the previous person never signed out, and someone
// else opens /forge/financial, gets a clean miss (their own key has never been written) rather than
// the previous person's stale figures. `userId` is required precisely so this can't be forgotten at
// a call site; there is no "unscoped" fallback key.
const CACHE_KEY_PREFIX = "forge-financial-dashboard-cache-v1";
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

// Bumped whenever the shape of the cached `payload` (viewModel/intelligenceModel/
// propertyOperatingObligations) changes incompatibly, so a cache entry written by a previous
// deployment is never handed to code expecting the new shape -- it reads as a clean miss instead of
// risking a runtime error or a subtly wrong render from stale-shaped data. Also deliberately bumped
// (2, from 1) alongside 20260911010000_correct_rentec_2005_dates_to_2015.sql, even though the
// payload's own shape did not change: this is the only lever this client-side cache has to react to
// a server-side DATA correction rather than a code-shape change. Without the bump, up to 5 more
// minutes of DASHBOARD_CACHE_TTL_MS could still show a stale 2005-dated payload cached moments
// before that migration ran; since this bump ships in the same deploy as the corrected chart-year
// logic, every previously-cached entry (all necessarily stamped schemaVersion 1) becomes an instant
// miss the moment this code is live, independent of exactly when the migration itself applies.
const PAYLOAD_SCHEMA_VERSION = 2;

const DB_NAME = "forge-financial-dashboard-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";

function buildCacheKey(userId) {
  return `${CACHE_KEY_PREFIX}:${userId}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Fires when another tab holds an open connection at an older DB_VERSION, blocking this
    // upgrade -- without a handler the open request neither resolves nor rejects, so every
    // read/write here would hang forever instead of falling back to a cache miss. Rejecting lets
    // the existing try/catch in each exported function treat it the same as any other failure.
    request.onblocked = () => reject(new Error("forge-financial-dashboard-cache: open blocked by another connection"));
  });
}

async function withStore(mode, run) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = run(store);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } else {
        transaction.oncomplete = () => resolve(undefined);
      }
    });
  } finally {
    db.close();
  }
}

// The real store: only constructed when a real IndexedDB is available (browser, not the Node test
// environment or a private-browsing context that has disabled it).
const indexedDbStore = {
  get: (key) => withStore("readonly", (store) => store.get(key)),
  set: (key, value) => withStore("readwrite", (store) => store.put(value, key)),
  delete: (key) => withStore("readwrite", (store) => store.delete(key)),
};

function resolveStore(store) {
  if (store !== undefined) return store;
  return typeof indexedDB === "undefined" ? null : indexedDbStore;
}

export async function readDashboardCache({ userId, store, now = Date.now, ttlMs = DASHBOARD_CACHE_TTL_MS }) {
  if (!userId) return null;
  const target = resolveStore(store);
  if (!target) return null;
  try {
    const entry = await target.get(buildCacheKey(userId));
    if (!entry || typeof entry.cachedAt !== "number") return null;
    if (entry.schemaVersion !== PAYLOAD_SCHEMA_VERSION) return null;
    if (now() - entry.cachedAt > ttlMs) return null;
    return entry.payload;
  } catch {
    // Corrupt entry, storage disabled (private browsing), a blocked/failed open, or an unexpected
    // IndexedDB error -- treat as a cache miss rather than failing the page over it.
    return null;
  }
}

export async function writeDashboardCache(payload, { userId, store, now = Date.now }) {
  if (!userId) return;
  const target = resolveStore(store);
  if (!target) return;
  try {
    await target.set(buildCacheKey(userId), { cachedAt: now(), schemaVersion: PAYLOAD_SCHEMA_VERSION, payload });
  } catch {
    // Storage disabled, blocked, or an unexpected error -- caching is a pure optimization, never
    // worth failing the page over.
  }
}

// A transient failure shouldn't get "stuck" showing an error (or the loading fallback's default
// data) for the whole TTL window on the next visit -- only a fully successful load is worth caching.
export function isCacheableDashboardLoad({ viewModel, intelligenceModel }) {
  return viewModel?.loadState === "ready" && !intelligenceModel?.auditFindings?.error;
}

export async function clearDashboardCache({ userId, store }) {
  if (!userId) return;
  const target = resolveStore(store);
  if (!target) return;
  try {
    await target.delete(buildCacheKey(userId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
