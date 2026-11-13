// Foundation PR B — workPackages service scoping tests (mocked db).
// Proves the list/detail/mutation surfaces honor the project scope
// at the service layer: a package outside the scope reads exactly
// like a nonexistent package (404), the list never aggregates across
// projects, and the project link can never ride on a generic PATCH.
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  createWorkPackage,
  updateWorkPackage,
  deleteWorkPackage,
  getWorkPackageDetail,
  listWorkPackages,
  listWorkPackagesForRentalLedger,
} from "./workPackages.js";
import { SCOPE_KINDS } from "./projectScope.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    is: vi.fn(() => node),
    in: vi.fn(() => node),
    order: vi.fn(() => node),
    limit: vi.fn(() => node),
    insert: vi.fn(() => node),
    update: vi.fn(() => node),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

function mockDb(chains = [], rpcImpl = null) {
  const queue = [...chains];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(rpcImpl || (async () => ({ data: null, error: null }))),
  };
}

const PKG = {
  id: "forge_wp_1", owner_id: "owner_1", code: "WP-0007", title: "Turnover",
  package_type: "rental_turn", priority: "normal", status: "draft", version: 3,
  forge_project_id: "forge_prj_1",
};
const PROJECT_SCOPE = { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_1" };
const OTHER_SCOPE = { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_2" };
const UNASSIGNED_SCOPE = { kind: SCOPE_KINDS.UNASSIGNED };
const NO_SCOPE = { kind: SCOPE_KINDS.NONE };

describe("listWorkPackages scoping", () => {
  it("NO_SCOPE returns the chooser state (empty list + unassigned count), never an aggregate", async () => {
    const countChain = chain({ count: 4, error: null });
    const db = mockDb([countChain]);
    const result = await listWorkPackages(db, { ownerId: "owner_1", scope: NO_SCOPE });
    expect(result).toEqual({ ok: true, scope: "none", packages: [], unassignedCount: 4 });
    expect(countChain.is).toHaveBeenCalledWith("forge_project_id", null);
  });
  it("PROJECT lists only that project's packages (forge_project_id predicate on the query)", async () => {
    const listChain = chain({ data: [PKG], error: null });
    const db = mockDb([listChain]);
    const result = await listWorkPackages(db, { ownerId: "owner_1", scope: PROJECT_SCOPE });
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("project");
    expect(result.packages).toEqual([PKG]);
    expect(listChain.eq).toHaveBeenCalledWith("forge_project_id", "forge_prj_1");
  });
  it("UNASSIGNED lists only NULL-linked packages", async () => {
    const listChain = chain({ data: [{ ...PKG, forge_project_id: null }], error: null });
    const db = mockDb([listChain]);
    const result = await listWorkPackages(db, { ownerId: "owner_1", scope: UNASSIGNED_SCOPE });
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("unassigned");
    expect(listChain.is).toHaveBeenCalledWith("forge_project_id", null);
  });
  it("an undefined scope fails closed to the chooser state — no owner-wide list (fix round 1)", async () => {
    // Fix round 1: the legacy owner-wide branch is gone. An omitted
    // scope is treated exactly like NO_SCOPE: the chooser state, no
    // package rows. The Rental ledger reads through its own explicit
    // boundary (listWorkPackagesForRentalLedger), not through this.
    const countChain = chain({ count: 4, error: null });
    const db = mockDb([countChain]);
    const result = await listWorkPackages(db, { ownerId: "owner_1" });
    expect(result).toEqual({ ok: true, scope: "none", packages: [], unassignedCount: 4 });
    expect(countChain.is).toHaveBeenCalledWith("forge_project_id", null);
  });
});

describe("createWorkPackage scoping", () => {
  it("rejects a forge_project_id on create — packages are born Unassigned", async () => {
    const db = mockDb([]);
    const result = await createWorkPackage(db, {
      ownerId: "owner_1", actor: "user_9",
      input: { title: "Turnover", package_type: "rental_turn", forge_project_id: "forge_prj_1" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/Assign a project after creating/);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("updateWorkPackage scoping", () => {
  it("rejects forge_project_id in a PATCH in plain words (link is RPC-only)", async () => {
    const db = mockDb([]);
    const result = await updateWorkPackage(db, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1",
      patch: { forge_project_id: "forge_prj_1" }, scope: PROJECT_SCOPE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/assign\/unassign action/);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("a package in another project is a 404 on update (guessed id)", async () => {
    const pkgChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain]);
    const result = await updateWorkPackage(db, {
      ownerId: "owner_1", actor: "user_9", packageId: "forge_wp_1",
      patch: { title: "Renamed" }, scope: OTHER_SCOPE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(result.error).toBe("Work package not found.");
  });
});

describe("getWorkPackageDetail scoping", () => {
  it("a package in another project is a 404 (non-disclosing)", async () => {
    const pkgChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain]);
    const result = await getWorkPackageDetail(db, {
      ownerId: "owner_1", packageId: "forge_wp_1", actor: "user_9", scope: OTHER_SCOPE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });
  it("an Unassigned package is a 404 under a project scope", async () => {
    const pkgChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain]);
    const result = await getWorkPackageDetail(db, {
      ownerId: "owner_1", packageId: "forge_wp_1", actor: "user_9", scope: PROJECT_SCOPE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(pkgChain.is).not.toHaveBeenCalled();
    expect(pkgChain.eq).toHaveBeenCalledWith("forge_project_id", "forge_prj_1");
  });
});

describe("deleteWorkPackage scoping", () => {
  it("a package in another project is a 404 before the delete RPC runs", async () => {
    const pkgChain = chain({ data: null, error: null });
    const db = mockDb([pkgChain], async () => ({ data: { ok: true }, error: null }));
    const result = await deleteWorkPackage(db, {
      ownerId: "owner_1", actor: "owner_1", packageId: "forge_wp_1",
      confirmCode: "WP-0007", expectedVersion: 3, scope: OTHER_SCOPE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

// Fix round 1: the Rental ledger's read boundary — the only
// owner-wide, property-filtered list left, reachable only from
// GET /api/rental/work-packages, never from the Planner list route.
describe("listWorkPackagesForRentalLedger", () => {
  it("lists one property's packages, owner-scoped, filtered by canonical slug", async () => {
    const listChain = chain({ data: [PKG], error: null });
    const db = mockDb([listChain]);
    const result = await listWorkPackagesForRentalLedger(db, { ownerId: "owner_1", propertyId: "4800-kent" });
    expect(result.ok).toBe(true);
    expect(result.packages).toEqual([PKG]);
    expect(listChain.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(listChain.eq).toHaveBeenCalledWith("property_id", "4800-kent-ave");
  });
  it("refuses a missing propertyId (400) without querying", async () => {
    const db = mockDb([]);
    const result = await listWorkPackagesForRentalLedger(db, { ownerId: "owner_1", propertyId: "" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});
