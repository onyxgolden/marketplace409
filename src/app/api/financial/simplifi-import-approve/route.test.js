import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), buildPreview: vi.fn(), loadOverlap: vi.fn(), fetchFingerprints: vi.fn(),
}));
vi.mock("@/lib/supabase/createAuthenticatedFinancialApplication", () => ({
  createAuthenticatedFinancialApplication: mocks.authenticate,
}));
vi.mock("@/domains/simplifi-import", () => ({
  buildSimplifiImportPreview: mocks.buildPreview,
  loadSimplifiOverlapEvidence: mocks.loadOverlap,
  fetchAllOwnerSimplifiFingerprints: mocks.fetchFingerprints,
}));
import { POST } from "./route";

// Every freshly approvable row is always v2-shaped now (already-imported/legacy rows are never
// submitted for approval), so this is the realistic default fixture -- a prior version of this
// suite left it v1-shaped by accident, which is exactly how the route's own selectedFingerprints
// regex silently rejecting real v2 fingerprints went unnoticed (see the explicit format test below).
const fingerprint = `v2:${"a".repeat(64)}`;
const legacyFingerprint = `v1:${"b".repeat(64)}`;
const batchHash = "b".repeat(64);
const previewHash = "c".repeat(64);
const csv = "Account,Date,Payee,Amount\nChecking,8/1/2026,Tenant,100";

function query(data = [], error = null) {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), not: vi.fn(() => chain), range: vi.fn(() => chain),
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
    mocks.fetchFingerprints.mockResolvedValue([]);
    mocks.buildPreview.mockReturnValue({ batch_hash: batchHash, preview_hash: previewHash, rows: [{
      fingerprint, fingerprint_version: "v2", evidence_hash: "d".repeat(64), account_mapping_id: "account_1", date: "2026-08-01",
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
      p_rows: [expect.objectContaining({ fingerprint, fingerprint_version: "v2", financial_account_id: "account_1", classification: "safe_missing",
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

  it("sends a fresh personal row to the RPC, including account_scope and category for audit evidence", async () => {
    mocks.buildPreview.mockReturnValueOnce({ batch_hash: batchHash, preview_hash: previewHash, rows: [{
      fingerprint, evidence_hash: "d".repeat(64), account_mapping_id: "account_1", date: "2026-08-01",
      amount_cents: -2500, normalized_category: "groceries", classification: "personal",
      transaction_kind: "expense", affects_noi: false, capitalized: false,
      approvable: true, payee: "Grocery Store", account_scope: "personal", category: "Groceries",
    }] });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("approve_simplifi_csv_import", expect.objectContaining({
      p_rows: [expect.objectContaining({
        classification: "personal", account_scope: "personal", simplifi_category: "Groceries",
      })],
    }));
  });

  it("rejects a selected row whose classification is neither safe_missing nor personal, even if marked approvable", async () => {
    mocks.buildPreview.mockReturnValueOnce({ batch_hash: batchHash, preview_hash: previewHash,
      rows: [{ fingerprint, classification: "transfer_pair", approvable: true }] });
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

  it("accepts a v2 fingerprint in selectedFingerprints (regression: this regex used to accept v1 only)", async () => {
    const response = await POST(request({ selectedFingerprints: [fingerprint] }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalled();
  });

  it("still accepts a legacy v1-shaped fingerprint in selectedFingerprints", async () => {
    mocks.buildPreview.mockReturnValueOnce({ batch_hash: batchHash, preview_hash: "e".repeat(64),
      rows: [{ fingerprint: legacyFingerprint, classification: "already_imported", approvable: false }] });
    const response = await POST(request({ selectedFingerprints: [legacyFingerprint] }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, result: { applied: 0, already_applied: 1 } });
  });

  it("rejects a malformed or unversioned fingerprint", async () => {
    const response = await POST(request({ selectedFingerprints: [`v3:${"a".repeat(64)}`] }));
    expect(response.status).toBe(400);
    expect(mocks.buildPreview).not.toHaveBeenCalled();
  });
});
