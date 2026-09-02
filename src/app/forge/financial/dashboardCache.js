// The Financial Overview page's three parallel loads (dashboard view model, dashboard
// intelligence, property-operating obligations) take 10-15s combined on a real dataset -- see
// canonicalIntelligenceContextBuilder.build()'s read-model queries. Every full remount of the page
// (leaving the Financial tab and coming back) re-ran all three from scratch, so the owner's family
// saw that multi-second loading state on every single visit. This caches the combined result in
// sessionStorage for a short TTL so a revisit within that window renders instantly from the last
// known-good result instead of re-fetching.

const CACHE_KEY = "forge-financial-dashboard-cache-v1";
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function readDashboardCache({ storage, now = Date.now, ttlMs = DASHBOARD_CACHE_TTL_MS } = {}) {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.cachedAt !== "number") return null;
    if (now() - parsed.cachedAt > ttlMs) return null;
    return parsed.payload;
  } catch {
    // Corrupt entry, storage disabled (private browsing), or a quota error -- treat as a cache miss.
    return null;
  }
}

export function writeDashboardCache(payload, { storage, now = Date.now } = {}) {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(CACHE_KEY, JSON.stringify({ cachedAt: now(), payload }));
  } catch {
    // Storage disabled or full -- caching is a pure optimization, never worth failing the page over.
  }
}

// A transient failure shouldn't get "stuck" showing an error (or the loading fallback's default
// data) for the whole TTL window on the next visit -- only a fully successful load is worth caching.
export function isCacheableDashboardLoad({ viewModel, intelligenceModel }) {
  return viewModel?.loadState === "ready" && !intelligenceModel?.auditFindings?.error;
}

export function clearDashboardCache({ storage } = {}) {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(CACHE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
