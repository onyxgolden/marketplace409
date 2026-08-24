import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));

import { POST } from "./route";

const csv = "Account,Date,Payee,Amount\nChecking,8/1/2026,A,1.00\nChase Credit Card,8/2/2026,B,-1.00";
const request = (body) => new Request("http://localhost/api/financial/simplifi-import-accounts", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("POST /api/financial/simplifi-import-accounts", () => {
  let database;
  let upsert;

  beforeEach(() => {
    vi.clearAllMocks();
    const selectResult = { data: [{ id: "existing", name: "Checking", type: "depository" }], error: null };
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), then: (resolve) => Promise.resolve(selectResult).then(resolve) };
    upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ ...query, upsert }));
    database = { from };
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: database });
  });

  it("reuses exact names and creates only deterministic missing accounts", async () => {
    const response = await POST(request({ csv }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, created: 1, reused: 1 });
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({ name: "Chase Credit Card", type: "credit", provider: "quicken_simplifi_csv" }),
    ], { onConflict: "owner_id,provider,provider_account_id" });
  });

  it("returns authentication responses and rejects missing CSV", async () => {
    mocks.authenticate.mockResolvedValueOnce({ response: new Response("unauthorized", { status: 401 }) });
    expect((await POST(request({ csv }))).status).toBe(401);
    expect((await POST(request({}))).status).toBe(400);
  });
});
