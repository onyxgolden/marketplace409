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

function installLocalStorageStub() {
  const store = new Map();
  const stub = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  vi.stubGlobal("window", { localStorage: stub });
  return { store, stub };
}

async function freshModule() {
  vi.resetModules();
  return import("./swrCache");
}

// Disk access is identity-gated: tests that exercise persistence sign in first.
async function signedInModule(identity = "test-user") {
  const mod = await freshModule();
  mod.setCacheIdentity(identity);
  return mod;
}

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

describe("localStorage persistence (cold-boot instant render)", () => {
  it("persists fetched entries to localStorage", async () => {
    const { store } = installLocalStorageStub();
    const mod = await signedInModule();
    await mod.fetchWithDedupe("persist-1", () => Promise.resolve({ units: [1, 2] }));
    const raw = store.get("forge.swr.v1:test-user:persist-1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).data).toEqual({ units: [1, 2] });
    vi.unstubAllGlobals();
  });

  it("does not touch disk when no identity is set (fail closed)", async () => {
    const { store } = installLocalStorageStub();
    await fetchWithDedupe("no-id-1", () => Promise.resolve("v"));
    expect([...store.keys()].filter((k) => k.startsWith("forge.swr.v1:"))).toEqual([]);
    expect(getCacheEntry("no-id-1")?.data).toBe("v"); // memory cache still works
    vi.unstubAllGlobals();
  });

  it("hydrates a cold cache from disk so first paint has data (simulated page reload)", async () => {
    installLocalStorageStub();
    const mod = await signedInModule();
    await mod.fetchWithDedupe("persist-2", () => Promise.resolve({ tenants: ["a"] }));
    // Simulate a full page reload: brand-new module state, same localStorage.
    const cold = await signedInModule();
    expect(cold.getCacheEntry("persist-2")?.data).toEqual({ tenants: ["a"] });
    vi.unstubAllGlobals();
  });

  it("ignores disk entries older than 24h", async () => {
    const { store } = installLocalStorageStub();
    store.set("forge.swr.v1:test-user:persist-3", JSON.stringify({ data: "stale", error: "", updatedAt: Date.now() - 25 * 60 * 60 * 1000 }));
    const cold = await signedInModule();
    expect(cold.getCacheEntry("persist-3")).toBeUndefined();
    expect(store.has("forge.swr.v1:test-user:persist-3")).toBe(false); // expired entry is cleaned up
    vi.unstubAllGlobals();
  });

  it("invalidate drops the persisted entry", async () => {
    const { store } = installLocalStorageStub();
    const mod = await signedInModule();
    await mod.fetchWithDedupe("persist-4", () => Promise.resolve("v"));
    expect(store.has("forge.swr.v1:test-user:persist-4")).toBe(true);
    mod.invalidate("persist-4");
    expect(store.has("forge.swr.v1:test-user:persist-4")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("keeps working when localStorage throws (private mode / quota)", async () => {
    const { stub } = installLocalStorageStub();
    stub.setItem = () => { throw new Error("quota"); };
    const mod = await signedInModule();
    await mod.fetchWithDedupe("persist-5", () => Promise.resolve("v"));
    expect(mod.getCacheEntry("persist-5")?.data).toBe("v"); // memory cache unaffected
    vi.unstubAllGlobals();
  });

  it("does not touch window when it is absent (SSR / node)", async () => {
    expect(typeof window).toBe("undefined");
    await fetchWithDedupe("persist-6", () => Promise.resolve("v"));
    expect(getCacheEntry("persist-6")?.data).toBe("v");
  });
});

describe("identity isolation and lifecycle (PR #417 review)", () => {
  it("account switching: one user's disk entries are invisible to another user", async () => {
    installLocalStorageStub();
    const modA = await signedInModule("user-a");
    await modA.fetchWithDedupe("acct-1", () => Promise.resolve("a-data"));
    expect(modA.getCacheEntry("acct-1")?.data).toBe("a-data");

    // A different user on the same browser, cold boot: sees nothing of user A's data.
    const modB = await signedInModule("user-b");
    expect(modB.getCacheEntry("acct-1")).toBeUndefined();

    // The original user still gets their own data back.
    const modA2 = await signedInModule("user-a");
    expect(modA2.getCacheEntry("acct-1")?.data).toBe("a-data");
    vi.unstubAllGlobals();
  });

  it("switching identity drops in-memory entries and notifies subscribers", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("user-a");
    await mod.fetchWithDedupe("acct-2", () => Promise.resolve("a-data"));
    let notifications = 0;
    const unsubscribe = mod.subscribe("acct-2", () => { notifications += 1; });
    mod.setCacheIdentity("user-b");
    expect(mod.getCacheEntry("acct-2")).toBeUndefined();
    expect(notifications).toBeGreaterThan(0); // UI re-renders instead of showing user A's data
    unsubscribe();
    vi.unstubAllGlobals();
  });

  it("session expiration: expiring the session makes persisted entries unreachable", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("user-a");
    await mod.fetchWithDedupe("sess-1", () => Promise.resolve("s-data"));

    // Session expires (or sign-out): identity cleared.
    mod.setCacheIdentity(null);
    expect(mod.getCacheEntry("sess-1")).toBeUndefined(); // memory dropped
    expect(mod.getCacheIdentity()).toBeNull();

    // Cold boot with no identity hydrates nothing from disk.
    const cold = await freshModule();
    expect(cold.getCacheEntry("sess-1")).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("invalidatePrefix removes disk entries that were never loaded into memory", async () => {
    const { store } = installLocalStorageStub();
    const mod = await signedInModule("user-a");
    await mod.fetchWithDedupe("property-expenses:x", () => Promise.resolve(1));
    await mod.fetchWithDedupe("tenant-ledger:x", () => Promise.resolve(2));
    expect(store.has("forge.swr.v1:user-a:property-expenses:x")).toBe(true);

    // Fresh session: nothing in memory, everything on disk.
    const mod2 = await signedInModule("user-a");
    mod2.invalidatePrefix("property-expenses:");
    expect(mod2.getCacheEntry("property-expenses:x")).toBeUndefined();
    expect(store.has("forge.swr.v1:user-a:property-expenses:x")).toBe(false); // disk copy gone
    // Untouched prefix still hydrates.
    expect(mod2.getCacheEntry("tenant-ledger:x")?.data).toBe(2);
    vi.unstubAllGlobals();
  });

  it("failed refresh does not persist the error state over the last good disk copy", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("user-a");
    await mod.fetchWithDedupe("fail-1", () => Promise.resolve("good"));
    await expect(mod.fetchWithDedupe("fail-1", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

    // Memory keeps the error for the UI to surface alongside the last good data.
    expect(mod.getCacheEntry("fail-1")?.data).toBe("good");
    expect(mod.getCacheEntry("fail-1")?.error).toBe("boom");

    // Cold boot hydrates the last GOOD data, not the error -- then revalidates.
    const cold = await signedInModule("user-a");
    const entry = cold.getCacheEntry("fail-1");
    expect(entry?.data).toBe("good");
    expect(entry?.error).toBe("");
    vi.unstubAllGlobals();
  });

  it("an oversized replacement drops the stale disk copy instead of leaving it", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("user-a");
    await mod.fetchWithDedupe("big-1", () => Promise.resolve("small"));
    expect(mod.getCacheEntry("big-1")?.data).toBe("small");

    // Replace with a payload over the 2MB per-entry cap.
    const huge = "x".repeat(2_000_001);
    await mod.fetchWithDedupe("big-1", () => Promise.resolve(huge));
    expect(mod.getCacheEntry("big-1")?.data).toBe(huge); // memory has the live data

    // Cold boot must NOT serve the stale small copy from disk.
    const cold = await signedInModule("user-a");
    expect(cold.getCacheEntry("big-1")).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("cross-identity in-flight protection (PR #417 re-review finding 2)", () => {
  it("an in-flight request from the previous identity cannot contaminate the new identity's cache", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("user-a");

    // User A starts a fetch for "race-1" (version 1, epoch N)...
    let resolveA;
    const promiseA = mod.fetchWithDedupe("race-1", () => new Promise((resolve) => { resolveA = resolve; }));

    // ...then auth switches to user B mid-flight, clearing the version maps...
    mod.setCacheIdentity("user-b");

    // ...and user B starts their own fetch for the same key (version restarts at 1).
    let resolveB;
    const promiseB = mod.fetchWithDedupe("race-1", () => new Promise((resolve) => { resolveB = resolve; }));
    await tick(); // let B's fetcher start
    resolveB("b-data");
    await expect(promiseB).resolves.toBe("b-data");
    expect(mod.getCacheEntry("race-1")?.data).toBe("b-data");

    // User A's late response arrives: it must be dropped, not written over B's entry.
    resolveA("a-data");
    await expect(promiseA).resolves.toBe("a-data"); // A's own caller still gets their result
    await tick();
    expect(mod.getCacheEntry("race-1")?.data).toBe("b-data");

    // And a cold boot as user B hydrates B's data, never A's.
    const cold = await signedInModule("user-b");
    expect(cold.getCacheEntry("race-1")?.data).toBe("b-data");
    vi.unstubAllGlobals();
  });

  it("clearSWRCache orphans in-flight resolutions via the epoch guard", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("user-a");
    await mod.fetchWithDedupe("epoch-1", () => Promise.resolve("v1"));

    let resolveLate;
    const late = mod.fetchWithDedupe("epoch-1", () => new Promise((resolve) => { resolveLate = resolve; }));
    await tick(); // let the fetcher start
    mod.clearSWRCache(); // e.g. sign-out while a refresh is in flight
    resolveLate("stale");
    await expect(late).resolves.toBe("stale");
    await tick();
    expect(mod.getCacheEntry("epoch-1")).toBeUndefined(); // nothing resurrected after the clear
    vi.unstubAllGlobals();
  });
});
