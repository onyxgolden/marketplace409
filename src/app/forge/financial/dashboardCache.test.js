import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CACHE_TTL_MS,
  clearDashboardCache,
  isCacheableDashboardLoad,
  readDashboardCache,
  writeDashboardCache,
} from "./dashboardCache.js";

function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => { map.set(key, value); },
    delete: async (key) => { map.delete(key); },
    _map: map,
  };
}

function throwingStore() {
  return {
    get: async () => { throw new Error("blocked"); },
    set: async () => { throw new Error("blocked"); },
    delete: async () => { throw new Error("blocked"); },
  };
}

describe("dashboardCache", () => {
  it("returns null on a cache miss", async () => {
    expect(await readDashboardCache({ store: fakeStore() })).toBeNull();
  });

  it("round-trips a payload written and read within the TTL", async () => {
    const store = fakeStore();
    const now = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" }, intelligenceModel: {}, propertyOperatingObligations: [] };

    await writeDashboardCache(payload, { store, now });
    expect(await readDashboardCache({ store, now })).toEqual(payload);
  });

  it("treats an entry older than the TTL as a miss", async () => {
    const store = fakeStore();
    const writeNow = () => 1_000_000;
    await writeDashboardCache({ viewModel: { loadState: "ready" } }, { store, now: writeNow });

    const justPastTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS + 1;
    expect(await readDashboardCache({ store, now: justPastTtl })).toBeNull();
  });

  it("still returns the entry at exactly the TTL boundary", async () => {
    const store = fakeStore();
    const writeNow = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" } };
    await writeDashboardCache(payload, { store, now: writeNow });

    const atTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS;
    expect(await readDashboardCache({ store, now: atTtl })).toEqual(payload);
  });

  it("treats an entry missing cachedAt as a cache miss", async () => {
    const store = fakeStore({ "forge-financial-dashboard-cache-v1": { payload: { a: 1 } } });
    expect(await readDashboardCache({ store })).toBeNull();
  });

  it("no-ops instead of throwing when the store is unavailable (private browsing / IndexedDB disabled)", async () => {
    expect(await readDashboardCache({ store: null })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { store: null })).resolves.not.toThrow();
    await expect(clearDashboardCache({ store: null })).resolves.not.toThrow();
  });

  it("no-ops instead of throwing when the store's get/set/delete reject (blocked, corrupt database)", async () => {
    const store = throwingStore();
    expect(await readDashboardCache({ store })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { store })).resolves.not.toThrow();
    await expect(clearDashboardCache({ store })).resolves.not.toThrow();
  });

  it("clearDashboardCache removes a previously written entry", async () => {
    const store = fakeStore();
    await writeDashboardCache({ viewModel: { loadState: "ready" } }, { store, now: () => 1 });
    expect(await readDashboardCache({ store, now: () => 2 })).not.toBeNull();

    await clearDashboardCache({ store });
    expect(await readDashboardCache({ store, now: () => 3 })).toBeNull();
  });

  it("falls back to a clean no-op when IndexedDB is unavailable in this environment (e.g. the Node test runtime)", async () => {
    // No `store` override and no global `indexedDB` (true in this Node test environment) -- must
    // resolve to a no-op rather than throwing "indexedDB is not defined".
    expect(await readDashboardCache()).toBeNull();
    await expect(writeDashboardCache({ a: 1 })).resolves.not.toThrow();
    await expect(clearDashboardCache()).resolves.not.toThrow();
  });

  it("round-trips a payload far larger than sessionStorage's ~5MB per-origin quota -- the exact scale a real imported account's full transaction history produces, and exactly what motivated moving off sessionStorage", async () => {
    const store = fakeStore();
    const now = () => 1_000_000;
    // ~8MB of payload -- comfortably past the ~5MB ceiling this session measured sessionStorage
    // failing at, and in the range of what two real /api/financial/read-models responses decode to
    // against the real imported Stripe Financial Connections dataset.
    const bigTransactionList = Array.from({ length: 30_000 }, (_, i) => ({
      id: `txn-${i}`,
      description: `Imported transaction number ${i} with a realistically long merchant description`,
      amount: (i % 500) + 0.42,
      eventDate: "2026-01-01",
      category: "uncategorized",
    }));
    const payload = { viewModel: { loadState: "ready", transactions: bigTransactionList }, intelligenceModel: {} };
    expect(JSON.stringify(payload).length).toBeGreaterThan(4 * 1024 * 1024);

    await writeDashboardCache(payload, { store, now });
    const result = await readDashboardCache({ store, now });
    expect(result).toEqual(payload);
    expect(result.viewModel.transactions).toHaveLength(30_000);
  });

  describe("isCacheableDashboardLoad", () => {
    it("is cacheable when the view model is ready and intelligence has no error", () => {
      expect(isCacheableDashboardLoad({
        viewModel: { loadState: "ready" },
        intelligenceModel: { auditFindings: { anomalies: [] } },
      })).toBe(true);
    });

    it("is not cacheable while the view model is still loading", () => {
      expect(isCacheableDashboardLoad({
        viewModel: { loadState: "loading" },
        intelligenceModel: { auditFindings: { anomalies: [] } },
      })).toBe(false);
    });

    it("is not cacheable when the view model failed to load", () => {
      expect(isCacheableDashboardLoad({
        viewModel: { loadState: "error" },
        intelligenceModel: { auditFindings: { anomalies: [] } },
      })).toBe(false);
    });

    it("is not cacheable when dashboard intelligence reported an error", () => {
      expect(isCacheableDashboardLoad({
        viewModel: { loadState: "ready" },
        intelligenceModel: { auditFindings: { anomalies: [], error: "Unable to load dashboard intelligence." } },
      })).toBe(false);
    });
  });
});
