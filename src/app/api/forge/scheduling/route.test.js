// S2A (load-times slice 2) — fix round 1: the Scheduling list GET is
// served from the hot-read server cache (src/lib/forge/listReadCache.js),
// and every GET below runs through the REAL installed Next.js 16.4.1 cache
// (real-incremental-cache-test-harness.js) inside a simulated Route
// Handler request — no fake cache. Counters prove what ran: the digest
// probe on every GET, the private list select only on a cache miss, the
// public example rows fresh on every GET. The public example rows are
// fetched fresh on every GET and merged with the cached owner-scoped rows.
import "@/lib/forge/real-incremental-cache-test-harness";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRealIncrementalCache,
  runInRealRequest,
} from "@/lib/forge/real-incremental-cache-test-harness";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

// Every list GET runs inside a simulated Route Handler request, the way
// production runs it (see the harness). POST never touches the cache —
// freshness after a write comes from the digest probe, so POSTs run
// directly.
async function get(...args) {
  const { result } = await runInRealRequest(() => GET(...args));
  return result;
}

// List mock that honors the is_public filter the S2A split queries use,
// and counts the digest probe vs private vs public selects separately —
// the cache proof. Each chain builds synchronously (.select().eq()
// .order()), so order() captures the chain's filter flags at call time;
// the digest probe awaits the query directly (no order()), so the query's
// own `then` captures its filter the same way — that keeps concurrent
// GETs from mixing each other's filters even though the mock shares one
// query object. `insert` models the DB write: it appends the inserted
// record (is_public defaulting to false, as the column does) so a POST
// genuinely changes the digest the next GET probes.
function makeListNode(rows, counters, { failFirstListSelect = false, onInsert = null } = {}) {
  let isPublicFilter;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col, val) => {
      if (col === "is_public") isPublicFilter = val;
      return query;
    }),
    order: vi.fn(() => {
      const capturedIsPublic = isPublicFilter;
      const resolve = () => {
        const filtered =
          capturedIsPublic === undefined
            ? rows
            : rows.filter((row) => row.is_public === capturedIsPublic);
        const sorted = [...filtered].sort((a, b) =>
          String(b.updated_at).localeCompare(String(a.updated_at)),
        );
        if (capturedIsPublic === false) counters.privateSelectCalls += 1;
        else if (capturedIsPublic === true) counters.publicSelectCalls += 1;
        if (failFirstListSelect && !counters.failedOnce) {
          counters.failedOnce = true;
          return { data: null, error: { message: "list failed" } };
        }
        return { data: sorted, error: null };
      };
      return {
        limit: vi.fn(async () => resolve()),
        then: (onFulfilled, onRejected) =>
          Promise.resolve(resolve()).then(onFulfilled, onRejected),
      };
    }),
    // Digest-probe path: the probe awaits the query directly (no order,
    // no limit) and resolves the filtered rows unsorted — the digest sorts
    // by id, so probe order is irrelevant.
    then: (onFulfilled, onRejected) => {
      const capturedIsPublic = isPublicFilter;
      const resolve = () => {
        counters.probeCalls += 1;
        const filtered =
          capturedIsPublic === undefined
            ? rows
            : rows.filter((row) => row.is_public === capturedIsPublic);
        return { data: filtered, error: null };
      };
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
    insert: vi.fn((record) => {
      if (onInsert) onInsert(record);
      return query;
    }),
    single: vi.fn(async () => ({ data: counters.lastInsertRow || null, error: null })),
  };
  return query;
}

function listQuery(rows, { failFirstListSelect = false } = {}) {
  const counters = { privateSelectCalls: 0, publicSelectCalls: 0, probeCalls: 0, failedOnce: false };
  const query = makeListNode(rows, counters, { failFirstListSelect });
  return {
    client: { from: vi.fn(() => query) },
    query,
    get privateSelectCalls() {
      return counters.privateSelectCalls;
    },
    get publicSelectCalls() {
      return counters.publicSelectCalls;
    },
    get probeCalls() {
      return counters.probeCalls;
    },
  };
}

function insertQuery(row, { rpcError = null } = {}) {
  const single = vi.fn(async () => ({ data: row, error: null }));
  const query = { insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), single };
  const rpc = vi.fn(async () => ({ error: rpcError }));
  return { client: { from: vi.fn(() => query), rpc }, query, rpc };
}

