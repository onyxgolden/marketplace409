import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSWRCache,
  fetchWithDedupe,
  getCacheEntry,
  invalidate,
  invalidatePrefix,
  isFresh,
  isInflight,
  patchCacheEntry,
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

describe("patchCacheEntry (Slice 1 row-only reconciliation)", () => {
  beforeEach(() => { clearSWRCache(); });

  it("patches an in-memory entry in place and notifies subscribers", async () => {
    await fetchWithDedupe("patch-1", () => Promise.resolve({ tenants: [{ id: "t1", email: "old@example.com" }] }));
    const seen = [];
    const unsubscribe = subscribe("patch-1", () => seen.push(getCacheEntry("patch-1")?.data));
    expect(patchCacheEntry("patch-1", (data) => ({ ...data, tenants: data.tenants.map((item) => item.id === "t1" ? { ...item, email: "new@example.com" } : item) }))).toBe(true);
    expect(getCacheEntry("patch-1").data.tenants[0].email).toBe("new@example.com");
    expect(seen).toHaveLength(1);
    expect(seen[0].tenants[0].email).toBe("new@example.com");
    unsubscribe();
  });

  it("returns false and changes nothing when there is no entry", () => {
    expect(patchCacheEntry("patch-missing", () => ({ tenants: [] }))).toBe(false);
    expect(getCacheEntry("patch-missing")).toBeUndefined();
  });

  it("returns false and keeps the entry when the updater declines (returns undefined)", async () => {
    await fetchWithDedupe("patch-2", () => Promise.resolve({ tenants: [{ id: "t1" }] }));
    const before = getCacheEntry("patch-2").data;
    expect(patchCacheEntry("patch-2", () => undefined)).toBe(false);
    expect(getCacheEntry("patch-2").data).toBe(before);
  });

  it("patches a disk-hydrated entry after a simulated cold boot", async () => {
    const { store } = installLocalStorageStub();
    const signed = await signedInModule("patch-user");
    await signed.fetchWithDedupe("patch-3", () => Promise.resolve({ tenants: [{ id: "t1", email: "old@example.com" }] }));
    expect(store.size).toBeGreaterThan(0);
    const cold = await signedInModule("patch-user");
    expect(cold.getCacheEntry("patch-3")?.data.tenants[0].email).toBe("old@example.com");
    expect(cold.patchCacheEntry("patch-3", (data) => ({ ...data, tenants: data.tenants.map((item) => ({ ...item, email: "new@example.com" })) }))).toBe(true);
    expect(cold.getCacheEntry("patch-3").data.tenants[0].email).toBe("new@example.com");
    const colder = await signedInModule("patch-user");
    expect(colder.getCacheEntry("patch-3")?.data.tenants[0].email).toBe("new@example.com");
    vi.unstubAllGlobals();
  });
});

