import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSWRCache,
  fetchWithDedupe,
  getCacheEntry,
  invalidate,
  invalidatePrefix,
  isFresh,
  isInflight,
  prefetch,
  subscribe,
} from "./swrCache";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  clearSWRCache();
  vi.useRealTimers();
});

describe("swrCache", () => {
  it("stores fetched data retrievable via getCacheEntry", async () => {
    await fetchWithDedupe("k1", () => Promise.resolve({ total: 42 }));
    expect(getCacheEntry("k1")?.data).toEqual({ total: 42 });
    expect(getCacheEntry("k1")?.error).toBe("");
  });

  it("dedupes concurrent fetches onto one network request", async () => {
    const fetcher = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve("v"), 10)));
    const [a, b] = await Promise.all([fetchWithDedupe("k2", fetcher), fetchWithDedupe("k2", fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(isInflight("k2")).toBe(false);
  });

  it("reports freshness against the TTL", async () => {
    await fetchWithDedupe("k3", () => Promise.resolve(1));
    expect(isFresh("k3", 60_000)).toBe(true);
    expect(isFresh("k3", 0)).toBe(true); // ttl 0 disables staleness
    expect(isFresh("missing", 60_000)).toBe(false);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(isFresh("k3", 60_000)).toBe(false);
  });

  it("keeps the last good data when a refresh fails, and surfaces the error", async () => {
    await fetchWithDedupe("k4", () => Promise.resolve("good"));
    await expect(fetchWithDedupe("k4", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const entry = getCacheEntry("k4");
    expect(entry?.data).toBe("good");
    expect(entry?.error).toBe("boom");
  });

  it("a successful refresh clears a previous error", async () => {
    await expect(fetchWithDedupe("k5", () => Promise.reject(new Error("down")))).rejects.toThrow();
    expect(getCacheEntry("k5")?.error).toBe("down");
    await fetchWithDedupe("k5", () => Promise.resolve("back"));
    expect(getCacheEntry("k5")?.data).toBe("back");
    expect(getCacheEntry("k5")?.error).toBe("");
  });

  it("invalidate drops the entry and orphans in-flight work", async () => {
    let resolveSlow;
    const slow = new Promise((resolve) => { resolveSlow = resolve; });
    const pending = fetchWithDedupe("k6", () => slow);
    invalidate("k6");
    expect(getCacheEntry("k6")).toBeUndefined();
    resolveSlow("stale");
    await expect(pending).resolves.toBe("stale");
    await tick();
    // The late resolution was dropped — the entry stays gone.
    expect(getCacheEntry("k6")).toBeUndefined();
  });

  it("invalidatePrefix clears every key under the prefix only", async () => {
    await fetchWithDedupe("property-expenses:a", () => Promise.resolve(1));
    await fetchWithDedupe("property-expenses:b", () => Promise.resolve(2));
    await fetchWithDedupe("tenant-ledger:a", () => Promise.resolve(3));
    invalidatePrefix("property-expenses:");
    expect(getCacheEntry("property-expenses:a")).toBeUndefined();
    expect(getCacheEntry("property-expenses:b")).toBeUndefined();
    expect(getCacheEntry("tenant-ledger:a")?.data).toBe(3);
  });

  it("prefetch fills a missing entry without throwing on failure", async () => {
    const fetcher = vi.fn(() => Promise.resolve("warm"));
    await prefetch("k7", fetcher, 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getCacheEntry("k7")?.data).toBe("warm");
    // Fresh now — no second fetch.
    await prefetch("k7", fetcher, 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Failed prefetch resolves to null, never rejects.
    await expect(prefetch("k8", () => Promise.reject(new Error("x")))).resolves.toBeNull();
  });

  it("notifies subscribers on every entry change", async () => {
    const seen = [];
    const unsub = subscribe("k9", () => seen.push(getCacheEntry("k9")?.data ?? null));
    await fetchWithDedupe("k9", () => Promise.resolve("one"));
    expect(seen).toContain("one");
    unsub();
    await fetchWithDedupe("k9", () => Promise.resolve("two"));
    expect(seen).not.toContain("two");
  });
});

describe("in-flight cleanup race (PR #334 arch review)", () => {
  it("an orphaned request resolving after a newer start does not untrack the newer request", async () => {
    let resolveA;
    let resolveB;
    const gateA = new Promise((resolve) => { resolveA = resolve; });
    const gateB = new Promise((resolve) => { resolveB = resolve; });

    // Request A starts, then is invalidated, then request B starts for the same key.
    const promiseA = fetchWithDedupe("race", () => gateA.then(() => "A"));
    invalidate("race");
    const promiseB = fetchWithDedupe("race", () => gateB.then(() => "B"));

    // A resolves late: it must not delete B's in-flight entry.
    resolveA();
    await promiseA.catch(() => {});
    expect(isInflight("race")).toBe(true);

    // B's data is what lands.
    resolveB();
    await expect(promiseB).resolves.toBe("B");
    expect(getCacheEntry("race")?.data).toBe("B");
    expect(isInflight("race")).toBe(false);
  });
});
