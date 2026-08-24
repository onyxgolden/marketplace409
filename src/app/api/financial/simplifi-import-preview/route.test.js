import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  buildPreview: vi.fn(),
  loadOverlap: vi.fn(),
}));

vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));
vi.mock("@/domains/simplifi-import", () => ({
  buildSimplifiImportPreview: mocks.buildPreview,
  loadSimplifiOverlapEvidence: mocks.loadOverlap,
}));

import { POST } from "./route";

const csv = "Account,Date,Payee,Amount\nChecking,8/1/2026,Tenant,100";

function query(data = [], error = null) {
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), not: vi.fn(() => chain),
    then(resolve) { return Promise.resolve({ data, error }).then(resolve); },
  };
  return chain;
}

function request(body) {
  return new Request("http://localhost/api/financial/simplifi-import-preview", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/financial/simplifi-import-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIMPLIFI_FINGERPRINT_SECRET = "a-secure-test-secret-that-is-long-enough";
    const accounts = query([{ id: "account_1", name: "Operating", type: "checking" }]);
    const events = query([{ source_record_id: "v1:existing" }]);
    const from = vi.fn((table) => table === "financial_accounts" ? accounts : events);
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { from } });
    mocks.loadOverlap.mockResolvedValue([{ id: "event_1", source_system: "rentec" }]);
    mocks.buildPreview.mockReturnValue({ status: "preview_only", batch_hash: "a".repeat(64), rows: [] });
  });

  it("authenticates, scopes evidence to the owner, and never writes", async () => {
    const response = await POST(request({
      csv, fileName: "Simplifi.csv",
      accountMappings: [{ simplifi_account_name: "Checking", forge_account_id: "account_1" }],
      categoryMappings: [{ simplifi_category: "Rent Income", normalized_category: "rental_income" }],
    }));
    expect(response.status).toBe(200);
    expect(mocks.buildPreview).toHaveBeenCalledWith(expect.objectContaining({
      csv, fingerprintSecret: expect.any(String), existingFingerprints: ["v1:existing"],
      categoryMappings: { "rent income": { normalized_category: "rental_income", treatment: "operating" } },
      overlapEvidence: [{ id: "event_1", source_system: "rentec" }],
    }));
    expect(mocks.loadOverlap).toHaveBeenCalledWith(database, "owner_1");
    const database = (await mocks.authenticate.mock.results[0].value).supabaseClient;
    expect(database.from).toHaveBeenCalledWith("financial_accounts");
    expect(database.from).toHaveBeenCalledWith("financial_events");
    expect(database.from).not.toHaveBeenCalledWith("simplifi_import_batches");
  });

  it("returns authentication responses without parsing the upload", async () => {
    mocks.authenticate.mockResolvedValueOnce({ response: new Response('{"error":"unauthorized"}', { status: 401 }) });
    const response = await POST(request({ csv }));
    expect(response.status).toBe(401);
    expect(mocks.buildPreview).not.toHaveBeenCalled();
  });

  it("rejects missing CSV, unsafe filenames, and invalid category mappings", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ csv, fileName: "../secret.csv" }))).status).toBe(400);
    const invalid = await POST(request({ csv, categoryMappings: [{ simplifi_category: "Rent" }] }));
    expect(invalid.status).toBe(400);
    expect(mocks.buildPreview).not.toHaveBeenCalled();
  });

  it("fails closed when the fingerprint secret is absent", async () => {
    delete process.env.SIMPLIFI_FINGERPRINT_SECRET;
    const response = await POST(request({ csv }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Simplifi import fingerprinting is not configured." });
  });
});
