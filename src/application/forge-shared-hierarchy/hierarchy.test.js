// FORGE shared hierarchy — application service (mock db, no I/O).

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createHierarchyClient,
  createHierarchyProject,
  createHierarchySite,
  deleteHierarchyProject,
  getHierarchySelector,
  mapHierarchyRpcError,
  updateHierarchyClient,
  validateHierarchySelection,
} from "./hierarchy.js";

function mockDb() {
  return { rpc: vi.fn() };
}

const OWNER = "owner_1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mapHierarchyRpcError", () => {
  it("maps forbidden to 403 and not-found to 404", () => {
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_FORBIDDEN" }).httpStatus).toBe(403);
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_NOT_FOUND" }).httpStatus).toBe(404);
    expect(
      mapHierarchyRpcError({ message: "FORGE_HIERARCHY_CLIENT_NOT_FOUND" }).httpStatus,
    ).toBe(404);
  });

  it("maps stale version and request-id conflict to 409", () => {
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_STALE_VERSION" }).httpStatus).toBe(
      409,
    );
    expect(
      mapHierarchyRpcError({ message: "FORGE_HIERARCHY_REQUEST_ID_CONFLICT" }).httpStatus,
    ).toBe(409);
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_DUPLICATE_NAME" }).httpStatus).toBe(
      409,
    );
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_ARCHIVED" }).httpStatus).toBe(409);
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_PARENT_INACTIVE" }).httpStatus).toBe(
      409,
    );
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_PARENT_INACTIVE" }).error).toBe(
      "The parent client or site is inactive. Activate it first, or pick an active one.",
    );
    expect(mapHierarchyRpcError({ message: "FORGE_HIERARCHY_HAS_CHILDREN: x" }).httpStatus).toBe(
      409,
    );
  });

  it("maps a missing RPC/table to 503 not-applied", () => {
    expect(mapHierarchyRpcError({ code: "PGRST202", message: "Could not find the function" }))
      .toMatchObject({ httpStatus: 503 });
    expect(mapHierarchyRpcError({ code: "42P01", message: 'relation "forge_clients" does not exist' }))
      .toMatchObject({ httpStatus: 503 });
  });

  it("maps a raw unique violation to 409 and a raw FK violation to 404", () => {
    expect(mapHierarchyRpcError({ code: "23505", message: "duplicate key" }).httpStatus).toBe(409);
    expect(mapHierarchyRpcError({ code: "23505", message: "duplicate key" }).error).toBe(
      "A record with that name already exists here.",
    );
    // A code collision names the violated constraint: it maps to
    // DUPLICATE_CODE, not the generic duplicate-name error.
    expect(
      mapHierarchyRpcError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "forge_projects_code_uq"',
      }),
    ).toMatchObject({ httpStatus: 409 });
    expect(
      mapHierarchyRpcError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "forge_projects_code_uq"',
      }).error,
    ).toBe("A project with that code already exists in this workspace.");
    expect(mapHierarchyRpcError({ code: "23503", message: "violates foreign key" }).httpStatus).toBe(
      404,
    );
  });

  it("throws unknown failures (the route turns them into a 500)", () => {
    expect(() => mapHierarchyRpcError({ message: "boom" })).toThrow("boom");
  });
});

describe("getHierarchySelector", () => {
  it("returns the camelCased selector tree", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({
      data: {
        ownerId: OWNER,
        clients: [
          {
            id: "c1",
            name: "Acme",
            external_reference: "A-1",
            status: "active",
            sites: [
              {
                id: "s1",
                name: "Plant 1",
                site_type: "industrial",
                status: "active",
                projects: [{ id: "p1", name: "TA 27", project_code: "TA-27", project_type: null, status: "active" }],
              },
            ],
          },
        ],
      },
      error: null,
    });
    const result = await getHierarchySelector(db, { ownerId: OWNER });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_hierarchy_selector", { p_owner_id: OWNER });
    expect(result.selector.clients[0].externalReference).toBe("A-1");
    expect(result.selector.clients[0].sites[0].projects[0].projectCode).toBe("TA-27");
  });

  it("maps a forbidden RPC error", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({ data: null, error: { message: "FORGE_HIERARCHY_FORBIDDEN" } });
    const result = await getHierarchySelector(db, { ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, httpStatus: 403 });
  });
});

