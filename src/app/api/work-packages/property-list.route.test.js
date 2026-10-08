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
// against a fake PostgREST client that APPLIES the .eq predicates the
// service builds, so a package the filter excludes never reaches the
// response — the same end-to-end behavior as production (slice 1's route
// lesson: a fake that returns every row proves nothing).
// ---------------------------------------------------------------------------

const PACKAGES = [
  { id: "wp_a1", owner_id: "owner_1", property_id: "1900-w-decker", status: "planned", title: "Decker roof" },
  { id: "wp_a2", owner_id: "owner_1", property_id: "1900-w-decker", status: "draft", title: "Decker turnover" },
  { id: "wp_b1", owner_id: "owner_1", property_id: "4800-kent-ave", status: "draft", title: "Kent kitchen" },
  { id: "wp_none", owner_id: "owner_1", property_id: null, status: "draft", title: "Unassigned" },
  { id: "wp_other", owner_id: "owner_2", property_id: "1900-w-decker", status: "draft", title: "Another owner's Decker" },
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
      order: vi.fn(() => node),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    chains.push(node);
    return node;
  }
  return { chains, from: vi.fn(() => chain()) };
}

const request = (qs) => new Request(`https://test/api/work-packages${qs}`);

describe("GET /api/work-packages property filter (real predicates)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only property A's packages for an alias input, canonicalized at the database", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9" });
    const response = await GET(request("?propertyId=1900-west-decker"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.packages.map((pkg) => pkg.id).sort()).toEqual(["wp_a1", "wp_a2"]);
    // Exact owner + canonical property predicates reached the database:
    // no client-side filtering over an owner-wide list.
    expect(db.chains).toHaveLength(1);
    expect(db.chains[0].filters).toEqual([
      ["owner_id", "owner_1"],
      ["property_id", "1900-w-decker"],
    ]);
  });

  it("never returns cross-owner packages, even for the same property", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9" });
    const response = await GET(request("?propertyId=1900-w-decker"));
    const body = await response.json();
    expect(body.packages.map((pkg) => pkg.id)).not.toContain("wp_other");
    expect(body.packages.every((pkg) => pkg.owner_id === "owner_1")).toBe(true);
  });

  it("general list keeps unassigned packages but stays owner-scoped", async () => {
    const db = predicateDb();
    workAuth.mockResolvedValue({ db, ownerId: "owner_1", actor: "user_9" });
    const response = await GET(request(""));
    const body = await response.json();
    expect(body.packages.map((pkg) => pkg.id).sort()).toEqual(
      ["wp_a1", "wp_a2", "wp_b1", "wp_none"],
    );
    expect(db.chains[0].filters).toEqual([["owner_id", "owner_1"]]);
  });
});
