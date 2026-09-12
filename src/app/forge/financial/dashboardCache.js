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
// Key isolation is by (actingUserId, canonicalWorkspaceId), not acting-user id alone (revised after
// review): FORGE has canonical owners, active co-owner membership, and role-based shared workspace
// access -- one authenticated user can be authorized within only one canonical workspace at a time,
// but which one is server-resolved and can change (a co-owner's membership can move or be revoked).
// `canonicalWorkspaceId` must be the exact value resolveEffectiveOwnerId()/
// createAuthenticatedFinancialApplication() already resolve for real Financial FORGE authorization
// (see /api/financial/workspace-identity, the only legitimate source for it) -- never a
// client-supplied or client-inferred value. Both ids are required on every call precisely so a
// caller cannot forget one and fall back to an under-scoped key.
//
// This is application-level cache separation, not an absolute security boundary: it relies on the
// caller always supplying a genuinely server-resolved workspace id (a caller that ignored this and
// passed a fabricated one would defeat it, the same way any client-side check can be defeated by a
// caller that doesn't call it correctly) and on IndexedDB's own same-origin storage guarantees. It
// is not a substitute for -- and makes no claim to replace -- server-side authorization, which is
// what actually protects the underlying data on every real request regardless of this cache.
const CACHE_KEY_PREFIX = "financial-dashboard";
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

// Bumped whenever the shape of the cached `payload` (viewModel/intelligenceModel/
// propertyOperatingObligations) changes incompatibly, so a cache entry written by a previous
// deployment is never handed to code expecting the new shape -- it reads as a clean miss instead of
// risking a runtime error or a subtly wrong render from stale-shaped data. Embedded directly in the
// cache key (not just checked against a stored field) so a version bump also acts as an instant,
// deploy-triggered invalidation of every previously-cached entry, independent of the 5-minute TTL --
// exactly what was needed to retire stale, pre-repair cached data the moment
// 20260911010000_correct_rentec_2005_dates_to_2015.sql's corrected code shipped, without waiting up
// to 5 more minutes for the TTL to catch up.
const PAYLOAD_SCHEMA_VERSION = 2;

const DB_NAME = "forge-financial-dashboard-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";

function buildCacheKey(actingUserId, canonicalWorkspaceId) {
  return `${CACHE_KEY_PREFIX}:${PAYLOAD_SCHEMA_VERSION}:${actingUserId}:${canonicalWorkspaceId}`;
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
  clear: () => withStore("readwrite", (store) => store.clear()),
};

function resolveStore(store) {
  if (store !== undefined) return store;
  return typeof indexedDB === "undefined" ? null : indexedDbStore;
}

export async function readDashboardCache({ actingUserId, canonicalWorkspaceId, store, now = Date.now, ttlMs = DASHBOARD_CACHE_TTL_MS }) {
  if (!actingUserId || !canonicalWorkspaceId) return null;
  const target = resolveStore(store);
  if (!target) return null;
  try {
    const entry = await target.get(buildCacheKey(actingUserId, canonicalWorkspaceId));
    if (!entry || typeof entry.cachedAt !== "number") return null;
    // Defense in depth alongside the version already embedded in the key -- see PAYLOAD_SCHEMA_VERSION.
    if (entry.schemaVersion !== PAYLOAD_SCHEMA_VERSION) return null;
    if (now() - entry.cachedAt > ttlMs) return null;
    return entry.payload;
  } catch {
    // Corrupt entry, storage disabled (private browsing), a blocked/failed open, or an unexpected
    // IndexedDB error -- treat as a cache miss rather than failing the page over it.
    return null;
  }
}

export async function writeDashboardCache(payload, { actingUserId, canonicalWorkspaceId, store, now = Date.now }) {
  if (!actingUserId || !canonicalWorkspaceId) return;
  const target = resolveStore(store);
  if (!target) return;
  try {
    await target.set(buildCacheKey(actingUserId, canonicalWorkspaceId), { cachedAt: now(), schemaVersion: PAYLOAD_SCHEMA_VERSION, payload });
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

// Wipes every entry in the store, not just one (actingUserId, canonicalWorkspaceId) key -- called on
// sign-out specifically to protect a shared device: if a browser is used by more than one person, a
// sign-out is exactly the moment to guarantee NOTHING this cache ever held for ANYONE survives, not
// only the pair that happened to just sign out. This is deliberately unconditional and requires no
// identity to call -- there is no scenario where a sign-out should leave any cached financial data
// behind for the next person on the same device.
export async function clearDashboardCache({ store } = {}) {
  const target = resolveStore(store);
  if (!target) return;
  try {
    await target.clear();
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
