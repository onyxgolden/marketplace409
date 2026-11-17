// S2A (load-times slice 2) — fix round 1: the Designer list GET is served
// from the hot-read server cache (src/lib/forge/listReadCache.js), and
// every GET below runs through the REAL installed Next.js 16.4.1 cache
// (real-incremental-cache-test-harness.js) inside a simulated Route
// Handler request — no fake cache. Counters prove what ran: the digest
// probe on every GET, the list select only on a cache miss. The Designer
// list is strictly owner-filtered (no public rows), so the whole DTO is
// cached.
import "@/lib/forge/real-incremental-cache-test-harness";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetRealIncrementalCache,
  runInRealRequest,
} from "@/lib/forge/real-incremental-cache-test-harness";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

// Every list GET runs inside a simulated Route Handler request, the way
// production runs it (see the harness). POST never touches the cache —
// freshness after a write comes from the digest probe, so POSTs run
// directly.
async function get(...args) {
  const { result } = await runInRealRequest(() => GET(...args), {
    pathname: "/api/forge/designer",
  });
  return result;
}

// List mock that honors the owner_id filter the query uses and counts the
// digest probe vs list selects separately — the cache proof. Each chain
// builds synchronously (.select().eq().order()), so order() captures the
// chain's filter flags at call time; the digest probe awaits the query
// directly (no order()), so the query's own `then` captures its filter
// the same way — that keeps concurrent GETs from mixing each other's
// filters even though the mock shares one query object. `insert` models
// the DB write: it appends the inserted record (created_at/updated_at
// defaulting to now, as the column defaults do) so a POST genuinely
// changes the digest the next GET probes.
//
// PostgREST fidelity (fix round 3): both the probe and the ordered list
// enforce the same per-response row cap production does (commonly 1,000;
// this repo's SupabaseFinancialEventRepository pages at 1,000 for exactly
// that reason), and the probe returns the exact total count, as
// count:"exact" does in production. Fixtures here are small, so the cap
// never binds — but a probe that assumed a complete single response
// would be caught by the module tests' capped fixtures, not by this mock
// silently returning unlimited rows.
const POSTGREST_MAX_ROWS = 1000;

function makeListNode(rows, counters, { failFirstListSelect = false, onInsert = null } = {}) {
  let ownerFilter;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col, val) => {
      if (col === "owner_id") ownerFilter = val;
      return query;
    }),
    order: vi.fn(() => {
      const capturedOwner = ownerFilter;
      const resolve = () => {
        const filtered =
          capturedOwner === undefined
            ? rows
            : rows.filter((row) => row.owner_id === capturedOwner);
        const sorted = [...filtered].sort((a, b) =>
          String(b.updated_at).localeCompare(String(a.updated_at)),
        );
        counters.listSelectCalls += 1;
        if (failFirstListSelect && !counters.failedOnce) {
          counters.failedOnce = true;
          return { data: null, error: new Error("db down") };
        }
        return { data: sorted.slice(0, POSTGREST_MAX_ROWS), error: null };
      };
      return {
        limit: vi.fn(async () => resolve()),
        then: (onFulfilled, onRejected) =>
          Promise.resolve(resolve()).then(onFulfilled, onRejected),
      };
    }),
    // Digest-probe path: the probe awaits the query directly (no order,
    // no limit) and resolves the filtered rows unsorted — the digest sorts
    // by id, so probe order is irrelevant. Truncated to the PostgREST cap
    // with the exact total count, as count:"exact" reports in production.
    then: (onFulfilled, onRejected) => {
      const capturedOwner = ownerFilter;
      const resolve = () => {
        counters.probeCalls += 1;
        const filtered =
          capturedOwner === undefined
            ? rows
            : rows.filter((row) => row.owner_id === capturedOwner);
        return {
          data: filtered.slice(0, POSTGREST_MAX_ROWS),
          error: null,
          count: filtered.length,
        };
      };
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
    insert: vi.fn((record) => {
      if (onInsert) onInsert(record);
      return query;
    }),
  };
  return query;
}

