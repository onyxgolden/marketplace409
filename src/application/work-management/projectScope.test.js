// Foundation PR B — project-scope resolver/service unit tests.
// The hierarchy RPC is mocked (its own battery lives in
// hierarchy.test.js / hierarchy.migration.test.js); the database is
// the Supabase-shaped chain mock used across the work-management
// services, so these tests prove the scope predicates the services
// apply — never a live database.
import { describe, expect, it, vi, beforeEach } from "vitest";

const validateHierarchySelection = vi.hoisted(() => vi.fn());
const getHierarchySelector = vi.hoisted(() => vi.fn());
vi.mock("@/application/forge-shared-hierarchy/hierarchy.js", () => ({
  validateHierarchySelection,
  getHierarchySelector,
}));

import {
  SCOPE_KINDS,
  parseForgeProjectParam,
  resolvePlannerProjectScope,
  constrainPackageQuery,
  fetchScopedPackage,
  provePackageInScope,
  setPackageProject,
  mapSetProjectRpcError,
  noScope,
  unassignedScope,
} from "./projectScope.js";

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    is: vi.fn(() => node),
    order: vi.fn(() => node),
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
  status: "draft", version: 3, forge_project_id: "forge_prj_1",
};
const SELECTION = {
  client: { id: "forge_cli_1", name: "Acme" },
  site: { id: "forge_site_1", name: "Plant 1" },
  project: { id: "forge_prj_1", name: "Turnaround" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseForgeProjectParam", () => {
  it("returns null when absent, blank, or whitespace-only", () => {
    expect(parseForgeProjectParam(undefined)).toBeNull();
    expect(parseForgeProjectParam(null)).toBeNull();
    expect(parseForgeProjectParam("")).toBeNull();
    expect(parseForgeProjectParam("   ")).toBeNull();
  });
  it("returns the exact 'unassigned' token for the inbox", () => {
    expect(parseForgeProjectParam("unassigned")).toBe("unassigned");
  });
  it("trims a project id and never trusts it (validation is separate)", () => {
    expect(parseForgeProjectParam("  forge_prj_1  ")).toBe("forge_prj_1");
  });
});

