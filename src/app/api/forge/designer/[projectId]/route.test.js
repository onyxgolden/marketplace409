// S2A (load-times slice 2) — fix round 1: the [projectId] routes perform
// no cache operation (freshness after a write comes from the list GET's
// generation probe — see listReadCache.js), so the freshness proof lives in
// the "S2A list freshness" section below, which warms the sibling list GET
// through the REAL installed Next.js 16.4.1 cache
// (real-incremental-cache-test-harness.js) and verifies the FIRST list GET
// after a PUT/DELETE is fresh.
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
import { createEmptyDesign, addWall } from "@/domains/roomDesigner/designerDocument";
import { addLevel, createHomeProject } from "@/domains/roomDesigner/homeProject";
import { DELETE, GET, PUT } from "./route";
import { GET as GET_LIST } from "../route";

beforeEach(() => resetRealIncrementalCache());

// The sibling list GET, run inside a simulated Route Handler request.
async function listGet(...args) {
  const { result } = await runInRealRequest(() => GET_LIST(...args), {
    pathname: "/api/forge/designer",
  });
  return result;
}

// List-capable client for the freshness tests: designer_projects serves
// the list probe + list selects (select/eq/order/limit, counting probe vs
// list), the PUT chain (update/eq/select, awaited directly — the update
// applies the record to the shared rows, modelling the DB write), and the
// DELETE chain (delete/eq, awaited directly). `rows` is the mutable
// visible set.
function freshnessDb(rows) {
  const counters = { listSelectCalls: 0, probeCalls: 0 };
  let ownerFilter;
  let isProbe = false;
  let lastUpdate = null;
  let deleted = false;
  const node = {
    select: vi.fn((_columns, selectOptions) => {
      isProbe = selectOptions?.count === "exact";
      return node;
    }),
    eq: vi.fn((col, val) => {
      if (col === "owner_id") ownerFilter = val;
      return node;
    }),
    order: vi.fn(() => {
      const capturedOwner = ownerFilter;
      const capturedIsProbe = isProbe;
      const resolve = (limit) => {
        const filtered =
          capturedOwner === undefined
            ? rows
            : rows.filter((row) => row.owner_id === capturedOwner);
        const sorted = [...filtered].sort((a, b) =>
          String(b.updated_at).localeCompare(String(a.updated_at)),
        );
        if (capturedIsProbe) {
          counters.probeCalls += 1;
          const limited = typeof limit === "number" ? sorted.slice(0, limit) : sorted;
          return { data: limited, error: null, count: filtered.length };
        }
        counters.listSelectCalls += 1;
        const limited = typeof limit === "number" ? sorted.slice(0, limit) : sorted;
        return { data: limited, error: null };
      };
      return {
        limit: vi.fn(async (n) => resolve(n)),
        then: (onFulfilled, onRejected) =>
          Promise.resolve(resolve()).then(onFulfilled, onRejected),
      };
    }),
    update: vi.fn((record) => {
      lastUpdate = record;
      const target = rows.find((row) => row.id === "design_1");
      if (target) {
        target.project_name = record.project_name;
        target.design = record.design;
        target.updated_at = record.updated_at;
      }
      return node;
    }),
    delete: vi.fn(() => {
      deleted = true;
      return node;
    }),
    then: (onFulfilled, onRejected) => {
      // PUT awaits the update chain (resolves the updated ids); DELETE
      // awaits the delete chain (resolves no error). The list chains never
      // await this node directly — they go through order().
      const resolution = lastUpdate
        ? { data: [{ id: "design_1" }], error: null }
        : { data: null, error: null };
      return Promise.resolve(resolution).then(onFulfilled, onRejected);
    },
  };
  return {
    client: { from: vi.fn(() => node) },
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

function singleQuery(row) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn().mockReturnThis();
  const query = { select: vi.fn().mockReturnThis(), eq, maybeSingle };
  return { client: { from: vi.fn(() => query) }, query };
}

const params = { projectId: "design_1" };

describe("GET /api/forge/designer/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the caller's design", async () => {
    const design = createEmptyDesign("Kitchen");
    const db = singleQuery({
      id: "design_1", owner_id: "user_1", project_name: "Kitchen",
      design, created_at: "a", updated_at: "b",
    });
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET(new Request("https://test/"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.project).toMatchObject({ id: "design_1", name: "Kitchen" });
    expect(body.project.design.version).toBe(1);
  });

  it("404s when the design does not belong to the caller", async () => {
    const db = singleQuery(null);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await GET(new Request("https://test/"), { params });
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/forge/designer/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  function updateClient(rows) {
    const select = vi.fn(async () => ({ data: rows, error: null }));
    const eq = vi.fn().mockReturnThis();
    const query = { update: vi.fn().mockReturnThis(), eq, select };
    return { client: { from: vi.fn(() => query) }, query };
  }

  function putRequest(body) {
    return new Request("https://test/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("saves a valid design document", async () => {
    const design = addWall(createEmptyDesign("Kitchen"), { x: 0, y: 0 }, { x: 144, y: 0 });
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ design }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "design_1" });
    const record = db.query.update.mock.calls[0][0];
    expect(record.design.walls).toHaveLength(1);
    expect(record.project_name).toBe("Kitchen");
    // S2A: the save performs no cache operation — the updated_at bump
    // moves the list generation, proven in "S2A list freshness" below.
  });

  // HOME DESIGNER slice 2: the persisted `design` column holds the full
  // HomeProject envelope — levels[], currentLevelId, building metadata.
  it("saves a HomeProject envelope with multiple levels", async () => {
    let project = createHomeProject("Two-story");
    project = addLevel(project, "Second floor");
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ name: "Two-story", design: project }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "design_1" });
    const record = db.query.update.mock.calls[0][0];
    expect(record.design.levels).toHaveLength(2);
    expect(record.design.levels[1].name).toBe("Second floor");
    expect(record.design.currentLevelId).toBe(project.levels[0].id);
    expect(record.project_name).toBe("Two-story");
  });

  it("rejects a structurally invalid envelope with 400", async () => {
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(
      putRequest({ design: { version: 1, levels: [] } }),
      { params },
    );
    expect(response.status).toBe(400);
    expect(db.query.update).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid document with 400", async () => {
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ design: { version: 999 } }), { params });
    expect(response.status).toBe(400);
    expect(db.query.update).not.toHaveBeenCalled();
  });

  it("rejects a missing document with 400", async () => {
    const db = updateClient([{ id: "design_1" }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({}), { params });
    expect(response.status).toBe(400);
  });

  it("404s when the design does not belong to the caller", async () => {
    const design = createEmptyDesign();
    const db = updateClient([]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const response = await PUT(putRequest({ design }), { params });
    expect(response.status).toBe(404);
    // S2A: a not-found save writes nothing, so the list generation does
    // not move.
  });
});

