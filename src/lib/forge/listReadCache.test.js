// S2A (load-times slice 2): server cache proof for the two list DTOs.
// The next/cache mock below swaps in the synthetic cache
// (incremental-cache-test-fake.js), which models the deployed Next.js
// 16.4.1 contract: tag revalidation = immediate miss (no stale serve),
// TTL expiry = miss, errors never stored. The DB is a counting in-memory
// fake, so "repeat hit = one DB list select" is proven by the counter.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async () => {
  const actual = await vi.importActual("next/cache");
  const fake = await import("@/lib/forge/incremental-cache-test-fake");
  return {
    ...actual,
    // Delegating wrappers (not direct references) so a test can spyOn the
    // fake module and intercept what listReadCache.js calls.
    unstable_cache: (...args) => fake.unstable_cache(...args),
    revalidateTag: (...args) => fake.revalidateTag(...args),
  };
});

import * as testCache from "@/lib/forge/incremental-cache-test-fake";
import {
  FORGE_LIST_CACHE_TTL_SECONDS,
  fetchFreshPublicSchedulingProjects,
  forgeListCacheTag,
  getCachedDesignerProjects,
  getCachedSchedulingPrivateProjects,
  invalidateForgeProjectList,
  mergeSchedulingProjectLists,
} from "./listReadCache";

const OWNER = "owner_1";
const ACTOR_A = "actor_a";
const ACTOR_B = "actor_b";

const SCHED_PRIVATE = {
  id: "s1", owner_id: OWNER, project_name: "Mine", start_date: "2026-01-01",
  end_date: "2026-12-31", is_public: false,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z",
};
const SCHED_PUBLIC = {
  id: "s2", owner_id: "example", project_name: "Example project", start_date: "2026-01-01",
  end_date: "2026-12-31", is_public: true,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z",
};
const DESIGNER_ROW = {
  id: "d1", owner_id: OWNER, project_name: "House",
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z",
};

// In-memory Supabase stand-in: .from().select().eq().order() is thenable
// and resolves the filtered rows; every terminal await counts one list
// select, which is the cache proof's counter.
//
// RLS model: the Scheduling list query carries NO owner filter —
// visibility comes from RLS (has_workspace_access). The fake models that
// with setVisibleOwnerIds: when set, forge_scheduling_projects rows are
// restricted to the visible owners (public rows stay visible to all);
// when unset, every row is visible. Designer rows are already
// owner-filtered by the query itself.
function makeDb({ schedulingRows = [], designerRows = [], error = null } = {}) {
  let listSelectCalls = 0;
  let currentError = error;
  let visibleOwnerIds = null;
  const client = {
    from(table) {
      let rows =
        table === "forge_scheduling_projects" ? [...schedulingRows] : [...designerRows];
      if (visibleOwnerIds !== null) {
        rows = rows.filter(
          (row) =>
            visibleOwnerIds.includes(row.owner_id) ||
            (table === "forge_scheduling_projects" && row.is_public),
        );
      }
      const node = {
        select: vi.fn(() => node),
        eq: vi.fn((col, val) => {
          rows = rows.filter((row) => row[col] === val);
          return node;
        }),
        order: vi.fn((col, { ascending }) => {
          rows = [...rows].sort((a, b) =>
            a[col] === b[col] ? 0 : a[col] < b[col] ? (ascending ? -1 : 1) : ascending ? 1 : -1,
          );
          return node;
        }),
        then: (resolve, reject) => {
          listSelectCalls += 1;
          return Promise.resolve(
            currentError ? { data: null, error: currentError } : { data: rows, error: null },
          ).then(resolve, reject);
        },
      };
      return node;
    },
    get listSelectCalls() {
      return listSelectCalls;
    },
    setError(nextError) {
      currentError = nextError;
    },
    setVisibleOwnerIds(ownerIds) {
      visibleOwnerIds = ownerIds;
    },
  };
  return client;
}

