// S2A (load-times slice 2) — fix round 2: every freshness assertion here
// runs through the REAL installed Next.js 16.4.1 cache
// (real-incremental-cache-test-harness.js), never a fake that assumes the
// answer. Two controls prove the harness can observe a stale serve, so a
// regression passing proves the digest design, not the test setup: the
// P1-1 control (old fixed key + revalidateTag("max")) and the P1-2
// control (old {count, max(updated_at)} generation key).
import "@/lib/forge/real-incremental-cache-test-harness";

import { beforeEach, describe, expect, it } from "vitest";
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import {
  resetRealIncrementalCache,
  runInRealRequest,
} from "@/lib/forge/real-incremental-cache-test-harness";
import {
  FORGE_LIST_CACHE_TTL_SECONDS,
  fetchFreshPublicSchedulingProjects,
  getCachedDesignerProjects,
  getCachedSchedulingPrivateProjects,
  mergeSchedulingProjectLists,
} from "./listReadCache";

// Fake Supabase client modelling ONE actor's RLS-visible set: `rows` is
// the mutable visible set — tests push / mutate entries to simulate a
// committed write, exactly as the route tests do. The chain supports both
// shapes the module uses: the digest probe (.select(digest columns).eq(),
// awaited directly — the query object itself is thenable, so `then`
// resolves the probe) and the list read (.select().eq().order(), awaited
// via order()'s then). Counters prove what ran: the probe on every GET,
// the list query only on a cache miss. Probe vs list is structural (the
// probe never calls order()), so the fake never hardcodes the module's
// column strings — if the module stopped probing, probeCalls would stay 0
// and the repeat-GET test would fail.
function fakeListClient(initialRows) {
  const rows = initialRows;
  let probeCalls = 0;
  let listCalls = 0;
  let nextProbeError = null;
  let nextListError = null;

  function makeQuery() {
    const state = { filters: [] };
    const query = {
      select(_columns) {
        return query;
      },
      eq(column, value) {
        state.filters.push([column, value]);
        return query;
      },
      order(column, { ascending } = {}) {
        // List path: captures the filters at call time, resolves the
        // filtered rows sorted by updated_at.
        const capturedFilters = [...state.filters];
        const resolve = () => {
          let filtered = rows.filter((row) =>
            capturedFilters.every(([col, val]) => row[col] === val),
          );
          filtered = [...filtered].sort((a, b) =>
            ascending
              ? String(a.updated_at).localeCompare(String(b.updated_at))
              : String(b.updated_at).localeCompare(String(a.updated_at)),
          );
          listCalls += 1;
          if (nextListError) {
            const error = nextListError;
            nextListError = null;
            return { data: null, error };
          }
          return { data: filtered, error: null };
        };
        return {
          limit: async () => resolve(),
          then: (onFulfilled, onRejected) =>
            Promise.resolve(resolve()).then(onFulfilled, onRejected),
        };
      },
      // Digest-probe path: the probe awaits the query directly (no order,
      // no limit). Capture the filters synchronously at await time, then
      // resolve the filtered rows unsorted — the digest sorts by id.
      then(onFulfilled, onRejected) {
        const capturedFilters = [...state.filters];
        const resolve = () => {
          probeCalls += 1;
          if (nextProbeError) {
            const error = nextProbeError;
            nextProbeError = null;
            return { data: null, error };
          }
          const filtered = rows.filter((row) =>
            capturedFilters.every(([col, val]) => row[col] === val),
          );
          return { data: filtered, error: null };
        };
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return query;
  }

  return {
    client: { from: () => makeQuery() },
    rows,
    get probeCalls() {
      return probeCalls;
    },
    get listCalls() {
      return listCalls;
    },
    failNextProbe(error) {
      nextProbeError = error;
    },
    failNextList(error) {
      nextListError = error;
    },
  };
}

const SCHEDULING_ACTOR = { effectiveOwnerId: "user_1", actorId: "user_1" };

async function schedulingPrivate(db) {
  const { result } = await runInRealRequest(() =>
    getCachedSchedulingPrivateProjects({
      supabaseClient: db.client,
      ...SCHEDULING_ACTOR,
    }),
  );
  return result;
}

async function designerList(db, ownerId = "user_1", actorId = "user_1") {
  const { result } = await runInRealRequest(
    () =>
      getCachedDesignerProjects({
        supabaseClient: db.client,
        ownerId,
        actorId,
      }),
    { pathname: "/api/forge/designer" },
  );
  return result;
}

describe("listReadCache (real Next 16.4.1 cache)", () => {
  beforeEach(() => resetRealIncrementalCache());

  it("TTL is 15s (defense-in-depth; freshness comes from the generation key, never the TTL)", () => {
    expect(FORGE_LIST_CACHE_TTL_SECONDS).toBe(15);
  });

  it("repeat GET hits the cache — one DB list select, but the probe runs on every GET", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    const first = await schedulingPrivate(db);
    const second = await schedulingPrivate(db);
    expect(second).toEqual(first);
    expect(db.listCalls).toBe(1);
    expect(db.probeCalls).toBe(2);
  });

  it("P1-1 REGRESSION: warm GET, insert, FIRST subsequent GET returns the new row (no stale serve)", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    const warm = await schedulingPrivate(db);
    expect(warm.map((p) => p.id)).toEqual(["s1"]);
    expect(db.listCalls).toBe(1);
    // The committed insert: a new row with a newer updated_at.
    db.rows.push({ id: "s2", owner_id: "user_1", project_name: "New", start_date: "2026-02-01", end_date: "2026-12-31", is_public: false, created_at: "c", updated_at: "d" });
    const firstAfterWrite = await schedulingPrivate(db);
    expect(firstAfterWrite.map((p) => p.id)).toEqual(["s2", "s1"]);
    expect(db.listCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  // Fix round 2 — the verdict's counterexample, verbatim: design A updated
  // 09:00, design B updated 18:00; rename A at 10:00 (later than its own
  // timestamp, still earlier than B's). {count, max(updated_at)} does not
  // move — the digest must, because A's name and updated_at are digest
  // fields. Asserted on BOTH apps, on the FIRST subsequent GET.
  it("P1 (fix round 2, Scheduling) REGRESSION: renaming the OLDER row — updated_at still below the newest row's — is visible on the FIRST subsequent GET", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Older", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "09:00" },
      { id: "s2", owner_id: "user_1", project_name: "Newest", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "18:00" },
    ]);
    const warm = await schedulingPrivate(db);
    expect(warm.map((p) => p.name)).toEqual(["Newest", "Older"]);
    expect(db.listCalls).toBe(1);
    // The committed rename: A's name changes and its updated_at moves to
    // 10:00 — later than its own 09:00, still earlier than B's 18:00.
    // Count stays 2, max stays 18:00: the old generation would not move.
    db.rows[0] = { ...db.rows[0], project_name: "Older renamed", updated_at: "10:00" };
    const firstAfterWrite = await schedulingPrivate(db);
    expect(firstAfterWrite.map((p) => p.name)).toEqual(["Newest", "Older renamed"]);
    expect(firstAfterWrite.find((p) => p.id === "s1").updatedAt).toBe("10:00");
    expect(db.listCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  it("P1 (fix round 2, Designer) REGRESSION: renaming the OLDER row — updated_at still below the newest row's — is visible on the FIRST subsequent GET", async () => {
    const db = fakeListClient([
      { id: "d1", owner_id: "user_1", project_name: "Older", created_at: "a", updated_at: "09:00" },
      { id: "d2", owner_id: "user_1", project_name: "Newest", created_at: "a", updated_at: "18:00" },
    ]);
    const warm = await designerList(db);
    expect(warm.map((p) => p.name)).toEqual(["Newest", "Older"]);
    expect(db.listCalls).toBe(1);
    db.rows[0] = { ...db.rows[0], project_name: "Older renamed", updated_at: "10:00" };
    const firstAfterWrite = await designerList(db);
    expect(firstAfterWrite.map((p) => p.name)).toEqual(["Newest", "Older renamed"]);
    expect(firstAfterWrite.find((p) => p.id === "d1").updatedAt).toBe("10:00");
    expect(db.listCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  it("P1-2 CONTROL (old max-probe design): {count, max(updated_at)} serves STALE on an older-row rename — the harness can observe the round-2 failure", async () => {
    // The fix-round-1 design, run through the same real cache: the cache
    // key carries only the row count and the newest updated_at. If this
    // control ever stops returning stale data on the first GET, the
    // harness has gone blind and the round-2 regressions prove nothing.
    const db = fakeListClient([
      { id: "a1", owner_id: "user_1", project_name: "Older", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "09:00" },
      { id: "a2", owner_id: "user_1", project_name: "Newest", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "18:00" },
    ]);
    let calls = 0;
    const readRows = async () => {
      calls += 1;
      return db.rows.map((row) => ({ id: row.id, name: row.project_name }));
    };
    async function oldMaxGet() {
      const count = db.rows.length;
      const max = [...db.rows].map((row) => row.updated_at).sort().at(-1);
      const cached = unstable_cache(readRows, ["p1-2-control-max-probe", `${count}:${max}`], {
        revalidate: 15,
      });
      const { result } = await runInRealRequest(() => cached());
      return result;
    }
    const warm = await oldMaxGet();
    expect(warm.map((row) => row.name)).toEqual(["Older", "Newest"]);
    expect(calls).toBe(1);
    // Rename the older row to 10:00 — count stays 2, max stays 18:00.
    db.rows[0] = { ...db.rows[0], project_name: "Older renamed", updated_at: "10:00" };
    const firstAfterWrite = await oldMaxGet();
    expect(firstAfterWrite.find((row) => row.id === "a1").name).toBe("Older");
    expect(calls).toBe(1); // no re-read happened: the stale entry served
  });

  // Fix round 2 — delete + create preserving count AND max: the old
  // generation aliases (same count, same newest timestamp) and serves the
  // deleted row. The digest changes because the id set changes.
  it("P1 (fix round 2, Scheduling): delete + create preserving count and max is visible on the FIRST subsequent GET", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Doomed", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "m" },
      { id: "s2", owner_id: "user_1", project_name: "Keeper", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "z" },
    ]);
    const warm = await schedulingPrivate(db);
    expect(warm.map((p) => p.id).sort()).toEqual(["s1", "s2"]);
    expect(db.listCalls).toBe(1);
    // Delete s1, create s3 with the SAME max timestamp: count stays 2,
    // max stays "z".
    db.rows.splice(0, 1);
    db.rows.push({ id: "s3", owner_id: "user_1", project_name: "Replacement", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "z" });
    const firstAfterWrite = await schedulingPrivate(db);
    expect(firstAfterWrite.map((p) => p.id).sort()).toEqual(["s2", "s3"]);
    expect(db.listCalls).toBe(2);
  });

  it("P1 (fix round 2, Designer): delete + create preserving count and max is visible on the FIRST subsequent GET", async () => {
    const db = fakeListClient([
      { id: "d1", owner_id: "user_1", project_name: "Doomed", created_at: "a", updated_at: "m" },
      { id: "d2", owner_id: "user_1", project_name: "Keeper", created_at: "a", updated_at: "z" },
    ]);
    const warm = await designerList(db);
    expect(warm.map((p) => p.id).sort()).toEqual(["d1", "d2"]);
    expect(db.listCalls).toBe(1);
    db.rows.splice(0, 1);
    db.rows.push({ id: "d3", owner_id: "user_1", project_name: "Replacement", created_at: "a", updated_at: "z" });
    const firstAfterWrite = await designerList(db);
    expect(firstAfterWrite.map((p) => p.id).sort()).toEqual(["d2", "d3"]);
    expect(db.listCalls).toBe(2);
  });

  // Fix round 2 — the timestamp-preserving alias: a rename that does NOT
  // touch updated_at at all. An (id, updated_at) digest would alias here;
  // the full-field digest catches it because project_name is a digest
  // field. Asserted on BOTH apps.
  it("P1 (fix round 2, Scheduling): a rename that preserves updated_at is visible on the FIRST subsequent GET", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Before", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    const warm = await schedulingPrivate(db);
    expect(warm.map((p) => p.name)).toEqual(["Before"]);
    expect(db.listCalls).toBe(1);
    // The write changes the name and nothing else — updated_at untouched.
    db.rows[0] = { ...db.rows[0], project_name: "After" };
    const firstAfterWrite = await schedulingPrivate(db);
    expect(firstAfterWrite.map((p) => p.name)).toEqual(["After"]);
    expect(db.listCalls).toBe(2);
  });

  it("P1 (fix round 2, Designer): a rename that preserves updated_at is visible on the FIRST subsequent GET", async () => {
    const db = fakeListClient([
      { id: "d1", owner_id: "user_1", project_name: "Before", created_at: "a", updated_at: "b" },
    ]);
    const warm = await designerList(db);
    expect(warm.map((p) => p.name)).toEqual(["Before"]);
    expect(db.listCalls).toBe(1);
    db.rows[0] = { ...db.rows[0], project_name: "After" };
    const firstAfterWrite = await designerList(db);
    expect(firstAfterWrite.map((p) => p.name)).toEqual(["After"]);
    expect(db.listCalls).toBe(2);
  });

  it("P1-1 CONTROL (old design): revalidateTag('max') serves STALE on the first post-write GET — the harness can observe it", async () => {
    // The pre-fix-round design, run through the same real cache: fixed key
    // + tag, invalidated with revalidateTag(tag, "max") after the write.
    // If this control ever stops returning stale data on the first GET,
    // the harness has gone blind and the regression above proves nothing.
    let version = 1;
    let calls = 0;
    const TAG = "smoke-old:owner:user_1";
    const cachedOld = unstable_cache(
      async () => {
        calls += 1;
        return { version };
      },
      ["p1-1-control", "user_1"],
      { revalidate: 15, tags: [TAG] },
    );
    const warm = await runInRealRequest(() => cachedOld());
    expect(warm.result).toEqual({ version: 1 });
    expect(calls).toBe(1);
    // The stale mark (Date.now, 1ms resolution) must land strictly after
    // the warm entry's lastModified, or areTagsStale is false and the
    // next GET is a plain fresh hit of v1 with no background revalidation
    // — the control would then assert calls=2 against a run that never
    // revalidated. Sleep past the ms boundary first.
    await new Promise((resolve) => setTimeout(resolve, 15));
    await runInRealRequest(() => {
      version = 2;
      revalidateTag(TAG, "max");
      return null;
    });
    const firstAfterWrite = await runInRealRequest(() => cachedOld());
    expect(firstAfterWrite.result).toEqual({ version: 1 });
    expect(calls).toBe(2); // background revalidation re-ran the callback
    const secondAfterWrite = await runInRealRequest(() => cachedOld());
    expect(secondAfterWrite.result).toEqual({ version: 2 });
  });

  it("P1-1 REGRESSION (Designer): warm GET, update bumps updated_at, FIRST subsequent GET is fresh", async () => {
    const db = fakeListClient([
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ]);
    const warm = await designerList(db);
    expect(warm.map((p) => p.id)).toEqual(["d1"]);
    // The committed update: same row, newer updated_at and a new name.
    db.rows[0] = { ...db.rows[0], project_name: "Kitchen remodelled", updated_at: "z" };
    const firstAfterWrite = await designerList(db);
    expect(firstAfterWrite).toEqual([
      { id: "d1", name: "Kitchen remodelled", createdAt: "a", updatedAt: "z" },
    ]);
    expect(db.listCalls).toBe(2);
  });

  it("P1-2 REGRESSION: a probe failure after a committed write fails visibly — no stale list — and the next read is fresh", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    await schedulingPrivate(db);
    expect(db.listCalls).toBe(1);
    // The write already committed (new row present in the visible set).
    db.rows.push({ id: "s2", owner_id: "user_1", project_name: "New", start_date: "2026-02-01", end_date: "2026-12-31", is_public: false, created_at: "c", updated_at: "d" });
    // The freshness probe now fails: the GET must throw instead of serving
    // the pre-write entry as if it were fresh.
    db.failNextProbe(new Error("probe db down"));
    await expect(schedulingPrivate(db)).rejects.toThrow("probe db down");
    // No list select ran for the failed GET, and nothing was cached.
    expect(db.listCalls).toBe(1);
    // The next read retries and returns the fresh list.
    const fresh = await schedulingPrivate(db);
    expect(fresh.map((p) => p.id)).toEqual(["s2", "s1"]);
    expect(db.listCalls).toBe(2);
  });

  it("a failed list query is not cached — the next GET retries and succeeds", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    db.failNextList(new Error("db down"));
    await expect(schedulingPrivate(db)).rejects.toThrow("db down");
    const fresh = await schedulingPrivate(db);
    expect(fresh).toHaveLength(1);
    expect(db.listCalls).toBe(2);
  });

  it("P1-3 REGRESSION: one actor sees A+B private rows; a write to B moves the A-keyed list immediately, with no rows dropped", async () => {
    const db = fakeListClient([
      { id: "a1", owner_id: "owner_a", project_name: "A project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "b1", owner_id: "owner_b", project_name: "B project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "pub", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ]);
    // The actor acts within workspace A but RLS shows them B's rows too
    // (has_workspace_access on both); the private list is the whole
    // RLS-visible private set, and the probe digests that same set.
    const warm = await runInRealRequest(() =>
      getCachedSchedulingPrivateProjects({
        supabaseClient: db.client,
        effectiveOwnerId: "owner_a",
        actorId: "user_1",
      }),
    );
    expect(warm.result.map((p) => p.id).sort()).toEqual(["a1", "b1"]);
    expect(db.listCalls).toBe(1);
    // A co-owner saves B's project: B's updated_at bumps. The actor's
    // A-keyed entry must reflect it on the FIRST next GET.
    db.rows[1] = { ...db.rows[1], updated_at: "z" };
    const afterBWrite = await runInRealRequest(() =>
      getCachedSchedulingPrivateProjects({
        supabaseClient: db.client,
        effectiveOwnerId: "owner_a",
        actorId: "user_1",
      }),
    );
    expect(afterBWrite.result).toHaveLength(2);
    expect(afterBWrite.result.find((p) => p.id === "b1").updatedAt).toBe("z");
    expect(db.listCalls).toBe(2);
  });

  it("P1-3 (fix round 2): A+B fixture, an older-row rename on B's row is reflected on the FIRST next GET", async () => {
    // Same A+B visibility, but the B write is the round-2 counterexample:
    // B's row is NOT the newest (a third row holds the max), and the
    // rename lands below that max.
    const db = fakeListClient([
      { id: "a1", owner_id: "owner_a", project_name: "A project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "09:00" },
      { id: "b1", owner_id: "owner_b", project_name: "B project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "10:00" },
      { id: "c1", owner_id: "owner_a", project_name: "Newest project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "18:00" },
    ]);
    async function aKeyedList() {
      const { result } = await runInRealRequest(() =>
        getCachedSchedulingPrivateProjects({
          supabaseClient: db.client,
          effectiveOwnerId: "owner_a",
          actorId: "user_1",
        }),
      );
      return result;
    }
    const warm = await aKeyedList();
    expect(warm.map((p) => p.id).sort()).toEqual(["a1", "b1", "c1"]);
    expect(db.listCalls).toBe(1);
    // A co-owner renames B's project at 11:00 — later than its own 10:00,
    // still earlier than the 18:00 max.
    db.rows[1] = { ...db.rows[1], project_name: "B project renamed", updated_at: "11:00" };
    const afterBWrite = await aKeyedList();
    expect(afterBWrite).toHaveLength(3);
    expect(afterBWrite.find((p) => p.id === "b1").name).toBe("B project renamed");
    expect(db.listCalls).toBe(2);
  });

  it("P1-3: the public example row is never in the cached private list — it is fetched fresh on every GET", async () => {
    const db = fakeListClient([
      { id: "a1", owner_id: "owner_a", project_name: "A project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "pub", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ]);
    const privateProjects = await schedulingPrivate(db);
    expect(privateProjects.map((p) => p.id)).toEqual(["a1"]);
    const publicFirst = await runInRealRequest(() =>
      fetchFreshPublicSchedulingProjects({
        supabaseClient: db.client,
        effectiveOwnerId: "user_1",
      }),
    );
    const publicSecond = await runInRealRequest(() =>
      fetchFreshPublicSchedulingProjects({
        supabaseClient: db.client,
        effectiveOwnerId: "user_1",
      }),
    );
    expect(publicFirst.result.map((p) => p.id)).toEqual(["pub"]);
    expect(publicSecond.result.map((p) => p.id)).toEqual(["pub"]);
    // Two fresh public selects (never cached) + one private list select.
    expect(db.listCalls).toBe(3);
  });

  it("a different actor re-queries instead of reading the first actor's cached entry", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    await schedulingPrivate(db);
    await runInRealRequest(() =>
      getCachedSchedulingPrivateProjects({
        supabaseClient: db.client,
        effectiveOwnerId: "user_1",
        actorId: "user_2",
      }),
    );
    expect(db.listCalls).toBe(2);
  });

  it("a different owner gets its own entry and its own rows (Designer)", async () => {
    const db = fakeListClient([
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
      { id: "d2", owner_id: "owner_2", project_name: "Theirs", created_at: "a", updated_at: "b" },
    ]);
    const mine = await designerList(db, "user_1", "user_1");
    const theirs = await designerList(db, "owner_2", "user_1");
    expect(mine.map((p) => p.id)).toEqual(["d1"]);
    expect(theirs.map((p) => p.id)).toEqual(["d2"]);
    expect(db.listCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  it("a co-owner's list is keyed by the canonical workspace owner, and a different actor under the same owner re-queries", async () => {
    const db = fakeListClient([
      { id: "d1", owner_id: "owner1", project_name: "Shared", created_at: "a", updated_at: "b" },
    ]);
    // Co-owner lists under the workspace owner id (auth already ran in the
    // route; here the keying is what is under test).
    const coOwner = await designerList(db, "owner1", "coowner9");
    expect(coOwner.map((p) => p.id)).toEqual(["d1"]);
    expect(db.listCalls).toBe(1);
    // A different actor under the same owner re-queries (actor is in the key).
    await designerList(db, "owner1", "owner1");
    expect(db.listCalls).toBe(2);
  });

  it("concurrent GETs on a cold cache both succeed with the same DTO and at most one extra list select", async () => {
    const db = fakeListClient([
      { id: "s1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ]);
    const [first, second] = await Promise.all([
      schedulingPrivate(db),
      schedulingPrivate(db),
    ]);
    expect(first).toEqual(second);
    expect(db.listCalls).toBeLessThanOrEqual(2);
  });

  it("updateTag throws in a Route Handler request context — there is no supported immediate-invalidation path here", async () => {
    await expect(
      runInRealRequest(() => {
        updateTag("forge-list:scheduling:owner:user_1");
        return null;
      }),
    ).rejects.toThrow("updateTag can only be called from within a Server Action");
  });
});

describe("mergeSchedulingProjectLists", () => {
  it("sorts updated_at desc, and equal timestamps keep private-first order (stable) — no byte-equivalence claim for arbitrary ties", () => {
    const merged = mergeSchedulingProjectLists(
      [{ id: "priv", updatedAt: "t" }],
      [{ id: "pub", updatedAt: "t" }],
    );
    expect(merged.map((p) => p.id)).toEqual(["priv", "pub"]);
    const ordered = mergeSchedulingProjectLists(
      [{ id: "old", updatedAt: "a" }],
      [{ id: "new", updatedAt: "z" }],
    );
    expect(ordered.map((p) => p.id)).toEqual(["new", "old"]);
  });
});
