import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
  readJson: async (request) => request.json(),
}));

import { workAuth } from "./_lib/auth.js";
import { GET } from "./route.js";

// ---------------------------------------------------------------------------
// GET /api/work-packages — property listing at the route (real service).
//
// The service is NOT mocked here: the route runs the real listWorkPackages
// against a fake PostgREST client that APPLIES the .eq/.is predicates the
// service builds, so a package the filter excludes never reaches the
// response — the same end-to-end behavior as production (slice 1's route
// lesson: a fake that returns every row proves nothing).
//
// Fix round 1 (PR #799 P1): this file is also the direct-API regression
// surface for scope omission — the route + real service are exercised
// with an omitted, blank, and malformed ?forgeProject=, and none of
// them may return a package row from outside a selected scope.
// ---------------------------------------------------------------------------

const PACKAGES = [
  { id: "wp_a1", owner_id: "owner_1", property_id: "1900-w-decker", status: "planned", title: "Decker roof", forge_project_id: "forge_prj_1" },
  { id: "wp_a2", owner_id: "owner_1", property_id: "1900-w-decker", status: "draft", title: "Decker turnover", forge_project_id: "forge_prj_1" },
  { id: "wp_b1", owner_id: "owner_1", property_id: "4800-kent-ave", status: "draft", title: "Kent kitchen", forge_project_id: "forge_prj_2" },
  { id: "wp_none", owner_id: "owner_1", property_id: null, status: "draft", title: "Unassigned", forge_project_id: null },
  { id: "wp_other", owner_id: "owner_2", property_id: "1900-w-decker", status: "draft", title: "Another owner's Decker", forge_project_id: "forge_prj_1" },
];

function predicateDb() {
  const chains = [];
  function chain() {
    let rows = PACKAGES.map((row) => ({ ...row }));
    const filters = [];
    const node = {
      filters,
      select: vi.fn(() => node),
      eq: vi.fn((column, value) => {
        filters.push([column, value]);
        rows = rows.filter((row) => row[column] === value);
        return node;
      }),
      is: vi.fn((column, value) => {
        filters.push([column, value, "is"]);
        rows = rows.filter((row) => row[column] === value);
        return node;
      }),
      order: vi.fn(() => node),
      then: (resolve) => resolve({ data: rows, error: null, count: rows.length }),
    };
    chains.push(node);
    return node;
  }
  return { chains, from: vi.fn(() => chain()) };
}

const PROJECT_SCOPE = { kind: "project", projectId: "forge_prj_1" };
const NO_SCOPE = { kind: "none" };
const UNASSIGNED_SCOPE = { kind: "unassigned" };

const request = (qs) => new Request(`https://test/api/work-packages${qs}`);

describe("GET /api/work-packages property filter (real predicates)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only property A's packages for an alias input, canonicalized at the database", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9", scope: PROJECT_SCOPE });
    const response = await GET(request("?propertyId=1900-west-decker&forgeProject=forge_prj_1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages.map((pkg) => pkg.id).sort()).toEqual(["wp_a1", "wp_a2"]);
    // Exact owner + project + canonical property predicates reached
    // the database: no client-side filtering over an owner-wide list.
    expect(db.chains).toHaveLength(1);
    expect(db.chains[0].filters).toEqual([
      ["owner_id", "owner_1"],
      ["forge_project_id", "forge_prj_1"],
      ["property_id", "1900-w-decker"],
    ]);
  });

  it("never returns cross-owner packages, even for the same property", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9", scope: PROJECT_SCOPE });
    const response = await GET(request("?propertyId=1900-w-decker&forgeProject=forge_prj_1"));
    const body = await response.json();
    expect(body.packages.map((pkg) => pkg.id)).not.toContain("wp_other");
    expect(body.packages.every((pkg) => pkg.owner_id === "owner_1")).toBe(true);
  });

  it("never returns packages from another project, even for the same property", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9", scope: PROJECT_SCOPE });
    const response = await GET(request("?propertyId=4800-kent-ave&forgeProject=forge_prj_1"));
    const body = await response.json();
    expect(body.packages).toHaveLength(0);
    expect(body.packages.map((pkg) => pkg.id)).not.toContain("wp_b1");
  });

  it("UNASSIGNED lists only NULL-linked packages", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9", scope: UNASSIGNED_SCOPE });
    const response = await GET(request("?forgeProject=unassigned"));
    const body = await response.json();
    expect(body.packages.map((pkg) => pkg.id)).toEqual(["wp_none"]);
  });
});

describe("GET /api/work-packages scope omission (real service, fix round 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The old behavior — an omitted ?forgeProject= returning every
  // owner package — is gone. Each of these exercises a real scope
  // omission through the route + the real list service (not a mocked
  // requirePackageScope): no package row may come back.
  it("an omitted forgeProject returns the chooser state (no rows), never an owner-wide list", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9", scope: NO_SCOPE });
    const response = await GET(request("?propertyId=1900-w-decker"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages).toEqual([]);
    expect(body.scope).toBe("none");
    expect(body.unassignedCount).toBe(1);
  });

  it("a blank forgeProject returns the chooser state too", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9", scope: NO_SCOPE });
    const response = await GET(request("?propertyId=1900-w-decker&forgeProject="));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages).toEqual([]);
    expect(body.unassignedCount).toBe(1);
  });

  it("a malformed forgeProject fails with the scope error and queries nothing", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({
      db, ownerId: "owner_1", actor: "user_9",
      scopeError: { ok: false, httpStatus: 400, error: "That project link is not valid." },
    });
    const response = await GET(request("?propertyId=1900-w-decker&forgeProject=not-a-project"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/not valid/);
    expect(db.chains).toHaveLength(0);
  });

  it("an absent scope on the auth object fails closed the same way", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9" });
    const response = await GET(request(""));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages).toEqual([]);
    expect(body.unassignedCount).toBe(1);
  });
});
