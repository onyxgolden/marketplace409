import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Must be the first import: installs real AsyncLocalStorage before next/cache
// loads (see als-test-setup.js).
import "./als-test-setup.js";

// Regression tests for LP-001: Supabase query failures must never become
// shared successful unstable_cache entries on /market. These tests use the
// REAL next/cache unstable_cache against a synthetic in-memory
// incremental-cache backend (via globalThis.__incrementalCache, the fallback
// the implementation reads when no request store exists), plus a controllable
// Supabase stub that can fail each of the seven page queries independently.

// NOTE: next/cache is intentionally NOT mocked here (unlike
// seo-surface.test.js, which mocks it as identity). We want the real cache
// write/read path. The exact cached callback definitions under test live in
// ./_data.js (imported by the /market page).

const scenarios = vi.hoisted(() => ({
  tables: {},
  calls: [],
}));

vi.mock("@/lib/supabase", () => {
  function finishCount(table) {
    const cfg = scenarios.tables[table] || {};
    scenarios.calls.push({ table, kind: "count" });
    if (cfg.count === "throw")
      return Promise.reject(new Error(`transport failure: ${table}`));
    if (cfg.count === "error")
      return Promise.resolve({ count: null, error: { message: `db error: ${table}` } });
    return Promise.resolve({ count: cfg.countValue ?? 7, error: null });
  }
  function finishFeatured(table) {
    const cfg = scenarios.tables[table] || {};
    scenarios.calls.push({ table, kind: "featured" });
    if (cfg.featured === "throw")
      return Promise.reject(new Error(`transport failure: ${table}`));
    if (cfg.featured === "error")
      return Promise.resolve({ data: null, error: { message: `db error: ${table}` } });
    return Promise.resolve({ data: cfg.featuredRows ?? [{ id: `${table}-1` }], error: null });
  }
  function finishPet() {
    const cfg = scenarios.tables.pets || {};
    scenarios.calls.push({ table: "pets", kind: "pet" });
    if (cfg.pet === "throw")
      return Promise.reject(new Error("transport failure: pets"));
    if (cfg.pet === "error")
      return Promise.resolve({ data: null, error: { message: "db error: pets" } });
    if (cfg.pet === "none") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: cfg.petRow ?? { id: "pet-1" }, error: null });
  }
  function builder(table) {
    const b = {
      _mode: "count", // "count" until .limit() marks a featured chain
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => {
        b._mode = "featured";
        return b;
      },
      maybeSingle: () => finishPet(),
      // Thenable so terminal .select() (counts) and terminal .limit()
      // (featured rows) resolve via await.
      then: (resolve, reject) => {
        const p =
          b._mode === "featured" ? finishFeatured(table) : finishCount(table);
        p.then(resolve, reject);
      },
    };
    return b;
  }
  return { supabase: { from: (table) => builder(table) } };
});

import { getMarketplaceCounts, getMarketplaceFeatured } from "./_data.js";

// Minimal in-memory stand-in for Next's incremental cache. Matches the
// contract unstable_cache exercises: generateSimpleCacheKey, get (returns
// { value, isStale } or null), set, and isOnDemandRevalidate. Entries are
// stored exactly as cacheNewResult writes them (kind FETCH, JSON body).
function createIncrementalCache() {
  const store = new Map();
  const stats = { gets: 0, sets: 0 };
  return {
    stats,
    isOnDemandRevalidate: false,
    generateSimpleCacheKey: async (key) => `test:${key}`,
    get: async (key) => {
      stats.gets++;
      const entry = store.get(key);
      return entry ? { value: entry.value, isStale: entry.stale } : null;
    },
    set: async (key, value) => {
      stats.sets++;
      store.set(key, { value, stale: false });
    },
    markAllStale: () => {
      for (const entry of store.values()) entry.stale = true;
    },
    storedBodies: () =>
      [...store.values()].map((entry) => JSON.parse(entry.value.data.body)),
  };
}

let cache;

beforeEach(() => {
  scenarios.tables = {};
  scenarios.calls = [];
  cache = createIncrementalCache();
  globalThis.__incrementalCache = cache;
});

afterEach(() => {
  delete globalThis.__incrementalCache;
});

function callsFor(table, kind) {
  return scenarios.calls.filter((c) => c.table === table && c.kind === kind).length;
}

