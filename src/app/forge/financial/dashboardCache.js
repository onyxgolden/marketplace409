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

const CACHE_KEY = "forge-financial-dashboard-cache-v1";
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

const DB_NAME = "forge-financial-dashboard-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";

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

export async function readDashboardCache({ store, now = Date.now, ttlMs = DASHBOARD_CACHE_TTL_MS } = {}) {
  const target = resolveStore(store);
  if (!target) return null;
  try {
    const entry = await target.get(CACHE_KEY);
    if (!entry || typeof entry.cachedAt !== "number") return null;
    if (now() - entry.cachedAt > ttlMs) return null;
    return entry.payload;
  } catch {
    // Corrupt entry, storage disabled (private browsing), or an unexpected IndexedDB error -- treat
    // as a cache miss rather than failing the page over it.
    return null;
  }
}

export async function writeDashboardCache(payload, { store, now = Date.now } = {}) {
  const target = resolveStore(store);
  if (!target) return;
  try {
    await target.set(CACHE_KEY, { cachedAt: now(), payload });
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

export async function clearDashboardCache({ store } = {}) {
  const target = resolveStore(store);
  if (!target) return;
  try {
    await target.delete(CACHE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
