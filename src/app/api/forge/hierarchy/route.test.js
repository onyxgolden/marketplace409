// FORGE shared hierarchy routes.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/application/forge-shared-hierarchy/hierarchy", () => ({
  createHierarchyClient: vi.fn(),
  createHierarchyProject: vi.fn(),
  createHierarchySite: vi.fn(),
  createHierarchyTestClient: vi.fn(),
  deleteHierarchyClient: vi.fn(),
  deleteHierarchyProject: vi.fn(),
  deleteHierarchySite: vi.fn(),
  getHierarchyAdminInventory: vi.fn(),
  getHierarchySelector: vi.fn(),
  getHierarchyTestInventory: vi.fn(),
  updateHierarchyClient: vi.fn(),
  updateHierarchyProject: vi.fn(),
  updateHierarchySite: vi.fn(),
  validateHierarchySelection: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  createHierarchyClient,
  createHierarchyProject,
  createHierarchyTestClient,
  deleteHierarchyProject,
  getHierarchyAdminInventory,
  getHierarchySelector,
  getHierarchyTestInventory,
  updateHierarchyClient,
  validateHierarchySelection,
} from "@/application/forge-shared-hierarchy/hierarchy";
import { GET, POST, PATCH, DELETE } from "./route.js";

const AUTH = { supabaseClient: { marker: "db" }, effectiveOwnerId: "owner_1" };

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedForgeApplication.mockResolvedValue(AUTH);
});

