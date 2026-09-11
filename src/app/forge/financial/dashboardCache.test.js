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

const USER_A = "user-aaaaaaaa-1111-1111-1111-111111111111";
const USER_B = "user-bbbbbbbb-2222-2222-2222-222222222222";

describe("dashboardCache", () => {
  it("returns null on a cache miss", async () => {
    expect(await readDashboardCache({ userId: USER_A, store: fakeStore() })).toBeNull();
  });

  it("round-trips a payload written and read within the TTL, for the same user", async () => {
    const store = fakeStore();
    const now = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" }, intelligenceModel: {}, propertyOperatingObligations: [] };

    await writeDashboardCache(payload, { userId: USER_A, store, now });
    expect(await readDashboardCache({ userId: USER_A, store, now })).toEqual(payload);
  });

  it("treats an entry older than the TTL as a miss", async () => {
    const store = fakeStore();
    const writeNow = () => 1_000_000;
    await writeDashboardCache({ viewModel: { loadState: "ready" } }, { userId: USER_A, store, now: writeNow });

    const justPastTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS + 1;
    expect(await readDashboardCache({ userId: USER_A, store, now: justPastTtl })).toBeNull();
  });

  it("still returns the entry at exactly the TTL boundary", async () => {
    const store = fakeStore();
    const writeNow = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" } };
    await writeDashboardCache(payload, { userId: USER_A, store, now: writeNow });

    const atTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS;
    expect(await readDashboardCache({ userId: USER_A, store, now: atTtl })).toEqual(payload);
  });

  it("treats an entry missing cachedAt as a cache miss", async () => {
    const store = fakeStore({ [`forge-financial-dashboard-cache-v1:${USER_A}`]: { payload: { a: 1 } } });
    expect(await readDashboardCache({ userId: USER_A, store })).toBeNull();
  });

  it("no-ops instead of throwing when the store is unavailable (private browsing / IndexedDB disabled)", async () => {
    expect(await readDashboardCache({ userId: USER_A, store: null })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { userId: USER_A, store: null })).resolves.not.toThrow();
    await expect(clearDashboardCache({ userId: USER_A, store: null })).resolves.not.toThrow();
  });

  it("no-ops instead of throwing when the store's get/set/delete reject (blocked, corrupt database)", async () => {
    const store = throwingStore();
    expect(await readDashboardCache({ userId: USER_A, store })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { userId: USER_A, store })).resolves.not.toThrow();
    await expect(clearDashboardCache({ userId: USER_A, store })).resolves.not.toThrow();
  });

  it("clearDashboardCache removes a previously written entry", async () => {
    const store = fakeStore();
    await writeDashboardCache({ viewModel: { loadState: "ready" } }, { userId: USER_A, store, now: () => 1 });
    expect(await readDashboardCache({ userId: USER_A, store, now: () => 2 })).not.toBeNull();

    await clearDashboardCache({ userId: USER_A, store });
    expect(await readDashboardCache({ userId: USER_A, store, now: () => 3 })).toBeNull();
  });

  it("falls back to a clean no-op when IndexedDB is unavailable in this environment (e.g. the Node test runtime)", async () => {
    // No `store` override and no global `indexedDB` (true in this Node test environment) -- must
    // resolve to a no-op rather than throwing "indexedDB is not defined".
    expect(await readDashboardCache({ userId: USER_A })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { userId: USER_A })).resolves.not.toThrow();
    await expect(clearDashboardCache({ userId: USER_A })).resolves.not.toThrow();
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

    await writeDashboardCache(payload, { userId: USER_A, store, now });
    const result = await readDashboardCache({ userId: USER_A, store, now });
    expect(result).toEqual(payload);
    expect(result.viewModel.transactions).toHaveLength(30_000);
  });

  describe("per-user isolation (a shared device where the previous person never explicitly signed out)", () => {
    it("never returns another user's cached payload, even within the TTL, even in the same store", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      const userAPayload = { viewModel: { loadState: "ready", owner: "A" } };
      await writeDashboardCache(userAPayload, { userId: USER_A, store, now });

      expect(await readDashboardCache({ userId: USER_B, store, now })).toBeNull();
      expect(await readDashboardCache({ userId: USER_A, store, now })).toEqual(userAPayload);
    });

    it("lets two different users each have their own independently-cached payload in the same store at once", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      const userAPayload = { viewModel: { loadState: "ready", owner: "A" } };
      const userBPayload = { viewModel: { loadState: "ready", owner: "B" } };

      await writeDashboardCache(userAPayload, { userId: USER_A, store, now });
      await writeDashboardCache(userBPayload, { userId: USER_B, store, now });

      expect(await readDashboardCache({ userId: USER_A, store, now })).toEqual(userAPayload);
      expect(await readDashboardCache({ userId: USER_B, store, now })).toEqual(userBPayload);
    });

    it("clearing one user's cache on sign-out never touches another user's still-valid entry", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      await writeDashboardCache({ viewModel: { owner: "A" } }, { userId: USER_A, store, now });
      await writeDashboardCache({ viewModel: { owner: "B" } }, { userId: USER_B, store, now });

      await clearDashboardCache({ userId: USER_A, store });

      expect(await readDashboardCache({ userId: USER_A, store, now })).toBeNull();
      expect(await readDashboardCache({ userId: USER_B, store, now })).toEqual({ viewModel: { owner: "B" } });
    });

    it("treats a missing userId as a hard no-op on every operation, rather than falling back to an unscoped shared key", async () => {
      const store = fakeStore();
      await expect(writeDashboardCache({ a: 1 }, { userId: null, store })).resolves.not.toThrow();
      expect(await readDashboardCache({ userId: null, store })).toBeNull();
      await expect(clearDashboardCache({ userId: undefined, store })).resolves.not.toThrow();
      // Confirms nothing was ever actually written under any key for the missing-userId calls.
      expect(store._map.size).toBe(0);
    });
  });

  describe("payload schema versioning", () => {
    it("treats an entry written under a different schema version as a miss, not a malformed-shape crash", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      await writeDashboardCache({ viewModel: { loadState: "ready" } }, { userId: USER_A, store, now });

      // Simulate a future deploy bumping PAYLOAD_SCHEMA_VERSION by directly corrupting the stored
      // entry's version stamp -- the point is that readDashboardCache must not hand this back.
      const key = [...store._map.keys()][0];
      const entry = store._map.get(key);
      store._map.set(key, { ...entry, schemaVersion: entry.schemaVersion + 1 });

      expect(await readDashboardCache({ userId: USER_A, store, now })).toBeNull();
    });
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
