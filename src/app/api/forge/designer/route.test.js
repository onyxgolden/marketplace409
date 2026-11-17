// S2A (load-times slice 2): the Designer list GET is served from the
// hot-read server cache (src/lib/forge/listReadCache.js). next/cache is
// mocked with the synthetic tag-aware cache
// (incremental-cache-test-fake.js), so "repeat hit = one DB list select"
// is proven by the counters below. The Designer list is strictly
// owner-filtered (no public rows), so the whole DTO is cached.
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
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));

import * as testCache from "@/lib/forge/incremental-cache-test-fake";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { GET, POST } from "./route";

const OWNER_TAG = "forge-list:designer:owner:user_1";

// List mock that honors the owner_id filter the query uses and counts list
// selects — the cache proof.
function listQuery(rows, { failFirstListSelect = false } = {}) {
  let listSelectCalls = 0;
  let ownerFilter;
  let failedOnce = false;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col, val) => {
      if (col === "owner_id") ownerFilter = val;
      return query;
    }),
    order: vi.fn(async () => {
      listSelectCalls += 1;
      if (failFirstListSelect && !failedOnce) {
        failedOnce = true;
        return { data: null, error: new Error("db down") };
      }
      const filtered =
        ownerFilter === undefined
          ? rows
          : rows.filter((row) => row.owner_id === ownerFilter);
      return { data: filtered, error: null };
    }),
  };
  return {
    client: { from: vi.fn(() => query) },
    query,
    get listSelectCalls() {
      return listSelectCalls;
    },
  };
}

// Combined mock for the invalidation tests: the same client serves the
// list GET (select/eq/order) and the create POST (insert), so a POST's
// invalidation can be observed by the next GET.
function listAndInsertQuery(rows, { insertError = null } = {}) {
  let listSelectCalls = 0;
  let ownerFilter;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((col, val) => {
      if (col === "owner_id") ownerFilter = val;
      return query;
    }),
    order: vi.fn(async () => {
      listSelectCalls += 1;
      const filtered =
        ownerFilter === undefined
          ? rows
          : rows.filter((row) => row.owner_id === ownerFilter);
      return { data: filtered, error: null };
    }),
    insert: vi.fn(async () => ({ error: insertError })),
  };
  return {
    client: { from: vi.fn(() => query) },
    query,
    rows,
    get listSelectCalls() {
      return listSelectCalls;
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
    vi.useRealTimers();
    testCache.resetTestIncrementalCache();
  });

  it("lists the caller's designs newest-first", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET();
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
    expect((await GET()).status).toBe(401);
  });

  it("returns 500 when the database fails", async () => {
    const order = vi.fn(async () => ({ data: null, error: new Error("db down") }));
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to load room designs." });
  });

  it("S2A: repeat GET hits the cache — one DB list select", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    expect(second).toEqual(first);
    expect(db.listSelectCalls).toBe(1);
  });

  it("S2A: a different actor re-queries instead of reading the first actor's cached entry", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_2" }, effectiveOwnerId: "user_1", supabaseClient: db.client });
    await GET();
    await GET();
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
    const mine = await (await GET()).json();
    const theirs = await (await GET()).json();
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
    expect((await GET()).status).toBe(200);
    expect(db.listSelectCalls).toBe(1);
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    expect((await GET()).status).toBe(403);
    expect(db.listSelectCalls).toBe(1);
  });

  it("S2A: an invalid workspace request is denied before any cache lookup", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    const response = await GET(
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
    expect((await GET()).status).toBe(500);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).projects).toHaveLength(1);
    expect(db.listSelectCalls).toBe(2);
  });

  it("S2A: after the 15s TTL the next GET re-queries", async () => {
    vi.useFakeTimers();
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await GET();
    await vi.advanceTimersByTimeAsync(14000);
    await GET();
    expect(db.listSelectCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await GET();
    expect(db.listSelectCalls).toBe(2);
  });

  it("S2A: concurrent GETs on a cold cache both succeed with the same DTO and at most one extra list select", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const [first, second] = await Promise.all([GET(), GET()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(db.listSelectCalls).toBeLessThanOrEqual(2);
  });

  it("S2A: the response stays private and non-cacheable at the HTTP layer", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/forge/designer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    testCache.resetTestIncrementalCache();
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

  it("S2A: a successful POST invalidates the owner's list — the next GET returns fresh data", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await GET();
    expect(db.listSelectCalls).toBe(1);
    const created = await POST(postRequest("Master bath"));
    expect(created.status).toBe(200);
    expect(testCache.revalidateTagCalls).toContain(OWNER_TAG);
    db.rows.push({ id: "d-new", owner_id: "user_1", project_name: "Master bath", created_at: "c", updated_at: "d" });
    const body = await (await GET()).json();
    expect(db.listSelectCalls).toBe(2);
    expect(body.projects.map((p) => p.id)).toContain("d-new");
  });

  it("S2A: a failed POST (insert error) neither succeeds nor invalidates the cached list", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows, { insertError: { message: "insert failed" } });
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await GET();
    expect(db.listSelectCalls).toBe(1);
    const failed = await POST(postRequest("Master bath"));
    expect(failed.status).toBe(500);
    expect(testCache.revalidateTagCalls).toEqual([]);
    await GET();
    expect(db.listSelectCalls).toBe(1);
  });

  it("S2A: back-to-back saves each invalidate — every GET after a save is fresh", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await GET();
    await POST(postRequest("One"));
    await GET();
    expect(db.listSelectCalls).toBe(2);
    await POST(postRequest("Two"));
    await GET();
    expect(db.listSelectCalls).toBe(3);
  });

  it("S2A: a POST invalidates only its own owner's list — another owner's cached entry survives", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_2" }, effectiveOwnerId: "user_2", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: db.client })
      .mockResolvedValueOnce({ user: { id: "user_2" }, effectiveOwnerId: "user_2", supabaseClient: db.client });
    await GET(); // owner_1: select 1
    await GET(); // owner_2: select 2 (own entry)
    await POST(postRequest("Master bath")); // owner_1's POST
    expect(testCache.revalidateTagCalls).toEqual([OWNER_TAG]);
    await GET(); // owner_1: re-queries (3)
    await GET(); // owner_2: still cached (stays 3)
    expect(db.listSelectCalls).toBe(3);
  });

  it("S2A: a GET in flight while a POST invalidates still resolves, and the GET after the race is fresh", async () => {
    const rows = [
      { id: "d1", owner_id: "user_1", project_name: "Kitchen", created_at: "a", updated_at: "b" },
    ];
    const db = listAndInsertQuery(rows);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    await GET();
    expect(db.listSelectCalls).toBe(1);
    const [racingGet, created] = await Promise.all([GET(), POST(postRequest("Master bath"))]);
    expect(racingGet.status).toBe(200);
    expect(created.status).toBe(200);
    db.rows.push({ id: "d-new", owner_id: "user_1", project_name: "Master bath", created_at: "c", updated_at: "d" });
    const body = await (await GET()).json();
    expect(body.projects.map((p) => p.id)).toContain("d-new");
  });
});

describe("workspace authorization (primary owner vs co-owner vs unrelated user)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    testCache.resetTestIncrementalCache();
  });

  function authedAs(userId, effectiveOwnerId, client) {
    return { user: { id: userId }, effectiveOwnerId, supabaseClient: client };
  }

  it("a co-owner lists designs under the canonical workspace owner id", async () => {
    const db = listQuery([]);
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", db.client),
    );
    const response = await GET();
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
    await GET();
    expect(db.query.eq).toHaveBeenCalledWith("owner_id", "stranger7");
  });
});