describe("DELETE /api/forge/designer/[projectId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the caller's design", async () => {
    const query = {};
    query.delete = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(authed(client));
    const response = await DELETE(new Request("https://test/", { method: "DELETE" }), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: "design_1" });
    // S2A: the delete performs no cache operation — the removed row moves
    // the list generation, proven in "S2A list freshness" below.
  });
});

describe("workspace authorization on single-project routes", () => {
  beforeEach(() => vi.clearAllMocks());

  function authedAs(userId, effectiveOwnerId, client) {
    return { user: { id: userId }, effectiveOwnerId, supabaseClient: client };
  }

  it("a co-owner's save scopes to the canonical workspace owner id", async () => {
    const design = createEmptyDesign("Shared plan");
    const select = vi.fn(async () => ({ data: [{ id: "design_1" }], error: null }));
    const eq = vi.fn().mockReturnThis();
    const query = { update: vi.fn().mockReturnThis(), eq, select };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("coowner9", "owner1", client),
    );
    const request = new Request("https://test/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ design }),
    });
    const response = await PUT(request, { params });
    expect(response.status).toBe(200);
    // Update is scoped to the workspace owner, which has_workspace_access()
    // authorizes for the co-owner on the DB side.
    expect(eq).toHaveBeenCalledWith("owner_id", "owner1");
    expect(eq).toHaveBeenCalledWith("id", "design_1");
    // S2A: the save is scoped to the canonical workspace owner, so its
    // updated_at bump moves that owner's list generation — the co-owner's
    // save is visible to the owner on the next list GET (proven in "S2A
    // list freshness" below).
  });

  it("an unrelated user cannot reach another workspace's design", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const eq = vi.fn().mockReturnThis();
    const query = { select: vi.fn().mockReturnThis(), eq, maybeSingle };
    const client = { from: vi.fn(() => query) };
    createAuthenticatedForgeApplication.mockResolvedValue(
      authedAs("stranger7", "stranger7", client),
    );
    const response = await GET(new Request("https://test/"), { params });
    expect(response.status).toBe(404);
    expect(eq).toHaveBeenCalledWith("owner_id", "stranger7");
  });
});

describe("S2A list freshness (generation probe, real cache)", () => {
  beforeEach(() => vi.clearAllMocks());

  const LIST_ROW = {
    id: "design_1", owner_id: "user_1", project_name: "Kitchen",
    design: null, created_at: "a", updated_at: "b",
  };

  function putRequest(body) {
    return new Request("https://test/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("a successful PUT makes the FIRST next list GET fresh — the updated_at bump moves the generation", async () => {
    const design = addWall(createEmptyDesign("Kitchen"), { x: 0, y: 0 }, { x: 144, y: 0 });
    const db = freshnessDb([{ ...LIST_ROW }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const warm = await (await listGet()).json();
    expect(warm.projects).toHaveLength(1);
    expect(db.listSelectCalls).toBe(1);
    const saved = await PUT(putRequest({ design }), { params });
    expect(saved.status).toBe(200);
    // The update already applied the record to the shared rows (the mock
    // models the DB write), so the next list GET's probe sees the new
    // updated_at and re-queries.
    const fresh = await (await listGet()).json();
    expect(db.listSelectCalls).toBe(2);
    expect(fresh.projects).toHaveLength(1);
    expect(fresh.projects[0].name).toBe("Kitchen");
    expect(fresh.projects[0].updatedAt).not.toBe("b");
  });

  it("a successful DELETE makes the FIRST next list GET fresh — the removed row moves the generation", async () => {
    const db = freshnessDb([{ ...LIST_ROW }]);
    createAuthenticatedForgeApplication.mockResolvedValue(authed(db.client));
    const warm = await (await listGet()).json();
    expect(warm.projects).toHaveLength(1);
    expect(db.listSelectCalls).toBe(1);
    const deleted = await DELETE(new Request("https://test/", { method: "DELETE" }), { params });
    expect(deleted.status).toBe(200);
    // The committed delete removed the row.
    db.rows.splice(0, 1);
    const fresh = await (await listGet()).json();
    expect(db.listSelectCalls).toBe(2);
    expect(fresh.projects).toHaveLength(0);
  });
});