describe("patchCacheEntry write barrier (PR #863 fix round 1)", () => {
  beforeEach(() => { clearSWRCache(); });

  it("a stale GET resolving after a confirmed patch cannot overwrite the patched row", async () => {
    let resolveStale;
    const stale = new Promise((resolve) => { resolveStale = resolve; });
    await fetchWithDedupe("wb-1", () => Promise.resolve({ tenants: [{ id: "t1", email: "old@example.com" }] }));
    // A refresh starts before the mutation and reads the old server state.
    const pending = fetchWithDedupe("wb-1", () => stale.then(() => ({ tenants: [{ id: "t1", email: "stale@example.com" }] })));
    await tick(); // let the stale fetch start
    expect(isInflight("wb-1")).toBe(true);
    // The mutation commits and patches the cache to the confirmed new state.
    expect(patchCacheEntry("wb-1", (data) => ({ ...data, tenants: [{ id: "t1", email: "new@example.com" }] }))).toBe(true);
    expect(isInflight("wb-1")).toBe(false); // the pre-patch read is orphaned
    // The stale GET resolves late: the authoritative patch must survive.
    resolveStale();
    await expect(pending).resolves.toEqual({ tenants: [{ id: "t1", email: "stale@example.com" }] });
    await tick();
    expect(getCacheEntry("wb-1").data.tenants[0].email).toBe("new@example.com");
    expect(getCacheEntry("wb-1").error).toBe("");
  });

  it("a stale GET failing after a confirmed patch cannot stain the patched entry", async () => {
    let rejectStale;
    const stale = new Promise((_, reject) => { rejectStale = reject; });
    await fetchWithDedupe("wb-2", () => Promise.resolve({ tenants: [{ id: "t1", email: "old@example.com" }] }));
    const pending = fetchWithDedupe("wb-2", () => stale);
    await tick();
    expect(patchCacheEntry("wb-2", (data) => ({ ...data, tenants: [{ id: "t1", email: "new@example.com" }] }))).toBe(true);
    rejectStale(new Error("stale boom"));
    await expect(pending).rejects.toThrow("stale boom");
    await tick();
    const entry = getCacheEntry("wb-2");
    expect(entry.data.tenants[0].email).toBe("new@example.com");
    expect(entry.error).toBe("");
  });

  it("an older promise's cleanup cannot untrack a newer request started after the patch", async () => {
    let resolveStale;
    let resolveFresh;
    const stale = new Promise((resolve) => { resolveStale = resolve; });
    const fresh = new Promise((resolve) => { resolveFresh = resolve; });
    await fetchWithDedupe("wb-3", () => Promise.resolve("v1"));
    const pendingStale = fetchWithDedupe("wb-3", () => stale.then(() => "stale"));
    await tick();
    expect(patchCacheEntry("wb-3", () => "patched")).toBe(true);
    // A new explicit revalidation starts after the patch.
    const pendingFresh = fetchWithDedupe("wb-3", () => fresh.then(() => "v2"));
    await tick();
    expect(isInflight("wb-3")).toBe(true);
    // The stale read resolves: it must not delete the fresh request's entry.
    resolveStale();
    await expect(pendingStale).resolves.toBe("stale");
    await tick();
    expect(isInflight("wb-3")).toBe(true);
    expect(getCacheEntry("wb-3")?.data).toBe("patched");
    // The fresh read lands and wins.
    resolveFresh();
    await expect(pendingFresh).resolves.toBe("v2");
    expect(getCacheEntry("wb-3")?.data).toBe("v2");
    expect(isInflight("wb-3")).toBe(false);
  });

  it("a later explicit revalidation still writes after a patch", async () => {
    await fetchWithDedupe("wb-4", () => Promise.resolve("v1"));
    expect(patchCacheEntry("wb-4", () => "patched")).toBe(true);
    await fetchWithDedupe("wb-4", () => Promise.resolve("v2"));
    expect(getCacheEntry("wb-4")?.data).toBe("v2");
  });

  it("an identity change after a patch still wipes the patched entry", async () => {
    installLocalStorageStub();
    const mod = await signedInModule("wb-user");
    await mod.fetchWithDedupe("wb-5", () => Promise.resolve("v1"));
    expect(mod.patchCacheEntry("wb-5", () => "patched")).toBe(true);
    mod.setCacheIdentity("other-user");
    expect(mod.getCacheEntry("wb-5")).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("a declined patch still leaves a stale in-flight read alone (no barrier without a write)", async () => {
    let resolveStale;
    const stale = new Promise((resolve) => { resolveStale = resolve; });
    await fetchWithDedupe("wb-6", () => Promise.resolve("v1"));
    const pending = fetchWithDedupe("wb-6", () => stale.then(() => "stale"));
    await tick();
    expect(patchCacheEntry("wb-6", () => undefined)).toBe(false);
    expect(isInflight("wb-6")).toBe(true); // nothing was written, so nothing was orphaned
    resolveStale();
    await expect(pending).resolves.toBe("stale");
    expect(getCacheEntry("wb-6")?.data).toBe("stale");
  });

  it("the barrier holds on a paged list key (rental:tenants:v2:page:2)", async () => {
    // PR #863 fix round 2, residual 3: Load more reads page 2 through
    // fetchWithDedupe under its own key, and row mutations patch that key --
    // a stale page-2 GET must not overwrite the patched page either.
    let resolveStale;
    const stale = new Promise((resolve) => { resolveStale = resolve; });
    await fetchWithDedupe("rental:tenants:v2:page:2", () => Promise.resolve({ tenants: [{ id: "t71", email: "old@example.com" }], totalCount: 75, page: 2, pageSize: 50 }));
    const pending = fetchWithDedupe("rental:tenants:v2:page:2", () => stale.then(() => ({ tenants: [{ id: "t71", email: "stale@example.com" }], totalCount: 75, page: 2, pageSize: 50 })));
    await tick();
    expect(isInflight("rental:tenants:v2:page:2")).toBe(true);
    expect(patchCacheEntry("rental:tenants:v2:page:2", (data) => ({ ...data, tenants: [{ id: "t71", email: "new@example.com" }] }))).toBe(true);
    expect(isInflight("rental:tenants:v2:page:2")).toBe(false);
    resolveStale();
    await expect(pending).resolves.toEqual({ tenants: [{ id: "t71", email: "stale@example.com" }], totalCount: 75, page: 2, pageSize: 50 });
    await tick();
    expect(getCacheEntry("rental:tenants:v2:page:2").data.tenants[0].email).toBe("new@example.com");
    expect(getCacheEntry("rental:tenants:v2:page:2").error).toBe("");
  });
});