// Combined mock for the freshness tests: the same client serves the list
// GET (probe + private/public selects) and the create POST
// (insert/select/single + sync RPC), so a POST's write can be observed by
// the next GET through the real cache. single() returns the id of the row
// the insert just appended, as production does; an insertError models the
// insert itself failing (nothing appended, single() resolves the error),
// while an rpcError models only the relational sync failing after the
// insert already landed.
function listAndInsertQuery(rows, { rpcError = null, insertError = null } = {}) {
  const counters = { privateSelectCalls: 0, publicSelectCalls: 0, probeCalls: 0, failedOnce: false, lastInsertRow: null };
  const onInsert = (record) => {
    if (insertError) return;
    const appended = { ...record, is_public: record.is_public ?? false };
    rows.push(appended);
    counters.lastInsertRow = { id: appended.id };
  };
  const query = makeListNode(rows, counters, { onInsert });
  query.single = vi.fn(async () =>
    insertError ? { data: null, error: insertError } : { data: counters.lastInsertRow, error: null },
  );
  const rpc = vi.fn(async () => ({ error: rpcError }));
  return {
    client: { from: vi.fn(() => query), rpc },
    query,
    rpc,
    rows,
    get privateSelectCalls() {
      return counters.privateSelectCalls;
    },
    get publicSelectCalls() {
      return counters.publicSelectCalls;
    },
    get probeCalls() {
      return counters.probeCalls;
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
    resetRealIncrementalCache();
  });

  it("marks rows the caller owns, vs. the shared public example, correctly", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "schedule_project_example", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await get();
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
    expect((await get()).status).toBe(401);
  });

  it("S2A: repeat GET hits the cache — one private DB list select; the probe runs every time and the public portion is still fetched fresh every time", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
      { id: "schedule_project_example", owner_id: "example", project_name: "Example project", start_date: "2026-01-01", end_date: "2026-12-31", is_public: true, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const first = await (await get()).json();
    const second = await (await get()).json();
    expect(second).toEqual(first);
    expect(db.privateSelectCalls).toBe(1);
    expect(db.publicSelectCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  it("S2A (fix round 2): renaming the OLDER project — updated_at still below the newest row's — is visible on the FIRST subsequent GET", async () => {
    // The round-2 counterexample at the route level: the older row's rename
    // leaves both the count and the max(updated_at) unchanged, so only a
    // digest over the row contents can see it.
    const rows = [
      { id: "p-old", owner_id: "user_1", project_name: "Older", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "09:00" },
      { id: "p-new", owner_id: "user_1", project_name: "Newest", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "18:00" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const warm = await (await get()).json();
    expect(warm.projects.map((p) => p.name)).toEqual(["Newest", "Older"]);
    expect(db.privateSelectCalls).toBe(1);
    rows[0] = { ...rows[0], project_name: "Older renamed", updated_at: "10:00" };
    const firstAfterWrite = await (await get()).json();
    expect(firstAfterWrite.projects.map((p) => p.name)).toEqual(["Newest", "Older renamed"]);
    expect(db.privateSelectCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  it("S2A (fix round 2): delete + create preserving count and max is visible on the FIRST subsequent GET", async () => {
    const rows = [
      { id: "p-doomed", owner_id: "user_1", project_name: "Doomed", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "m" },
      { id: "p-keeper", owner_id: "user_1", project_name: "Keeper", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "z" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await get();
    expect(db.privateSelectCalls).toBe(1);
    rows.splice(0, 1);
    rows.push({ id: "p-replacement", owner_id: "user_1", project_name: "Replacement", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "z" });
    const firstAfterWrite = await (await get()).json();
    expect(firstAfterWrite.projects.map((p) => p.id).sort()).toEqual(["p-keeper", "p-replacement"]);
    expect(db.privateSelectCalls).toBe(2);
  });

  it("S2A: a different actor re-queries instead of reading the first actor's cached entry", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ ...AUTH("user_1"), supabaseClient: db.client })
      .mockResolvedValueOnce({ ...AUTH("user_2"), supabaseClient: db.client });
    await get();
    const second = await (await get()).json();
    expect(second.projects).toHaveLength(1);
    expect(db.privateSelectCalls).toBe(2);
  });

  it("S2A: auth still runs before the cache — a revoked actor gets the deny, not the cached list", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    expect((await get()).status).toBe(200);
    expect(db.privateSelectCalls).toBe(1);
    // Membership revoked between requests: the factory now denies.
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    const denied = await get();
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
    expect((await get()).status).toBe(500);
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toHaveLength(1);
    expect(db.privateSelectCalls).toBe(2);
  });

  it("S2A: concurrent GETs on a cold cache both succeed with the same DTO and at most one extra list select", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const [first, second] = await Promise.all([get(), get()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(db.privateSelectCalls).toBeLessThanOrEqual(2);
  });

  it("S2A: the response stays private and non-cacheable at the HTTP layer", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    const response = await get();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/forge/scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRealIncrementalCache();
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

  it("S2A: a successful POST makes the next GET fresh — the insert moves the digest, so the FIRST GET after the save re-queries", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await get();
    expect(db.privateSelectCalls).toBe(1);
    const created = await POST(postRequest(undefined));
    expect(created.status).toBe(200);
    const createdId = (await created.json()).id;
    // The insert already appended the row (the mock models the DB write);
    // the next GET must see it, on the first try — no stale serve.
    const body = await (await get()).json();
    expect(db.privateSelectCalls).toBe(2);
    expect(body.projects.map((p) => p.id)).toContain(createdId);
  });

  it("S2A: a failed POST (insert error) neither succeeds nor changes the cached list", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { insertError: { message: "insert failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await get();
    expect(db.privateSelectCalls).toBe(1);
    const failed = await POST(postRequest(undefined));
    expect(failed.status).toBe(500);
    await get();
    expect(db.privateSelectCalls).toBe(1);
  });

  it("S2A: a failed POST (sync error) returns 500, but the next GET still re-queries — the insert itself landed, so the digest moved", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { rpcError: { message: "sync failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await get();
    expect(db.privateSelectCalls).toBe(1);
    const failed = await POST(postRequest(undefined));
    expect(failed.status).toBe(500);
    // The insert committed before the sync failed (separate statements, no
    // rollback), so the next GET's probe sees the new row and re-queries —
    // the list reflects the DB truth instead of serving the pre-write entry.
    const body = await (await get()).json();
    expect(db.privateSelectCalls).toBe(2);
    expect(body.projects).toHaveLength(2);
  });

  it("S2A: back-to-back saves each move the digest — every GET after a save is fresh", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await get();
    await POST(postRequest(undefined));
    await get();
    expect(db.privateSelectCalls).toBe(2);
    await POST(postRequest(undefined));
    await get();
    expect(db.privateSelectCalls).toBe(3);
  });

  it("S2A: a POST moves only its own owner's digest — another owner's cached entry survives", async () => {
    // Each actor's client models that actor's RLS-visible set: owner_2
    // cannot see owner_1's rows, so owner_1's insert does not move
    // owner_2's probe digest.
    const rows1 = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const rows2 = [
      { id: "p2", owner_id: "user_2", project_name: "Theirs", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db1 = listAndInsertQuery(rows1);
    const db2 = listAndInsertQuery(rows2);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ ...AUTH("user_1", "user_1"), supabaseClient: db1.client })
      .mockResolvedValueOnce({ ...AUTH("user_2", "user_2"), supabaseClient: db2.client })
      .mockResolvedValueOnce({ ...AUTH("user_1", "user_1"), supabaseClient: db1.client })
      .mockResolvedValueOnce({ ...AUTH("user_1", "user_1"), supabaseClient: db1.client })
      .mockResolvedValueOnce({ ...AUTH("user_2", "user_2"), supabaseClient: db2.client });
    await get(); // owner_1: private select 1
    await get(); // owner_2: private select 1 (own entry)
    await POST(postRequest(undefined)); // owner_1's POST
    await get(); // owner_1: re-queries (2)
    await get(); // owner_2: still cached (stays 1)
    expect(db1.privateSelectCalls).toBe(2);
    expect(db2.privateSelectCalls).toBe(1);
  });

  it("S2A: a GET in flight while a POST writes still resolves, and the GET after the race is fresh", async () => {
    const rows = [
      { id: "p1", owner_id: "user_1", project_name: "Mine", start_date: "2026-01-01", end_date: "2026-12-31", is_public: false, created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue({ ...AUTH(), supabaseClient: db.client });
    await get();
    expect(db.privateSelectCalls).toBe(1);
    const [racingGet, created] = await Promise.all([get(), POST(postRequest(undefined))]);
    expect(racingGet.status).toBe(200);
    expect(created.status).toBe(200);
    const createdId = (await created.json()).id;
    const body = await (await get()).json();
    expect(body.projects.map((p) => p.id)).toContain(createdId);
  });
});