function listQuery(rows, { failFirstListSelect = false } = {}) {
  const counters = { listSelectCalls: 0, probeCalls: 0, failedOnce: false };
  const query = makeListNode(rows, counters, { failFirstListSelect });
  return {
    client: { from: vi.fn(() => query) },
    query,
    get listSelectCalls() {
      return counters.listSelectCalls;
    },
    get probeCalls() {
      return counters.probeCalls;
    },
  };
}

// Combined mock for the freshness tests: the same client serves the list
// GET (probe + list selects) and the create POST (insert), so a POST's
// write can be observed by the next GET through the real cache. An
// insertError models the insert itself failing (nothing appended).
function listAndInsertQuery(rows, { insertError = null } = {}) {
  const counters = { listSelectCalls: 0, probeCalls: 0, failedOnce: false };
  const onInsert = (record) => {
    rows.push({
      ...record,
      created_at: record.created_at ?? "c",
      updated_at: record.updated_at ?? "d",
    });
  };
  const query = makeListNode(rows, counters, { onInsert });
  // The Designer POST awaits the insert directly (no .select().single()
  // chain), so insert resolves {error} itself — and appends the row only
  // when the insert succeeded, modelling the DB write.
  query.insert = vi.fn(async (record) => {
    if (!insertError) onInsert(record);
    return { data: null, error: insertError };
  });
  return {
    client: { from: vi.fn(() => query) },
    query,
    rows,
    get listSelectCalls() {
      return counters.listSelectCalls;
    },
    get probeCalls() {
      return counters.probeCalls;
    },
  };
}

function authed(client) {
  return { user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: client };
}

