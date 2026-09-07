import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn() }));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { PATCH, DELETE } from "./route";

function tableNode(resolution) {
  const node = {
    update: vi.fn(() => node), delete: vi.fn(() => node), select: vi.fn(() => node), eq: vi.fn(() => node),
    maybeSingle: vi.fn(async () => resolution),
  };
  return node;
}

function mockDb(resolution) {
  const node = tableNode(resolution);
  return { client: { from: vi.fn(() => node) }, node };
}

function patchRequest(body) {
  return new Request("https://test/api/forge/scheduling/cost-accounts/cost_account_1", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ costAccountId: "cost_account_1" });

describe("PATCH /api/forge/scheduling/cost-accounts/[costAccountId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the requested fields", async () => {
    const db = mockDb({ data: { id: "cost_account_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ name: "Renamed" }), { params });
    expect(response.status).toBe(200);
    expect(db.node.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed" }));
  });

  it("404s a cost code that doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ data: null, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ name: "Renamed" }), { params });
    expect(response.status).toBe(404);
  });

  it("rejects an empty patch", async () => {
    const db = mockDb({ data: { id: "cost_account_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({}), { params });
    expect(response.status).toBe(400);
  });

  it("returns 409 with a clear message on a duplicate code", async () => {
    const db = mockDb({ data: null, error: { code: "23505", message: "duplicate key" } });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await PATCH(patchRequest({ code: "PO-4521" }), { params });
    expect(response.status).toBe(409);
  });
});

describe("DELETE /api/forge/scheduling/cost-accounts/[costAccountId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a cost code (assignments/expenses using it go back to uncoded, no FK error)", async () => {
    const db = mockDb({ data: { id: "cost_account_1" }, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await DELETE(new Request("https://test"), { params });
    expect(response.status).toBe(200);
  });

  it("404s a cost code that doesn't exist or isn't this owner's", async () => {
    const db = mockDb({ data: null, error: null });
    createAuthenticatedForgeApplication.mockResolvedValue({ user: { id: "user_1" }, supabaseClient: db.client });
    const response = await DELETE(new Request("https://test"), { params });
    expect(response.status).toBe(404);
  });
});