function post(body) {
  return new Request("https://test/api/forge/hierarchy", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("GET /api/forge/hierarchy", () => {
  it("returns the selector tree", async () => {
    const selector = { ownerId: "owner_1", clients: [] };
    getHierarchySelector.mockResolvedValue({ ok: true, selector });
    const response = await GET(new Request("https://test/api/forge/hierarchy"));
    expect(response.status).toBe(200);
    expect(getHierarchySelector).toHaveBeenCalledWith(AUTH.supabaseClient, { ownerId: "owner_1" });
    expect((await response.json()).selector).toEqual(selector);
  });

  it("validates a ?projectId= hint instead of returning the tree", async () => {
    const selection = { client: { id: "c1" }, site: { id: "s1" }, project: { id: "p1" } };
    validateHierarchySelection.mockResolvedValue({ ok: true, selection });
    const response = await GET(new Request("https://test/api/forge/hierarchy?projectId=p1"));
    expect(response.status).toBe(200);
    expect(validateHierarchySelection).toHaveBeenCalledWith(AUTH.supabaseClient, {
      ownerId: "owner_1",
      projectId: "p1",
    });
    expect((await response.json()).selection).toEqual(selection);
    expect(getHierarchySelector).not.toHaveBeenCalled();
  });

  it("returns the service error status", async () => {
    getHierarchySelector.mockResolvedValue({ ok: false, httpStatus: 403, error: "No permission." });
    const response = await GET(new Request("https://test/api/forge/hierarchy"));
    expect(response.status).toBe(403);
  });

  it("returns the full management inventory for ?includeArchived=true", async () => {
    const inventory = { ownerId: "owner_1", canManage: true, clients: [{ id: "c1", status: "archived" }] };
    getHierarchyAdminInventory.mockResolvedValue({ ok: true, inventory });
    const response = await GET(new Request("https://test/api/forge/hierarchy?includeArchived=true"));
    expect(response.status).toBe(200);
    expect(getHierarchyAdminInventory).toHaveBeenCalledWith(AUTH.supabaseClient, { ownerId: "owner_1" });
    expect((await response.json()).inventory).toEqual(inventory);
    expect(getHierarchySelector).not.toHaveBeenCalled();
  });

  it("lets a ?projectId= hint win over ?includeArchived=true", async () => {
    const selection = { client: { id: "c1" }, site: { id: "s1" }, project: { id: "p1" } };
    validateHierarchySelection.mockResolvedValue({ ok: true, selection });
    const response = await GET(new Request("https://test/api/forge/hierarchy?projectId=p1&includeArchived=true"));
    expect(response.status).toBe(200);
    expect(validateHierarchySelection).toHaveBeenCalledWith(AUTH.supabaseClient, {
      ownerId: "owner_1",
      projectId: "p1",
    });
    expect(getHierarchyAdminInventory).not.toHaveBeenCalled();
    expect(getHierarchySelector).not.toHaveBeenCalled();
  });

  it("maps the inventory service error status through (migration not applied -> 503)", async () => {
    getHierarchyAdminInventory.mockResolvedValue({
      ok: false,
      httpStatus: 503,
      error: "The hierarchy feature is not available yet.",
    });
    const response = await GET(new Request("https://test/api/forge/hierarchy?includeArchived=true"));
    expect(response.status).toBe(503);
  });

  it("returns the 401 response when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: Response.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const response = await GET(new Request("https://test/api/forge/hierarchy"));
    expect(response.status).toBe(401);
  });

  it("returns the test-only inventory for ?mode=test", async () => {
    const inventory = { ownerId: "owner_1", canUseOwnerTestData: true, clients: [] };
    getHierarchyTestInventory.mockResolvedValue({ ok: true, inventory });
    const response = await GET(new Request("https://test/api/forge/hierarchy?mode=test"));
    expect(response.status).toBe(200);
    expect(getHierarchyTestInventory).toHaveBeenCalledWith(AUTH.supabaseClient, { ownerId: "owner_1" });
    expect(getHierarchySelector).not.toHaveBeenCalled();
    expect(getHierarchyAdminInventory).not.toHaveBeenCalled();
    expect((await response.json()).inventory).toEqual(inventory);
  });

  it("maps the test-inventory service error status through", async () => {
    getHierarchyTestInventory.mockResolvedValue({
      ok: false,
      httpStatus: 503,
      error: "The hierarchy feature is not available yet.",
    });
    const response = await GET(new Request("https://test/api/forge/hierarchy?mode=test"));
    expect(response.status).toBe(503);
  });
});

describe("POST /api/forge/hierarchy", () => {
  it("creates a client and generates a request id when omitted", async () => {
    createHierarchyClient.mockResolvedValue({ ok: true, client: { id: "c1", name: "Acme" } });
    const response = await POST(post({ entity: "client", name: "Acme" }));
    expect(response.status).toBe(200);
    expect(createHierarchyClient).toHaveBeenCalledWith(
      AUTH.supabaseClient,
      expect.objectContaining({ ownerId: "owner_1", name: "Acme" }),
    );
    const requestId = createHierarchyClient.mock.calls[0][1].requestId;
    expect(typeof requestId).toBe("string");
    expect(requestId.length).toBeGreaterThan(10);
    expect((await response.json()).client.id).toBe("c1");
  });

  it("creates a test client through the test-create service when isTest is true", async () => {
    createHierarchyTestClient.mockResolvedValue({ ok: true, client: { id: "tc1", name: "Fictional", isTest: true } });
    const response = await POST(post({ entity: "client", name: "Fictional", isTest: true }));
    expect(response.status).toBe(200);
    expect(createHierarchyTestClient).toHaveBeenCalledWith(
      AUTH.supabaseClient,
      expect.objectContaining({ ownerId: "owner_1", name: "Fictional" }),
    );
    // The regular create must never run for a test client.
    expect(createHierarchyClient).not.toHaveBeenCalled();
    expect((await response.json()).client.isTest).toBe(true);
  });

  it("creates a real client through the regular service when isTest is absent", async () => {
    createHierarchyClient.mockResolvedValue({ ok: true, client: { id: "c1", name: "Acme" } });
    const response = await POST(post({ entity: "client", name: "Acme" }));
    expect(response.status).toBe(200);
    expect(createHierarchyTestClient).not.toHaveBeenCalled();
    expect(createHierarchyClient).toHaveBeenCalled();
  });

  it("rejects an unknown entity", async () => {
    const response = await POST(post({ entity: "invoice", name: "X" }));
    expect(response.status).toBe(400);
    expect(createHierarchyClient).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/forge/hierarchy", () => {
  it("forwards a client update with the expected version", async () => {
    updateHierarchyClient.mockResolvedValue({
      ok: true,
      client: { id: "c1", name: "Acme", status: "archived" },
    });
    const response = await PATCH(
      new Request("https://test/api/forge/hierarchy", {
        method: "PATCH",
        body: JSON.stringify({ entity: "client", id: "c1", status: "archived", expectedVersion: 1, requestId: "req_1" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(updateHierarchyClient).toHaveBeenCalledWith(
      AUTH.supabaseClient,
      expect.objectContaining({ ownerId: "owner_1", clientId: "c1", expectedVersion: 1, requestId: "req_1" }),
    );
  });

  it("rejects a missing expectedVersion before the service", async () => {
    const response = await PATCH(
      new Request("https://test/api/forge/hierarchy", {
        method: "PATCH",
        body: JSON.stringify({ entity: "client", id: "c1", status: "archived" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(updateHierarchyClient).not.toHaveBeenCalled();
  });

  it("forwards empty strings for cleared fields (null means unchanged, empty string clears)", async () => {
    updateHierarchyClient.mockResolvedValue({
      ok: true,
      client: { id: "c1", name: "Acme", externalReference: null, notes: null },
    });
    const response = await PATCH(
      new Request("https://test/api/forge/hierarchy", {
        method: "PATCH",
        body: JSON.stringify({ entity: "client", id: "c1", name: "Acme", externalReference: "", notes: "", status: "active", expectedVersion: 3, requestId: "req_1" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(updateHierarchyClient).toHaveBeenCalledWith(
      AUTH.supabaseClient,
      expect.objectContaining({ externalReference: "", notes: "" }),
    );
  });
});

describe("DELETE /api/forge/hierarchy", () => {
  it("forwards a project delete", async () => {
    deleteHierarchyProject.mockResolvedValue({ ok: true, deleted: true, id: "p1" });
    const response = await DELETE(
      new Request("https://test/api/forge/hierarchy", {
        method: "DELETE",
        body: JSON.stringify({ entity: "project", id: "p1", expectedVersion: 2, requestId: "req_1" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(deleteHierarchyProject).toHaveBeenCalledWith(
      AUTH.supabaseClient,
      expect.objectContaining({ ownerId: "owner_1", projectId: "p1", expectedVersion: 2 }),
    );
    expect(await response.json()).toEqual({ deleted: true, id: "p1" });
  });

  it("maps a blocker error status through", async () => {
    deleteHierarchyProject.mockResolvedValue({
      ok: false,
      httpStatus: 409,
      error: "Archive the record first — only archived records can be permanently deleted.",
    });
    const response = await DELETE(
      new Request("https://test/api/forge/hierarchy", {
        method: "DELETE",
        body: JSON.stringify({ entity: "project", id: "p1", expectedVersion: 2, requestId: "req_1" }),
      }),
    );
    expect(response.status).toBe(409);
  });
});
