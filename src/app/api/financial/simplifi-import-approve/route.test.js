import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), buildPreview: vi.fn(), loadOverlap: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));
vi.mock("@/domains/simplifi-import", () => ({
  buildSimplifiImportPreview: mocks.buildPreview,
  loadSimplifiOverlapEvidence: mocks.loadOverlap,
}));
import { POST } from "./route";

const fingerprint = `v1:${"a".repeat(64)}`;
const batchHash = "b".repeat(64);
const previewHash = "c".repeat(64);
const csv = "Account,Date,Payee,Amount\nChecking,8/1/2026,Tenant,100";

function query(data = [], error = null) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), not: vi.fn(() => chain),
    then(resolve) { return Promise.resolve({ data, error }).then(resolve); } };
  return chain;
}
function request(overrides = {}) {
  return new Request("http://localhost/api/financial/simplifi-import-approve", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({
      csv, batchHash, previewHash, selectedFingerprints: [fingerprint],
      accountMappings: [], categoryMappings: [], ...overrides,
    }) });
}

describe("POST /api/financial/simplifi-import-approve", () => {
  let rpc;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SIMPLIFI_FINGERPRINT_SECRET = "a-secure-test-secret-that-is-long-enough";
    rpc = vi.fn().mockResolvedValue({ data: { applied: 1, already_applied: 0 }, error: null });
    const from = vi.fn((table) => table === "financial_accounts"
      ? query([{ id: "account_1", name: "Operating", type: "depository" }]) : query([]));
    mocks.authenticate.mockResolvedValue({ user: { id: "owner_1" }, supabaseClient: { from, rpc } });
    mocks.loadOverlap.mockResolvedValue([{ id: "event_1", source_system: "plaid" }]);
    mocks.buildPreview.mockReturnValue({ batch_hash: batchHash, preview_hash: previewHash, rows: [{
      fingerprint, evidence_hash: "d".repeat(64), account_mapping_id: "account_1", date: "2026-08-01",
      amount_cents: 10000, normalized_category: "rental_income", classification: "safe_missing",
      transaction_kind: "income", affects_noi: true, capitalized: false,
      approvable: true, payee: "Tenant",
    }] });
  });

  it("recomputes the exact upload and sends only fresh safe rows to the RPC", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.buildPreview).toHaveBeenCalledTimes(1);
    expect(mocks.buildPreview).toHaveBeenCalledWith(expect.objectContaining({
      overlapEvidence: [{ id: "event_1", source_system: "plaid" }],
    }));
    expect(rpc).toHaveBeenCalledWith("approve_simplifi_csv_import", expect.objectContaining({
      p_owner_id: "owner_1", p_file_hash: batchHash, p_preview_hash: previewHash,
      p_rows: [expect.objectContaining({ fingerprint, financial_account_id: "account_1", classification: "safe_missing",
        transaction_kind: "income", affects_noi: true, capitalized: false })],
    }));
  });

  it("rejects file or evidence drift without calling the RPC", async () => {
    mocks.buildPreview.mockReturnValueOnce({ batch_hash: "e".repeat(64), preview_hash: previewHash, rows: [] });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a selected row that is no longer safe", async () => {
    mocks.buildPreview.mockReturnValueOnce({ batch_hash: batchHash, preview_hash: previewHash,
      rows: [{ fingerprint, classification: "already_imported", approvable: false }] });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a clean idempotent result when every selected row is already imported", async () => {
    mocks.buildPreview.mockReturnValueOnce({ batch_hash: batchHash, preview_hash: "e".repeat(64),
      rows: [{ fingerprint, classification: "already_imported", approvable: false }] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true, result: { applied: 0, already_applied: 1 },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects missing selection evidence before any reads or writes", async () => {
    const response = await POST(request({ selectedFingerprints: [] }));
    expect(response.status).toBe(400);
    expect(mocks.buildPreview).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
