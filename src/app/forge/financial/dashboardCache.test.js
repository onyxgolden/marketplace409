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
    clear: async () => { map.clear(); },
    _map: map,
  };
}

function throwingStore() {
  return {
    get: async () => { throw new Error("blocked"); },
    set: async () => { throw new Error("blocked"); },
    delete: async () => { throw new Error("blocked"); },
    clear: async () => { throw new Error("blocked"); },
  };
}

// Two acting users and two canonical workspaces -- distinct dimensions, deliberately combined
// below to prove the cache is keyed on the PAIR, never on either alone.
const USER_OWNER = "user-aaaaaaaa-1111-1111-1111-111111111111"; // primary owner of WORKSPACE_1
const USER_COOWNER = "user-bbbbbbbb-2222-2222-2222-222222222222"; // active co-owner of WORKSPACE_1
const USER_UNRELATED = "user-cccccccc-3333-3333-3333-333333333333"; // owner of WORKSPACE_2
const WORKSPACE_1 = USER_OWNER; // resolveEffectiveOwnerId() returns the primary owner's own id for themself
const WORKSPACE_2 = USER_UNRELATED;

describe("dashboardCache", () => {
  it("returns null on a cache miss", async () => {
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store: fakeStore() })).toBeNull();
  });

  it("round-trips a payload written and read within the TTL, for the same (actingUserId, canonicalWorkspaceId) pair", async () => {
    const store = fakeStore();
    const now = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" }, intelligenceModel: {}, propertyOperatingObligations: [] };

    await writeDashboardCache(payload, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toEqual(payload);
  });

  it("treats an entry older than the TTL as a miss", async () => {
    const store = fakeStore();
    const writeNow = () => 1_000_000;
    await writeDashboardCache({ viewModel: { loadState: "ready" } }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now: writeNow });

    const justPastTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS + 1;
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now: justPastTtl })).toBeNull();
  });

  it("still returns the entry at exactly the TTL boundary", async () => {
    const store = fakeStore();
    const writeNow = () => 1_000_000;
    const payload = { viewModel: { loadState: "ready" } };
    await writeDashboardCache(payload, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now: writeNow });

    const atTtl = () => 1_000_000 + DASHBOARD_CACHE_TTL_MS;
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now: atTtl })).toEqual(payload);
  });

  it("treats an entry missing cachedAt as a cache miss", async () => {
    const store = fakeStore({ [`financial-dashboard:2:${USER_OWNER}:${WORKSPACE_1}`]: { payload: { a: 1 } } });
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store })).toBeNull();
  });

  it("no-ops instead of throwing when the store is unavailable (private browsing / IndexedDB disabled)", async () => {
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store: null })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store: null })).resolves.not.toThrow();
    await expect(clearDashboardCache({ store: null })).resolves.not.toThrow();
  });

  it("no-ops instead of throwing when the store's get/set/delete/clear reject (blocked, corrupt database)", async () => {
    const store = throwingStore();
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store })).resolves.not.toThrow();
    await expect(clearDashboardCache({ store })).resolves.not.toThrow();
  });

  it("falls back to a clean no-op when IndexedDB is unavailable in this environment (e.g. the Node test runtime)", async () => {
    // No `store` override and no global `indexedDB` (true in this Node test environment) -- must
    // resolve to a no-op rather than throwing "indexedDB is not defined".
    expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1 })).toBeNull();
    await expect(writeDashboardCache({ a: 1 }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1 })).resolves.not.toThrow();
    await expect(clearDashboardCache()).resolves.not.toThrow();
  });

  it("round-trips a payload far larger than sessionStorage's ~5MB per-origin quota -- the exact scale a real imported account's full transaction history produces, and exactly what motivated moving off sessionStorage", async () => {
    const store = fakeStore();
    const now = () => 1_000_000;
    const bigTransactionList = Array.from({ length: 30_000 }, (_, i) => ({
      id: `txn-${i}`,
      description: `Imported transaction number ${i} with a realistically long merchant description`,
      amount: (i % 500) + 0.42,
      eventDate: "2026-01-01",
      category: "uncategorized",
    }));
    const payload = { viewModel: { loadState: "ready", transactions: bigTransactionList }, intelligenceModel: {} };
    expect(JSON.stringify(payload).length).toBeGreaterThan(4 * 1024 * 1024);

    await writeDashboardCache(payload, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
    const result = await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
    expect(result).toEqual(payload);
    expect(result.viewModel.transactions).toHaveLength(30_000);
  });

  describe("workspace and user isolation", () => {
    it("the same acting user accessing two different canonical workspaces gets two independent cache entries", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      // USER_COOWNER is an active co-owner of WORKSPACE_1 today; imagine their membership later
      // moves to WORKSPACE_2 -- the SAME acting user id, a DIFFERENT resolved workspace.
      const inWorkspace1 = { viewModel: { loadState: "ready", workspace: "1" } };
      const inWorkspace2 = { viewModel: { loadState: "ready", workspace: "2" } };

      await writeDashboardCache(inWorkspace1, { actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
      await writeDashboardCache(inWorkspace2, { actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_2, store, now });

      expect(await readDashboardCache({ actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toEqual(inWorkspace1);
      expect(await readDashboardCache({ actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_2, store, now })).toEqual(inWorkspace2);
    });

    it("a primary owner and their active co-owner viewing the SAME canonical workspace get independently scoped cache entries (no shared caching is implemented)", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      const ownerPayload = { viewModel: { loadState: "ready", renderedFor: "owner" } };
      const coOwnerPayload = { viewModel: { loadState: "ready", renderedFor: "coowner" } };

      // Both resolve to the SAME canonicalWorkspaceId (WORKSPACE_1 === USER_OWNER's own id) --
      // exactly what resolveEffectiveOwnerId() does for an active co-owner -- but each writes under
      // their own distinct actingUserId.
      await writeDashboardCache(ownerPayload, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
      await writeDashboardCache(coOwnerPayload, { actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });

      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toEqual(ownerPayload);
      expect(await readDashboardCache({ actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toEqual(coOwnerPayload);
      // Neither ever sees the other's cached render, even though they share a workspace.
      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).not.toEqual(coOwnerPayload);
    });

    it("never returns another user's cached payload, even within the TTL, even in the same store", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      const ownerPayload = { viewModel: { loadState: "ready", owner: "A" } };
      await writeDashboardCache(ownerPayload, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });

      expect(await readDashboardCache({ actingUserId: USER_UNRELATED, canonicalWorkspaceId: WORKSPACE_1, store, now })).toBeNull();
      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toEqual(ownerPayload);
    });

    it("treats a missing actingUserId or canonicalWorkspaceId as a hard no-op on every operation, rather than falling back to an unscoped shared key", async () => {
      const store = fakeStore();
      await expect(writeDashboardCache({ a: 1 }, { actingUserId: null, canonicalWorkspaceId: WORKSPACE_1, store })).resolves.not.toThrow();
      await expect(writeDashboardCache({ a: 1 }, { actingUserId: USER_OWNER, canonicalWorkspaceId: null, store })).resolves.not.toThrow();
      expect(await readDashboardCache({ actingUserId: null, canonicalWorkspaceId: WORKSPACE_1, store })).toBeNull();
      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: undefined, store })).toBeNull();
      // Confirms nothing was ever actually written under any key for the missing-identity calls.
      expect(store._map.size).toBe(0);
    });
  });

  describe("logout clears the whole store, not one key (shared-device protection)", () => {
    it("clearDashboardCache wipes every (actingUserId, canonicalWorkspaceId) entry the store holds, not just one", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      await writeDashboardCache({ viewModel: { owner: "A" } }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
      await writeDashboardCache({ viewModel: { owner: "coowner" } }, { actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });
      await writeDashboardCache({ viewModel: { owner: "unrelated" } }, { actingUserId: USER_UNRELATED, canonicalWorkspaceId: WORKSPACE_2, store, now });

      await clearDashboardCache({ store });

      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toBeNull();
      expect(await readDashboardCache({ actingUserId: USER_COOWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toBeNull();
      expect(await readDashboardCache({ actingUserId: USER_UNRELATED, canonicalWorkspaceId: WORKSPACE_2, store, now })).toBeNull();
      expect(store._map.size).toBe(0);
    });

    it("requires no identity to call -- a sign-out clears everything regardless of who is signing out", async () => {
      const store = fakeStore();
      await writeDashboardCache({ viewModel: { owner: "someone" } }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now: () => 1 });
      await expect(clearDashboardCache({ store })).resolves.not.toThrow();
      expect(store._map.size).toBe(0);
    });
  });

  describe("payload schema versioning (also embedded directly in the cache key)", () => {
    it("treats an entry written under a different schema version as a miss, not a malformed-shape crash", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      await writeDashboardCache({ viewModel: { loadState: "ready" } }, { actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now });

      // Simulate a future deploy bumping PAYLOAD_SCHEMA_VERSION by directly corrupting the stored
      // entry's version stamp (defense in depth -- the key itself already embeds the version too).
      const key = [...store._map.keys()][0];
      const entry = store._map.get(key);
      store._map.set(key, { ...entry, schemaVersion: entry.schemaVersion + 1 });

      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toBeNull();
    });

    it("treats a real pre-deploy entry (schemaVersion 1, from before the 2005->2015 date-repair migration shipped) as a miss -- a cache populated moments before that deploy must never keep showing the corrected chart the stale, pre-repair 2005 dates", async () => {
      const store = fakeStore();
      const now = () => 1_000_000;
      // The OLD (schemaVersion 1) key shape, written directly to simulate a genuinely pre-deploy
      // entry -- the new code only ever reads/writes keys embedding the CURRENT version, so this
      // old-shaped key is never even looked up, let alone matched.
      const oldKey = `financial-dashboard:1:${USER_OWNER}:${WORKSPACE_1}`;
      await store.set(oldKey, { cachedAt: now(), schemaVersion: 1, payload: { viewModel: { loadState: "ready", note: "pre-repair, shows 2005" } } });

      expect(await readDashboardCache({ actingUserId: USER_OWNER, canonicalWorkspaceId: WORKSPACE_1, store, now })).toBeNull();
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
