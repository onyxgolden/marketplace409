// FORGE shared hierarchy routes.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
vi.mock("@/application/forge-shared-hierarchy/hierarchy", () => ({
  createHierarchyClient: vi.fn(),
  createHierarchyProject: vi.fn(),
  createHierarchySite: vi.fn(),
  deleteHierarchyClient: vi.fn(),
  deleteHierarchyProject: vi.fn(),
  deleteHierarchySite: vi.fn(),
  getHierarchySelector: vi.fn(),
  updateHierarchyClient: vi.fn(),
  updateHierarchyProject: vi.fn(),
  updateHierarchySite: vi.fn(),
  validateHierarchySelection: vi.fn(),
}));

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  createHierarchyClient,
  createHierarchyProject,
  deleteHierarchyProject,
  getHierarchySelector,
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

  it("returns the 401 response when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: Response.json({ error: "Authenticated owner id is required." }, { status: 401 }),
    });
    const response = await GET(new Request("https://test/api/forge/hierarchy"));
    expect(response.status).toBe(401);
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