describe("validateHierarchySelection", () => {
  it("returns the resolved chain camelCased", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({
      data: {
        client: { id: "c1", name: "Acme", external_reference: null, status: "active", notes: null, version: 1, created_by: "u", updated_by: "u", created_at: "t", updated_at: "t" },
        site: { id: "s1", client_id: "c1", name: "Plant 1", site_type: "industrial", address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country_code: null, status: "active", version: 1, created_by: "u", updated_by: "u", created_at: "t", updated_at: "t" },
        project: { id: "p1", site_id: "s1", name: "TA 27", project_code: "TA-27", description: null, project_type: null, planned_start: null, planned_finish: null, status: "active", version: 1, created_by: "u", updated_by: "u", created_at: "t", updated_at: "t" },
      },
      error: null,
    });
    const result = await validateHierarchySelection(db, { ownerId: OWNER, projectId: "p1" });
    expect(result.ok).toBe(true);
    expect(result.selection.project.projectCode).toBe("TA-27");
    expect(result.selection.site.clientId).toBe("c1");
  });

  it("rejects a blank project id before calling the RPC", async () => {
    const db = mockDb();
    const result = await validateHierarchySelection(db, { ownerId: OWNER, projectId: "  " });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("createHierarchyClient", () => {
  it("calls the create RPC and returns the camelCased client", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({
      data: { id: "forge_client_x", name: "Acme", external_reference: null, status: "active", notes: null, version: 1, created_by: "u", updated_by: "u", created_at: "t", updated_at: "t" },
      error: null,
    });
    const result = await createHierarchyClient(db, { ownerId: OWNER, name: "Acme", requestId: "req_1" });
    expect(result.ok).toBe(true);
    expect(result.client.id).toBe("forge_client_x");
    expect(db.rpc).toHaveBeenCalledWith("forge_hierarchy_client_create", {
      p_owner_id: OWNER,
      p_name: "Acme",
      p_external_reference: null,
      p_notes: null,
      p_request_id: "req_1",
    });
  });

  it("validates locally before calling the RPC", async () => {
    const db = mockDb();
    const result = await createHierarchyClient(db, { ownerId: OWNER, name: "", requestId: "req_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("requires a request id", async () => {
    const db = mockDb();
    const result = await createHierarchyClient(db, { ownerId: OWNER, name: "Acme" });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("createHierarchySite / createHierarchyProject", () => {
  it("site create requires a client id and forwards the address", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({
      data: { id: "forge_site_x", client_id: "c1", name: "Plant 1", site_type: "industrial", address_line1: "1 Main St", address_line2: null, city: "Beaumont", region: "TX", postal_code: "77701", country_code: "US", status: "active", version: 1, created_by: "u", updated_by: "u", created_at: "t", updated_at: "t" },
      error: null,
    });
    const result = await createHierarchySite(db, {
      ownerId: OWNER, clientId: "c1", name: "Plant 1", siteType: "industrial",
      addressLine1: "1 Main St", city: "Beaumont", region: "TX", postalCode: "77701", countryCode: "us",
      requestId: "req_1",
    });
    expect(result.ok).toBe(true);
    expect(result.site.countryCode).toBe("US");
    const missing = await createHierarchySite(db, { ownerId: OWNER, name: "Plant 1", requestId: "req_2" });
    expect(missing).toMatchObject({ ok: false, httpStatus: 404 });
  });

  it("project create validates dates locally", async () => {
    const db = mockDb();
    const result = await createHierarchyProject(db, {
      ownerId: OWNER, siteId: "s1", name: "TA 27",
      plannedStart: "2027-04-15", plannedFinish: "2027-03-01", requestId: "req_1",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 400 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("updateHierarchyClient / deleteHierarchyProject", () => {
  it("update requires expectedVersion and forwards nulls as unchanged", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({
      data: { id: "c1", name: "Acme", external_reference: null, status: "archived", notes: null, version: 2, created_by: "u", updated_by: "u", created_at: "t", updated_at: "t" },
      error: null,
    });
    const result = await updateHierarchyClient(db, {
      ownerId: OWNER, clientId: "c1", status: "archived", expectedVersion: 1, requestId: "req_1",
    });
    expect(result.ok).toBe(true);
    expect(result.client.status).toBe("archived");
    expect(db.rpc).toHaveBeenCalledWith("forge_hierarchy_client_update", expect.objectContaining({
      p_expected_version: 1,
      p_name: null,
    }));
    const noVersion = await updateHierarchyClient(db, {
      ownerId: OWNER, clientId: "c1", status: "archived", requestId: "req_2",
    });
    expect(noVersion).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("delete returns the deleted flag", async () => {
    const db = mockDb();
    db.rpc.mockResolvedValue({ data: { deleted: true, id: "p1" }, error: null });
    const result = await deleteHierarchyProject(db, {
      ownerId: OWNER, projectId: "p1", expectedVersion: 3, requestId: "req_1",
    });
    expect(result).toEqual({ ok: true, deleted: true, id: "p1" });
  });
});