const schedulingArgs = (db, actorId = ACTOR_A, effectiveOwnerId = OWNER) => ({
  supabaseClient: db,
  effectiveOwnerId,
  actorId,
});
const designerArgs = (db, actorId = ACTOR_A, ownerId = OWNER) => ({
  supabaseClient: db,
  ownerId,
  actorId,
});

describe("S2A list read cache", () => {
  beforeEach(() => {
    testCache.resetTestIncrementalCache();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("cold miss returns the exact Scheduling private DTO (mapping, isOwner, isPublic)", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE, SCHED_PUBLIC] });
    const projects = await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    expect(projects).toEqual([
      {
        id: "s1", name: "Mine", startDate: "2026-01-01", endDate: "2026-12-31",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
        isOwner: true, isPublic: false,
      },
    ]);
    // The public row is NOT in the cached portion — it is fetched fresh.
    expect(db.listSelectCalls).toBe(1);
  });

  it("repeat Scheduling hit = one DB list select; the callback is not re-invoked", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE] });
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    expect(db.listSelectCalls).toBe(1);
  });

  it("owner/actor A/B isolation: a different actor re-queries instead of reading the first actor's entry", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE] });
    await getCachedSchedulingPrivateProjects(schedulingArgs(db, ACTOR_A));
    await getCachedSchedulingPrivateProjects(schedulingArgs(db, ACTOR_B));
    expect(db.listSelectCalls).toBe(2);
  });

  it("owner A/B isolation: a different owner gets its own entry and its own rows", async () => {
    const db = makeDb({
      schedulingRows: [
        SCHED_PRIVATE,
        { ...SCHED_PRIVATE, id: "s9", owner_id: "owner_2", project_name: "Theirs" },
      ],
    });
    // RLS: the actor's selected workspace determines which rows the query
    // can see (the query itself carries no owner filter).
    db.setVisibleOwnerIds([OWNER]);
    const mine = await getCachedSchedulingPrivateProjects(schedulingArgs(db, ACTOR_A, OWNER));
    db.setVisibleOwnerIds(["owner_2"]);
    const theirs = await getCachedSchedulingPrivateProjects(schedulingArgs(db, ACTOR_A, "owner_2"));
    expect(mine.map((p) => p.id)).toEqual(["s1"]);
    expect(theirs.map((p) => p.id)).toEqual(["s9"]);
    expect(db.listSelectCalls).toBe(2);
  });

  it("public Scheduling rows are fetched fresh on every GET (never cached)", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PUBLIC] });
    await fetchFreshPublicSchedulingProjects(schedulingArgs(db));
    await fetchFreshPublicSchedulingProjects(schedulingArgs(db));
    expect(db.listSelectCalls).toBe(2);
  });

  it("mergeSchedulingProjectLists reproduces the single-query DTO: updated_at desc, private first on ties", () => {
    const privateProjects = [
      { id: "p-old", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "p-new", updatedAt: "2026-03-01T00:00:00.000Z" },
    ];
    const publicProjects = [{ id: "pub", updatedAt: "2026-02-01T00:00:00.000Z" }];
    expect(mergeSchedulingProjectLists(privateProjects, publicProjects).map((p) => p.id)).toEqual([
      "p-new", "pub", "p-old",
    ]);
    // Tie: the pre-S2A single query returned both seeded rows at the same
    // updated_at; private-first is the deterministic tie-break.
    expect(
      mergeSchedulingProjectLists(
        [{ id: "priv", updatedAt: "2026-02-01T00:00:00.000Z" }],
        [{ id: "pub", updatedAt: "2026-02-01T00:00:00.000Z" }],
      ).map((p) => p.id),
    ).toEqual(["priv", "pub"]);
  });

  it("errors are not cached: a failed query is retried on the next request", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE], error: { message: "boom" } });
    await expect(getCachedSchedulingPrivateProjects(schedulingArgs(db))).rejects.toEqual({
      message: "boom",
    });
    db.setError(null);
    const projects = await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    expect(projects).toHaveLength(1);
    expect(db.listSelectCalls).toBe(2);
  });

  it("TTL expiry: after the 15s TTL the next request re-queries", async () => {
    vi.useFakeTimers();
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE] });
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    await vi.advanceTimersByTimeAsync((FORGE_LIST_CACHE_TTL_SECONDS - 1) * 1000);
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    expect(db.listSelectCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    expect(db.listSelectCalls).toBe(2);
  });

  it("invalidation drops the Scheduling entry by owner+app tag and the next GET returns fresh data", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE] });
    await getCachedSchedulingPrivateProjects(schedulingArgs(db));
    expect(db.listSelectCalls).toBe(1);
    invalidateForgeProjectList("scheduling", OWNER);
    expect(testCache.revalidateTagCalls).toContain(
      forgeListCacheTag("scheduling", OWNER),
    );
    const renamed = { ...SCHED_PRIVATE, project_name: "Renamed" };
    db.setError(null);
    // Swap the rows the DB would return, via a fresh client on the same store.
    const db2 = makeDb({ schedulingRows: [renamed] });
    // The second client must share the call counter story: re-query happens.
    const projects = await getCachedSchedulingPrivateProjects({
      supabaseClient: db2, effectiveOwnerId: OWNER, actorId: ACTOR_A,
    });
    expect(projects[0].name).toBe("Renamed");
    expect(db2.listSelectCalls).toBe(1);
  });

  it("invalidation is owner-scoped: invalidating owner_2 does not drop owner_1's entry", async () => {
    const db = makeDb({ schedulingRows: [SCHED_PRIVATE] });
    await getCachedSchedulingPrivateProjects(schedulingArgs(db, ACTOR_A, OWNER));
    invalidateForgeProjectList("scheduling", "owner_2");
    await getCachedSchedulingPrivateProjects(schedulingArgs(db, ACTOR_A, OWNER));
    expect(db.listSelectCalls).toBe(1);
  });

  it("a failing invalidation does not throw (the write already landed; the TTL bounds staleness)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    testCache.failNextRevalidateTagOnce(new Error("cache down"));
    expect(() => invalidateForgeProjectList("scheduling", OWNER)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Forge list cache invalidation failed"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("cold miss returns the exact Designer DTO; repeat hit = one DB list select", async () => {
    const db = makeDb({ designerRows: [DESIGNER_ROW] });
    const projects = await getCachedDesignerProjects(designerArgs(db));
    expect(projects).toEqual([
      {
        id: "d1", name: "House",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    await getCachedDesignerProjects(designerArgs(db));
    expect(db.listSelectCalls).toBe(1);
  });

  it("Designer owner/actor A/B isolation: different actor or owner re-queries", async () => {
    const db = makeDb({ designerRows: [DESIGNER_ROW] });
    await getCachedDesignerProjects(designerArgs(db, ACTOR_A));
    await getCachedDesignerProjects(designerArgs(db, ACTOR_B));
    await getCachedDesignerProjects(designerArgs(db, ACTOR_A, "owner_2"));
    expect(db.listSelectCalls).toBe(3);
  });

  it("invalidation drops the Designer entry and the next GET returns fresh data", async () => {
    const db = makeDb({ designerRows: [DESIGNER_ROW] });
    await getCachedDesignerProjects(designerArgs(db));
    invalidateForgeProjectList("designer", OWNER);
    expect(testCache.revalidateTagCalls).toContain(forgeListCacheTag("designer", OWNER));
    const db2 = makeDb({ designerRows: [{ ...DESIGNER_ROW, project_name: "Renamed" }] });
    const projects = await getCachedDesignerProjects({
      supabaseClient: db2, ownerId: OWNER, actorId: ACTOR_A,
    });
    expect(projects[0].name).toBe("Renamed");
    expect(db2.listSelectCalls).toBe(1);
  });
});