describe("resolvePlannerProjectScope", () => {
  it("null hint resolves to NO_SCOPE", async () => {
    const db = mockDb([]);
    const result = await resolvePlannerProjectScope(db, { ownerId: "owner_1", forgeProject: null });
    expect(result).toEqual({ ok: true, scope: noScope() });
    expect(validateHierarchySelection).not.toHaveBeenCalled();
  });
  it("'unassigned' resolves to the UNASSIGNED inbox scope", async () => {
    const db = mockDb([]);
    const result = await resolvePlannerProjectScope(db, { ownerId: "owner_1", forgeProject: "unassigned" });
    expect(result).toEqual({ ok: true, scope: unassignedScope() });
    expect(validateHierarchySelection).not.toHaveBeenCalled();
  });
  it("a project id is validated through the hierarchy RPC and carries the selection", async () => {
    validateHierarchySelection.mockResolvedValue({ ok: true, selection: SELECTION });
    const db = mockDb([]);
    const result = await resolvePlannerProjectScope(db, { ownerId: "owner_1", forgeProject: "forge_prj_1" });
    expect(result.ok).toBe(true);
    expect(result.scope.kind).toBe(SCOPE_KINDS.PROJECT);
    expect(result.scope.projectId).toBe("forge_prj_1");
    expect(result.scope.selection).toEqual(SELECTION);
    expect(validateHierarchySelection).toHaveBeenCalledWith(db, { ownerId: "owner_1", projectId: "forge_prj_1" });
  });
  it("an invalid/archived/cross-owner id passes the RPC's non-disclosing 404 through", async () => {
    validateHierarchySelection.mockResolvedValue({ ok: false, httpStatus: 404, error: "Project not found." });
    const db = mockDb([]);
    const result = await resolvePlannerProjectScope(db, { ownerId: "owner_1", forgeProject: "forge_prj_nope" });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Project not found." });
  });
  it("requires an owner id", async () => {
    const db = mockDb([]);
    const result = await resolvePlannerProjectScope(db, { ownerId: "", forgeProject: "forge_prj_1" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
  });
});

describe("constrainPackageQuery", () => {
  it("throws on NO_SCOPE so a missed branch fails loud, not leaky", () => {
    const node = chain();
    expect(() => constrainPackageQuery(node, noScope())).toThrow(/no project selected/);
    expect(node.eq).not.toHaveBeenCalled();
    expect(node.is).not.toHaveBeenCalled();
  });
  it("PROJECT adds the equality predicate", () => {
    const node = chain();
    constrainPackageQuery(node, { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_1" });
    expect(node.eq).toHaveBeenCalledWith("forge_project_id", "forge_prj_1");
  });
  it("UNASSIGNED adds the IS NULL predicate", () => {
    const node = chain();
    constrainPackageQuery(node, unassignedScope());
    expect(node.is).toHaveBeenCalledWith("forge_project_id", null);
  });
});

describe("fetchScopedPackage", () => {
  it("NO_SCOPE never queries and returns null", async () => {
    const db = mockDb([]);
    expect(await fetchScopedPackage(db, { ownerId: "owner_1", packageId: "forge_wp_1", scope: noScope() })).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
  it("PROJECT returns the row only when it carries that project id", async () => {
    const node = chain({ data: PKG, error: null });
    const db = mockDb([node]);
    const row = await fetchScopedPackage(db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
      scope: { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_1" },
    });
    expect(row).toEqual(PKG);
    expect(node.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(node.eq).toHaveBeenCalledWith("id", "forge_wp_1");
    expect(node.eq).toHaveBeenCalledWith("forge_project_id", "forge_prj_1");
  });
  it("PROJECT returns null when the row belongs to another project (guessed id)", async () => {
    const node = chain({ data: null, error: null });
    const db = mockDb([node]);
    const row = await fetchScopedPackage(db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
      scope: { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_2" },
    });
    expect(row).toBeNull();
  });
  it("UNASSIGNED returns the row only when its link is NULL", async () => {
    const node = chain({ data: { ...PKG, forge_project_id: null }, error: null });
    const db = mockDb([node]);
    const row = await fetchScopedPackage(db, {
      ownerId: "owner_1", packageId: "forge_wp_1", scope: unassignedScope(),
    });
    expect(row.forge_project_id).toBeNull();
    expect(node.is).toHaveBeenCalledWith("forge_project_id", null);
  });
});

describe("provePackageInScope", () => {
  it("an undefined scope is the internal bulk path (no proof)", async () => {
    const db = mockDb([]);
    expect(await provePackageInScope(db, { ownerId: "owner_1", packageId: "forge_wp_1", scope: undefined }))
      .toEqual({ ok: true, package: null });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("an out-of-scope package is the standard non-disclosing 404", async () => {
    const node = chain({ data: null, error: null });
    const db = mockDb([node]);
    expect(await provePackageInScope(db, {
      ownerId: "owner_1", packageId: "forge_wp_1",
      scope: { kind: SCOPE_KINDS.PROJECT, projectId: "forge_prj_2" },
    })).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
  });
});

describe("setPackageProject", () => {
  it("calls the RPC with the mandatory version + request id and returns the row", async () => {
    const db = mockDb([], async () => ({ data: { ...PKG, forge_project_id: "forge_prj_1" }, error: null }));
    const result = await setPackageProject(db, {
      ownerId: "owner_1", packageId: "forge_wp_1", forgeProjectId: "forge_prj_1",
      expectedVersion: 3, requestId: "req_1", reason: "Assigned",
    });
    expect(result.ok).toBe(true);
    expect(result.package.forge_project_id).toBe("forge_prj_1");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_set_project", {
      p_owner_id: "owner_1",
      p_package_id: "forge_wp_1",
      p_forge_project_id: "forge_prj_1",
      p_expected_version: 3,
      p_request_id: "req_1",
      p_reason: "Assigned",
    });
  });
  it("unassign sends a null target", async () => {
    const db = mockDb([], async () => ({ data: { ...PKG, forge_project_id: null }, error: null }));
    const result = await setPackageProject(db, {
      ownerId: "owner_1", packageId: "forge_wp_1", forgeProjectId: null,
      expectedVersion: 3, requestId: "req_2",
    });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_package_set_project", expect.objectContaining({
      p_forge_project_id: null,
    }));
  });
  it("rejects a missing/invalid expectedVersion before calling the RPC", async () => {
    const db = mockDb([]);
    for (const bad of [undefined, null, 0, -1, 1.5, "3"]) {
      const result = await setPackageProject(db, {
        ownerId: "owner_1", packageId: "forge_wp_1", forgeProjectId: "forge_prj_1",
        expectedVersion: bad, requestId: "req_3",
      });
      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(400);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("maps RPC failures to plain-English results (no raw codes leak)", async () => {
    const cases = [
      [{ message: "FORGE_PRB_FORBIDDEN" }, 403, /package edit permission/],
      [{ message: "FORGE_PRB_PACKAGE_NOT_FOUND" }, 404, /Work package not found/],
      [{ message: "FORGE_PRB_PROJECT_NOT_FOUND" }, 404, /Project not found/],
      [{ message: "FORGE_PRB_PROJECT_ARCHIVED" }, 409, /archived/],
      [{ message: "FORGE_PRB_STALE_VERSION" }, 409, /changed while you were editing/],
      [{ message: "FORGE_PRB_REQUEST_ID_CONFLICT" }, 409, /already used/],
      [{ code: "PGRST202", message: "Could not find the function" }, 503, /hasn't been applied/],
    ];
    for (const [error, status, pattern] of cases) {
      const db = mockDb([], async () => ({ data: null, error }));
      const result = await setPackageProject(db, {
        ownerId: "owner_1", packageId: "forge_wp_1", forgeProjectId: "forge_prj_1",
        expectedVersion: 3, requestId: "req_4",
      });
      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(status);
      expect(result.error).toMatch(pattern);
    }
  });
  it("mapSetProjectRpcError maps the request-id conflict in plain words", () => {
    expect(mapSetProjectRpcError({ message: "FORGE_PRB_REQUEST_ID_CONFLICT" }).httpStatus).toBe(409);
    expect(mapSetProjectRpcError({ message: "FORGE_PRB_REQUEST_ID_CONFLICT" }).error).toMatch(/already used/);
  });
});