describe("LP-001: /market cache never persists query failures", () => {
  // Each of the seven query error paths: 4 counts + 2 featured + pet single.
  // The failing callback must reject and write nothing; the next request
  // must re-query instead of serving a cached failure.
  it.each([
    ["listings", "count", getMarketplaceCounts],
    ["businesses", "count", getMarketplaceCounts],
    ["pets", "count", getMarketplaceCounts],
    ["jobs", "count", getMarketplaceCounts],
    ["listings", "featured", getMarketplaceFeatured],
    ["businesses", "featured", getMarketplaceFeatured],
    ["pets", "pet", getMarketplaceFeatured],
  ])(
    "failed %s %s query rejects and is not cached; recovery re-queries",
    async (table, kind, cachedFn) => {
      scenarios.tables[table] = { [kind]: "error" };

      await expect(cachedFn()).rejects.toThrow(/Marketplace .* query failed/);
      expect(callsFor(table, kind)).toBe(1);
      expect(cache.stats.sets).toBe(0);
      expect(cache.storedBodies()).toHaveLength(0);

      // Recovery: heal the mock; the next call must re-query (not serve a
      // cached failure) and then cache the healthy result.
      scenarios.tables = {};
      const result = await cachedFn();
      expect(callsFor(table, kind)).toBe(2);
      expect(cache.stats.sets).toBe(1);
      expect(result).toBeDefined();

      // A third call is served from cache: no further Supabase traffic.
      const callsBefore = scenarios.calls.length;
      await cachedFn();
      expect(scenarios.calls.length).toBe(callsBefore);
    }
  );

  it("successful empty results are cached normally (zero counts, empty rows, no pet)", async () => {
    scenarios.tables = {
      listings: { countValue: 0, featuredRows: [] },
      businesses: { countValue: 0, featuredRows: [] },
      pets: { countValue: 0, pet: "none" },
      jobs: { countValue: 0 },
    };

    const counts = await getMarketplaceCounts();
    expect(counts).toEqual({
      listingsCount: 0,
      businessesCount: 0,
      petsCount: 0,
      jobsCount: 0,
    });
    const featured = await getMarketplaceFeatured();
    expect(featured.featuredListings).toEqual([]);
    expect(featured.petOfTheWeek).toBeNull();
    expect(cache.stats.sets).toBe(2);

    const callsAfterFirst = scenarios.calls.length;
    expect(callsAfterFirst).toBe(7);
    await getMarketplaceCounts();
    await getMarketplaceFeatured();
    expect(scenarios.calls.length).toBe(callsAfterFirst);
  });

  it("cold failure then healthy request: recovery populates the missing entry", async () => {
    scenarios.tables = {
      listings: { count: "error" },
      businesses: { featured: "error" },
    };

    await expect(getMarketplaceCounts()).rejects.toThrow();
    await expect(getMarketplaceFeatured()).rejects.toThrow();
    expect(cache.stats.sets).toBe(0);
    expect(cache.storedBodies()).toHaveLength(0);

    scenarios.tables = {}; // database recovers
    const counts = await getMarketplaceCounts();
    expect(counts.listingsCount).toBe(7);
    const featured = await getMarketplaceFeatured();
    expect(featured.featuredListings).toEqual([{ id: "listings-1" }]);
    expect(cache.stats.sets).toBe(2);
  });

  it("failed refresh leaves the last successful entry available", async () => {
    const goodCounts = await getMarketplaceCounts();
    await getMarketplaceFeatured();
    expect(cache.stats.sets).toBe(2);
    const goodBodies = cache.storedBodies();

    // Entries go stale; the database then fails.
    cache.markAllStale();
    scenarios.tables = {
      listings: { count: "error" },
      pets: { pet: "error" },
    };
    await expect(getMarketplaceCounts()).rejects.toThrow();
    await expect(getMarketplaceFeatured()).rejects.toThrow();

    // No new entry was written; the good data is still what is stored.
    expect(cache.stats.sets).toBe(2);
    expect(cache.storedBodies()).toEqual(goodBodies);
    expect(goodBodies.some((b) => b.listingsCount === goodCounts.listingsCount)).toBe(true);
  });

  it("asynchronous thrown error (transport failure) is not cached", async () => {
    scenarios.tables = { jobs: { count: "throw" } };

    await expect(getMarketplaceCounts()).rejects.toThrow("transport failure: jobs");
    expect(callsFor("jobs", "count")).toBe(1);
    expect(cache.stats.sets).toBe(0);

    scenarios.tables = {};
    const counts = await getMarketplaceCounts();
    expect(counts.jobsCount).toBe(7);
    expect(cache.stats.sets).toBe(1);
  });

  it("a failure in one callback does not poison the other", async () => {
    scenarios.tables = { listings: { count: "error" } };

    await expect(getMarketplaceCounts()).rejects.toThrow();
    const featured = await getMarketplaceFeatured();
    expect(featured.featuredListings).toEqual([{ id: "listings-1" }]);
    expect(cache.stats.sets).toBe(1);
    expect(cache.storedBodies()).toHaveLength(1);
  });
});
