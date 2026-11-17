// S2A (load-times slice 2): the Scheduling list GET is served from the
// hot-read server cache (src/lib/forge/listReadCache.js). next/cache is
// mocked with the synthetic tag-aware cache
// (incremental-cache-test-fake.js), so "repeat hit = one DB list select"
// is proven by the counters below. The public example rows are fetched
// fresh on every GET and merged with the cached owner-scoped rows.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", async () => {
  const actual = await vi.importActual("next/cache");
  const fake = await import("@/lib/forge/incremental-cache-test-fake");
  return {
    ...actual,
    unstable_cache: (...args) => fake.unstable_cache(...args),
    revalidateTag: (...args) => fake.revalidateTag(...args),
  };
});
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));

import * as testCache from "@/lib/forge/incremental-cache-test-fake";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

const OWNER_TAG = "forge-list:scheduling:owner:user_1";

// List mock that honors the is_public filter the S2A split queries use,
// and counts private vs public selects separately — the cache proof.
function listQuery(rows, { failFirstListSelect = false } = {}) {
  let privateSelectCalls = 0;
  let publicSelectCalls = 0;
  let isPublicFilter;
  let failedOnce = false;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col, val) => {
      if (col === "is_public") isPublicFilter = val;
      return query;
    }),
    order: vi.fn(async () => {
      if (isPublicFilter === false) privateSelectCalls += 1;
      else if (isPublicFilter === true) publicSelectCalls += 1;
      if (failFirstListSelect && !failedOnce) {
        failedOnce = true;
        return { data: null, error: { message: "list failed" } };
      }
      const filtered =
        isPublicFilter === undefined
          ? rows
          : rows.filter((row) => row.is_public === isPublicFilter);
      return { data: filtered, error: null };
    }),
  };
  return {
    client: { from: vi.fn(() => query) },
    query,
    get privateSelectCalls() {
      return privateSelectCalls;
    },
    get publicSelectCalls() {
      return publicSelectCalls;
    },
  };
}

function insertQuery(row, { rpcError = null } = {}) {
  const single = vi.fn(async () => ({ data: row, error: null }));
  const query = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single };
  const rpc = vi.fn(async () => ({ error: rpcError }));
  return { client: { from: vi.fn(() => query), rpc }, query, rpc };
}

// Combined mock for the invalidation tests: the same client serves the
// list GET (select/eq/order) and the create POST (insert/select/single +
// sync RPC), so a POST's invalidation can be observed by the next GET.
function listAndInsertQuery(rows, insertRow, { rpcError = null } = {}) {
  let privateSelectCalls = 0;
  let publicSelectCalls = 0;
  let isPublicFilter;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col, val) => {
      if (col === "is_public") isPublicFilter = val;
      return query;
    }),
    order: vi.fn(async () => {
      if (isPublicFilter === false) privateSelectCalls += 1;
      else if (isPublicFilter === true) publicSelectCalls += 1;
      const filtered =
        isPublicFilter === undefined
          ? rows
          : rows.filter((row) => row.is_public === isPublicFilter);
      return { data: filtered, error: null };
    }),
    insert: vi.fn(() => query),
    single: vi.fn(async () => ({ data: insertRow, error: null })),
  };
  const rpc = vi.fn(async () => ({ error: rpcError }));
  return {
    client: { from: vi.fn(() => query), rpc },
    query,
    rpc,
    rows,
    get privateSelectCalls() {
      return privateSelectCalls;
    },
    get publicSelectCalls() {
      return publicSelectCalls;
    },
  };
}