function postRequest(name = "Master bath") {
  return new Request("https://test/api/forge/designer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

describe("GET /api/forge/designer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRealIncrementalCache();
  });

  it("lists the caller's designs newest-first", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      projects: [{ id: "d1", name: "Kitchen", createdAt: "a", updatedAt: "b" }],
    });
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "user_1");
  });

  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect((await get()).status).toBe(401);
  });

  it("returns 500 when the database fails", async () => {
    // The digest probe awaits the query directly (no order()), so the
    // failing query must fail the probe itself — not only the list read.
    const order = () => {
      const node = {
        limit: async () => ({ data: null, error: new Error("db down") }),
        then: (onFulfilled, onRejected) =>
          Promise.resolve({ data: null, error: new Error("db down") }).then(onFulfilled, onRejected),
      };
      return node;
    };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(order),
      then: (onFulfilled, onRejected) =>
        Promise.resolve({ data: null, error: new Error("db down") }).then(onFulfilled, onRejected),
    };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const response = await get();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to load room designs." });
  });

  it("S2A: repeat GET hits the cache — one DB list select, but the probe runs on every GET", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const first = await (await get()).json();
    const second = await (await get()).json();
    expect(second).toEqual(first);
    expect(db.listSelectCalls).toBe(1);
    expect(db.probeCalls).toBe(2);
  });

  it("S2A (fix round 2): renaming the OLDER design — updated_at still below the newest row's — is visible on the FIRST subsequent GET", async () => {
    // The round-2 counterexample at the route level: the older row's rename
    // leaves both the count and the max(updated_at) unchanged, so only a
    // digest over the row contents can see it.
    const rows = [
      { id: "d-old", owner_id: "user_1", project_name: "Older", created_at: "a", updated_at: "09:00" },
      { id: "d-new", owner_id: "user_1", project_name: "Newest", created_at: "a", updated_at: "18:00" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const warm = await (await get()).json();
    expect(warm.projects.map((p) => p.name)).toEqual(["Newest", "Older"]);
    expect(db.listSelectCalls).toBe(1);
    rows[0] = { ...rows[0], project_name: "Older renamed", updated_at: "10:00" };
    const firstAfterWrite = await (await get()).json();
    expect(firstAfterWrite.projects.map((p) => p.name)).toEqual(["Newest", "Older renamed"]);
    expect(db.listSelectCalls).toBe(2);
    expect(db.probeCalls).toBe(2);
  });

  it("S2A (fix round 2): delete + create preserving count and max is visible on the FIRST subsequent GET", async () => {
    const rows = [
      { id: "d-doomed", owner_id: "user_1", project_name: "Doomed", created_at: "a", updated_at: "m" },
      { id: "d-keeper", owner_id: "user_1", project_name: "Keeper", created_at: "a", updated_at: "z" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await get();
    expect(db.listSelectCalls).toBe(1);
    rows.splice(0, 1);
    rows.push({ id: "d-replacement", owner_id: "user_1", project_name: "Replacement", created_at: "a", updated_at: "z" });
    const firstAfterWrite = await (await get()).json();
    expect(firstAfterWrite.projects.map((p) => p.id).sort()).toEqual(["d-keeper", "d-replacement"]);
    expect(db.listSelectCalls).toBe(2);
  });

  it("S2A: a different actor re-queries instead of reading the first actor's cached entry", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_2" }, effectiveOwnerId: "user_1", supabaseClient: db.client });
    await get();
    await get();
    expect(db.listSelectCalls).toBe(2);
  });

  it("S2A: a different owner gets its own entry and its own rows", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
      { id: "d2", owner_id: "owner_2", project_name: "Theirs", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "owner_2", supabaseClient: db.client });
    const mine = await (await get()).json();
    const theirs = await (await get()).json();
    expect(mine.projects.map((p) => p.id)).toEqual(["d1"]);
    expect(theirs.projects.map((p) => p.id)).toEqual(["d2"]);
    expect(db.listSelectCalls).toBe(2);
  });

  it("S2A: auth still runs before the cache — a revoked actor gets the deny, not the cached list", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    expect((await get()).status).toBe(200);
    expect(db.listSelectCalls).toBe(1);
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    expect((await get()).status).toBe(403);
    expect(db.listSelectCalls).toBe(1);
  });

  it("S2A: an invalid workspace request is denied before any cache lookup", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    const response = await get(
      new Request("https://test/api/forge/designer?workspace=not-my-workspace"),
    );
    expect(response.status).toBe(403);
    expect(db.client.from).not.toHaveBeenCalled();
  });

  it("S2A: a failed list query is not cached — the next GET retries and succeeds", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows, { failFirstListSelect: true });
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    expect((await get()).status).toBe(500);
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toHaveLength(1);
    expect(db.listSelectCalls).toBe(2);
  });

  it("S2A: concurrent GETs on a cold cache both succeed with the same DTO and at most one extra list select", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const [first, second] = await Promise.all([get(), get()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(db.listSelectCalls).toBeLessThanOrEqual(2);
  });

  it("S2A: the response stays private and non-cacheable at the HTTP layer", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await get();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/forge/designer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRealIncrementalCache();
  });

  function insertClient() {
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const query = { insert };
    return { client: { from: vi.fn(() => query) }, insert };
  }

  it("creates a blank design owned by the caller", async () => {
    const db = insertClient();
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const request = new Request("https://test/api/forge/designer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Master bath" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe("string");
    const record = db.insert.mock.calls[0][0];
    expect(record.owner_id).toBe("user_1");
    expect(record.project_name).toBe("Master bath");
    // HOME DESIGNER slice 2: new projects are a one-level HomeProject
    // envelope, not a bare room-designer document.
    expect(Array.isArray(record.design.levels)).toBe(true);
    expect(record.design.levels).toHaveLength(1);
    expect(record.design.levels[0].design.walls).toEqual([]);
    expect(record.design.currentLevelId).toBe(record.design.levels[0].id);
  });

  it("falls back to 'Untitled design' with no name", async () => {
    const db = insertClient();
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const request = new Request("https://test/api/forge/designer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    await POST(request);
    expect(db.insert.mock.calls[0][0].project_name).toBe("Untitled design");
  });

  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    const request = new Request("https://test/api/forge/designer", { method: "POST" });
    expect((await POST(request)).status).toBe(401);
  });

  it("S2A: a successful POST makes the next GET fresh — the insert moves the digest, so the FIRST GET after the save re-queries", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await get();
    expect(db.listSelectCalls).toBe(1);
    const created = await POST(postRequest("Master bath"));
    expect(created.status).toBe(200);
    const createdId = (await created.json()).id;
    // The insert already appended the row (the mock models the DB write);
    // the next GET must see it, on the first try — no stale serve.
    const body = await (await get()).json();
    expect(db.listSelectCalls).toBe(2);
    expect(body.projects.map((p) => p.id)).toContain(createdId);
  });

  it("S2A: a failed POST (insert error) neither succeeds nor changes the cached list", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { insertError: { message: "insert failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await get();
    expect(db.listSelectCalls).toBe(1);
    const failed = await POST(postRequest("Master bath"));
    expect(failed.status).toBe(500);
    await get();
    expect(db.listSelectCalls).toBe(1);
  });

  it("S2A: back-to-back saves each move the digest — every GET after a save is fresh", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await get();
    await POST(postRequest("One"));
    await get();
    expect(db.listSelectCalls).toBe(2);
    await POST(postRequest("Two"));
    await get();
    expect(db.listSelectCalls).toBe(3);
  });

  it("S2A: a POST moves only its own owner's digest — another owner's cached entry survives", async () => {
    // Each owner's client models that owner's visible set: owner_2 cannot
    // see owner_1's rows, so owner_1's insert does not move owner_2's
    // probe digest.
    const rows1 = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const rows2 = [
      { id: "d2", owner_id: "user_2", project_name: "Theirs", created_at: "a", updated_at: "b" },
    ];
    const db1 = listAndInsertQuery(rows1);
    const db2 = listAndInsertQuery(rows2);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db1.client })
      .mockResolvedValueOnce({ user: { id: "user_2" }, effectiveOwnerId: "user_2", supabaseClient: db2.client })
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db1.client })
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db1.client })
      .mockResolvedValueOnce({ user: { id: "user_2" }, effectiveOwnerId: "user_2", supabaseClient: db2.client });
    await get(); // owner_1: select 1
    await get(); // owner_2: select 1 (own entry)
    await POST(postRequest("Master bath")); // owner_1's POST
    await get(); // owner_1: re-queries (2)
    await get(); // owner_2: still cached (stays 1)
    expect(db1.listSelectCalls).toBe(2);
    expect(db2.listSelectCalls).toBe(1);
  });

  it("S2A: a GET in flight while a POST writes still resolves, and the GET after the race is fresh", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await get();
    expect(db.listSelectCalls).toBe(1);
    const [racingGet, created] = await Promise.all([get(), POST(postRequest("Master bath"))]);
    expect(racingGet.status).toBe(200);
    expect(created.status).toBe(200);
    const createdId = (await created.json()).id;
    const body = await (await get()).json();
    expect(body.projects.map((p) => p.id)).toContain(createdId);
  });
});

describe("workspace authorization (primary owner vs co-owner vs unrelated user)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRealIncrementalCache();
  });

  function authedAs(userId, effectiveOwnerId, client) {
    return { user: { id: userId }, effectiveOwnerId, supabaseClient: client };
  }

  it("a co-owner lists designs under the canonical workspace owner id", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", db.client),
    );
    const response = await get();
    expect(response.status).toBe(200);
    // Queries scope to the effective owner, matching resolve_effective_owner_id()
    // on the DB side; has_workspace_access() permits the co-owner's read.
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "owner1");
  });

  it("a co-owner creates designs under the canonical workspace owner id", async () => {
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const client = { from: vi.fn(() => ({ insert })) };
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", client),
    );
    const request = new Request("https://test/api/forge/designer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Shared plan" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    // Rows are written under the workspace owner (not the co-owner's own id),
    // exactly what has_workspace_access() authorizes on the with-check side.
    expect(insert.mock.calls[0][0].owner_id).toBe("owner1");
  });

  it("an unrelated user only ever sees their own workspace", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("stranger7", "stranger7", db.client),
    );
    await get();
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "stranger7");
  });
});
