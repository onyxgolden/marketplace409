import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  mapRows: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));
vi.mock("@/domains/private-financing/persistedRowMapping", () => ({
  mapEventRowsForReplay: mocks.mapRows,
}));
vi.mock("@/domains/private-financing/externalPaymentPreview", () => ({
  previewSellerConfirmedExternalPayment: mocks.preview,
}));

import { POST } from "./route";
import { encodeAdjustmentPreviewToken } from "@/domains/private-financing/adjustmentPreviewToken";

const params = Promise.resolve({ accountId: "pf_acct_1" });
const today = new Date().toISOString().slice(0, 10);
const secret = "test-only-private-financing-preview-secret-123456";

function inputs(overrides = {}) {
  return {
    amountCents: 51_785,
    paymentMethod: "venmo",
    sourceReference: "VENMO-123",
    reason: "Seller confirmed receipt",
    borrowerVisibleExplanation: "Payment received.",
    externalEvidenceReference: null,
    acknowledgeOverpayment: false,
    selectedExtraComponentId: null,
    ...overrides,
  };
}

function token(tokenInputs = inputs(), sequence = 1) {
  return encodeAdjustmentPreviewToken(
    {
      accountId: "pf_acct_1",
      actionType: "seller_confirmed_external_payment",
      inputs: tokenInputs,
      ledgerSequenceAtPreview: sequence,
      asOfDate: today,
      ownerId: "owner-1",
      actingUserId: "seller-1",
    },
    { secret },
  );
}

function request(requestInputs = inputs(), previewToken = token(requestInputs)) {
  return new Request("https://test/external/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requestInputs, previewToken, internalNote: " private note " }),
  });
}

function eventRow(overrides = {}) {
  return {
    id: "pf_evt_2",
    account_id: "pf_acct_1",
    event_type: "payment_posted",
    event_origin: "manual_external",
    ledger_sequence: 2,
    effective_date: today,
    recorded_at: "2026-08-30T16:00:00Z",
    amount_cents: 51_785,
    payment_method: "venmo",
    source_reference: "VENMO-123",
    ...overrides,
  };
}

function client({ events = [{ ledger_sequence: 1, effective_date: today }], rpcData = eventRow(), rpcError = null } = {}) {
  function chain(data, error = null) {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => Promise.resolve({ data, error }),
      maybeSingle: () => Promise.resolve({ data, error }),
      then: (resolve) => resolve({ data, error }),
    };
    return query;
  }
  return {
    from: vi.fn((table) => {
      if (table === "private_financing_accounts") return chain({ id: "pf_acct_1" });
      if (table === "private_financing_events") return chain(events);
      if (table === "private_financing_components") return chain([]);
      if (table === "private_financing_account_terms_versions") return chain([]);
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(() => Promise.resolve({ data: rpcData, error: rpcError })),
  };
}

describe("POST external-payment confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET = secret;
    mocks.mapRows.mockReturnValue({ events: [], componentVersions: [], accountTermsVersions: [] });
    mocks.preview.mockReturnValue({
      blockingValidation: [],
      proposedEventPayload: {
        eventType: "payment_posted",
        eventOrigin: "manual_external",
        effectiveDate: today,
        amountCents: 51_785,
        reason: "Seller confirmed receipt",
        borrowerVisibleExplanation: "Payment received.",
        allocation: {
          interestPaidByComponentCents: { primary: 10_000 },
          principalPaidByComponentCents: { primary: 41_785 },
          unallocatedCents: 0,
        },
        principalRemainingByComponentCents: { primary: 100_000 },
        selectedExtraComponentId: null,
      },
    });
  });

  it("recomputes fresh and posts through only the atomic external-payment RPC", async () => {
    const supabaseClient = client();
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(200);
    expect(supabaseClient.rpc).toHaveBeenCalledOnce();
    expect(supabaseClient.rpc).toHaveBeenCalledWith(
      "confirm_private_financing_external_payment",
      expect.objectContaining({
        p_owner_id: "owner-1",
        p_account_id: "pf_acct_1",
        p_expected_ledger_sequence: 1,
        p_event_payload: expect.objectContaining({
          p_event_type: "payment_posted",
          p_event_origin: "manual_external",
          p_payment_method: "venmo",
          p_source_reference: "VENMO-123",
          p_internal_note: "private note",
        }),
      }),
    );
    expect(mocks.preview).toHaveBeenCalledOnce();
  });

  it("rejects changed inputs bound to an earlier signed preview", async () => {
    const original = inputs();
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    const response = await POST(
      request(inputs({ amountCents: 40_000 }), token(original)),
      { params },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("private_financing_stale_preview");
  });

  it("returns the existing receipt after a successful post whose response was lost", async () => {
    const existing = eventRow();
    const supabaseClient = client({
      events: [{ ledger_sequence: 1, effective_date: today }, existing],
    });
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.event.idempotentRetry).toBe(true);
    expect(payload.event.id).toBe("pf_evt_2");
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("rejects a moved ledger when no exact external-payment receipt exists", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client({
        events: [{ ledger_sequence: 1, effective_date: today }, eventRow({ event_type: "principal_correction" })],
      }),
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("private_financing_stale_preview");
  });

  it("does not call the RPC when fresh replay reports a blocker", async () => {
    const supabaseClient = client();
    mocks.preview.mockReturnValue({
      blockingValidation: ["Acknowledge the unapplied amount."],
      proposedEventPayload: null,
    });
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(400);
    expect(supabaseClient.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["40001", "private_financing_stale_preview"],
    ["23505", "private_financing_external_reference_conflict"],
  ])("maps database conflict %s to stable 409 code", async (dbCode, responseCode) => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client({ rpcError: { code: dbCode } }),
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(responseCode);
  });

  it("rejects an invalid or expired token before reading the account", async () => {
    const supabaseClient = client();
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });
    const response = await POST(request(inputs(), "not-a-token"), { params });
    expect(response.status).toBe(409);
    expect(supabaseClient.from).not.toHaveBeenCalled();
  });
});