function postRequest(body) {
  return new Request("https://test/api/forge/scheduling", {
    method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const AUTH = (userId = "user_1", effectiveOwnerId = "user_1") => ({
  user: { id: userId },
  effectiveOwnerId,
});

describe("GET /api/forge/scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    testCache.resetTestIncrementalCache();
  });

  it("marks rows the caller owns, vs. the shared public example, correctly", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "schedule_project_example", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toEqual([
      { id: "p1", name: "Mine", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "a", updatedAt: "b", isOwner: true, isPublic: false },
      { id: "schedule_project_example", name: "Example project", startDate: "2026-01-01", endDate: "2026-12-31", createdAt: "a", updatedAt: "b", isOwner: false, isPublic: true },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    const unauthorized = new Response(null, { status: 401 });
    createAuthenticatedForgeApplication.mockResolvedValue({ response: unauthorized });
    expect((await GET()).status).toBe(401);
  });

  it("S2A: repeat GET hits the cache — one private DB list select; the public portion is still fetched fresh every time", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "schedule_project_example", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    expect(second).toEqual(first);
    expect(db.privateSelectCalls).toBe(1);
    expect(db.publicSelectCalls).toBe(2);
  });

  it("S2A: a different actor re-queries instead of reading the first actor's cached entry", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ ...AUTH("user_1"), supabaseClient: db.client })
      .mockResolvedValueOnce({ ...AUTH("user_2"), supabaseClient: db.client });
    await GET();
    const second = await (await GET()).json();
    expect(second.projects).toHaveLength(1);
    expect(db.privateSelectCalls).toBe(2);
  });

  it("S2A: auth still runs before the cache — a revoked actor gets the deny, not the cached list", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    expect((await GET()).status).toBe(200);
    expect(db.privateSelectCalls).toBe(1);
    // Membership revoked between requests: the factory now denies.
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    const denied = await GET();
    expect(denied.status).toBe(403);
    // No second private select happened (auth denied first) and no cached
    // rows leaked to the denied caller.
    expect(db.privateSelectCalls).toBe(1);
  });

  it("S2A: a failed list query is not cached — the next GET retries and succeeds", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows, { failFirstListSelect: true });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    expect((await GET()).status).toBe(500);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toHaveLength(1);
    expect(db.privateSelectCalls).toBe(2);
  });

  it("S2A: after the 15s TTL the next GET re-queries", async () => {
    vi.useFakeTimers();
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await GET();
    await vi.advanceTimersByTimeAsync(14000);
    await GET();
    expect(db.privateSelectCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await GET();
    expect(db.privateSelectCalls).toBe(2);
  });

  it("S2A: concurrent GETs on a cold cache both succeed with the same DTO and at most one extra list select", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const [first, second] = await Promise.all([GET(), GET()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(db.privateSelectCalls).toBeLessThanOrEqual(2);
  });

  it("S2A: the response stays private and non-cacheable at the HTTP layer", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/forge/scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    testCache.resetTestIncrementalCache();
  });

  it("creates a new project owned by the caller and returns its id, defaulting to the capital template with no body", async () => {
    const db = insertQuery({ id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await POST(postRequest(undefined));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "schedule_project_new" });
    expect(db.query.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "user_1", project_name: "New Project" }));
    const savedBoard = db.query.insert.mock.calls[0][0].board;
    expect(savedBoard.templateId).toBe("capital");
  });

  it("seeds the requested template's lanes and starter chips", async () => {
    const db = insertQuery({ id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await POST(postRequest({ templateId: "home_remodel" }));
    expect(response.status).toBe(200);
    const savedBoard = db.query.insert.mock.calls[0][0].board;
    expect(savedBoard.templateId).toBe("home_remodel");
    expect(savedBoard.lanes.map((l) => l.name)).toContain("Demolition");
  });

  it("syncs the new project's relational rows immediately -- GET reads from schedule_projects, so a newly-created project must be usable on its very first load", async () => {
    const db = insertQuery({ id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await POST(postRequest(undefined));
    expect(db.rpc).toHaveBeenCalledWith("sync_schedule_project_from_board", { p_owner_id: "user_1", p_project_id: "schedule_project_new" });
  });

  it("fails the request (unlike the PUT route's best-effort sync) when the relational sync errors, since the project wouldn't be usable otherwise", async () => {
    const db = insertQuery({ id: "schedule_project_new" }, { rpcError: { message: "sync failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await POST(postRequest(undefined));
    expect(response.status).toBe(500);
  });

  it("S2A: a successful POST invalidates the owner's list — the next GET returns fresh data, not the cached list", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await GET();
    expect(db.privateSelectCalls).toBe(1);
    const created = await POST(postRequest(undefined));
    expect(created.status).toBe(200);
    expect(testCache.revalidateTagCalls).toContain(OWNER_TAG);
    // The DB now holds the new project; the next GET must see it.
    db.rows.push({ id: "schedule_project_new", owner_id: "user_1", project_name: "New Project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "c", updated_at: "d" });
    const body = await (await GET()).json();
    expect(db.privateSelectCalls).toBe(2);
    expect(body.projects.map((p) => p.id)).toContain("schedule_project_new");
  });

  it("S2A: a failed POST (sync error) neither succeeds nor invalidates the cached list", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { id: "schedule_project_new" }, { rpcError: { message: "sync failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await GET();
    expect(db.privateSelectCalls).toBe(1);
    const failed = await POST(postRequest(undefined));
    expect(failed.status).toBe(500);
    expect(testCache.revalidateTagCalls).toEqual([]);
    await GET();
    expect(db.privateSelectCalls).toBe(1);
  });

  it("S2A: back-to-back saves each invalidate — every GET after a save is fresh", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await GET();
    await POST(postRequest(undefined));
    await GET();
    expect(db.privateSelectCalls).toBe(2);
    await POST(postRequest(undefined));
    await GET();
    expect(db.privateSelectCalls).toBe(3);
  });

  it("S2A: a POST invalidates only its own owner's list — another owner's cached entry survives", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { id: "schedule_project_new" });
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ ...AUTH("user_1", "user_1"), supabaseClient: db.client })
      .mockResolvedValueOnce({ ...AUTH("user_2", "user_2"), supabaseClient: db.client })
      .mockResolvedValueOnce({ ...AUTH("user_1", "user_1"), supabaseClient: db.client })
      .mockResolvedValueOnce({ ...AUTH("user_1", "user_1"), supabaseClient: db.client })
      .mockResolvedValueOnce({ ...AUTH("user_2", "user_2"), supabaseClient: db.client });
    await GET(); // owner_1: private select 1
    await GET(); // owner_2: private select 2 (own entry)
    await POST(postRequest(undefined)); // owner_1's POST
    expect(testCache.revalidateTagCalls).toEqual([OWNER_TAG]);
    await GET(); // owner_1: re-queries (3)
    await GET(); // owner_2: still cached (stays 3)
    expect(db.privateSelectCalls).toBe(3);
  });

  it("S2A: a GET in flight while a POST invalidates still resolves, and the GET after the race is fresh", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { id: "schedule_project_new" });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await GET();
    expect(db.privateSelectCalls).toBe(1);
    const [racingGet, created] = await Promise.all([GET(), POST(postRequest(undefined))]);
    expect(racingGet.status).toBe(200);
    expect(created.status).toBe(200);
    db.rows.push({ id: "schedule_project_new", owner_id: "user_1", project_name: "New Project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "c", updated_at: "d" });
    const body = await (await GET()).json();
    expect(body.projects.map((p) => p.id)).toContain("schedule_project_new");
  });
});
