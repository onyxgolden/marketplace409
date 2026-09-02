import { describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_CACHE_TTL_MS,
  clearDashboardCache,
  isCacheableDashboardLoad,
  readDashboardCache,
  writeDashboardCache,
} from "./dashboardCache.js";

function fakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    _store: store,
  };
}

describe("dashboardCache", () => {
  it("returns null on a cache miss", () => {
    expect(readDashboardCache({ storage: fakeStorage() })).toBeNull();
  });

  it("round-trips a payload written and read within the TTL", () => {
    const storage = fakeStorage();
    const now = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" }, intelligenceModel: {}, propertyOperatingObligations: [] };

    writeDashboardCache(payload, { storage, now });
    expect(readDashboardCache({ storage, now })).toEqual(payload);
  });

  it("treats an entry older than the TTL as a miss", () => {
    const storage = fakeStorage();
    const writeNow = () => 1_000_000;
    writeDashboardCache({ viewModel: { loadState: "ready" } }, { storage, now: writeNow });

    const justPastTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS + 1;
    expect(readDashboardCache({ storage, now: justPastTtl })).toBeNull();
  });

  it("still returns the entry at exactly the TTL boundary", () => {
    const storage = fakeStorage();
    const writeNow = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" } };
    writeDashboardCache(payload, { storage, now: writeNow });

    const atTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS;
    expect(readDashboardCache({ storage, now: atTtl })).toEqual(payload);
  });

  it("treats corrupt JSON as a cache miss instead of throwing", () => {
    const storage = fakeStorage({ "forge-financial-dashboard-cache-v1": "{not json" });
    expect(readDashboardCache({ storage })).toBeNull();
  });

  it("treats an entry missing cachedAt as a cache miss", () => {
    const storage = fakeStorage({ "forge-financial-dashboard-cache-v1": JSON.stringify({ payload: { a: 1 } }) });
    expect(readDashboardCache({ storage })).toBeNull();
  });

  it("no-ops instead of throwing when storage is unavailable (private browsing)", () => {
    expect(() => readDashboardCache({ storage: null })).not.toThrow();
    expect(readDashboardCache({ storage: null })).toBeNull();
    expect(() => writeDashboardCache({ a: 1 }, { storage: null })).not.toThrow();
    expect(() => clearDashboardCache({ storage: null })).not.toThrow();
  });

  it("no-ops instead of throwing when storage.setItem/getItem throw (quota exceeded, disabled storage)", () => {
    const throwingStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };
    expect(readDashboardCache({ storage: throwingStorage })).toBeNull();
    expect(() => writeDashboardCache({ a: 1 }, { storage: throwingStorage })).not.toThrow();
    expect(() => clearDashboardCache({ storage: throwingStorage })).not.toThrow();
  });

  it("clearDashboardCache removes a previously written entry", () => {
    const storage = fakeStorage();
    writeDashboardCache({ viewModel: { loadState: "ready" } }, { storage, now: () => 1 });
    expect(readDashboardCache({ storage, now: () => 2 })).not.toBeNull();

    clearDashboardCache({ storage });
    expect(readDashboardCache({ storage, now: () => 3 })).toBeNull();
  });

  it("falls back to window.sessionStorage when no storage override is given", () => {
    const setItem = vi.fn();
    const originalWindow = globalThis.window;
    globalThis.window = { sessionStorage: { setItem, getItem: () => null, removeItem: vi.fn() } };

    writeDashboardCache({ a: 1 });
    expect(setItem).toHaveBeenCalledOnce();

    globalThis.window = originalWindow;
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
