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

const params = Promise.resolve({ accountId: "pf_acct_1" });
const today = new Date().toISOString().slice(0, 10);

function request(body) {
  return new Request("https://test/api/private-financing/accounts/pf_acct_1/payments/external/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(overrides = {}) {
  return {
    amountCents: 51_785,
    paymentMethod: "venmo",
    sourceReference: "VENMO-123",
    reason: "Seller confirmed receipt",
    borrowerVisibleExplanation: "Payment received.",
    effectiveDate: today,
    ...overrides,
  };
}

function client({
  account = { id: "pf_acct_1" },
  accountError = null,
  events = [{ ledger_sequence: 1, effective_date: today }],
  duplicateData = [],
  duplicateError = null,
} = {}) {
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
      if (table === "private_financing_accounts") return chain(account, accountError);
      if (table === "private_financing_events") return chain(events);
      if (table === "private_financing_components") return chain([]);
      if (table === "private_financing_account_terms_versions") return chain([]);
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(() => Promise.resolve({ data: duplicateData, error: duplicateError })),
  };
}

describe("POST external-payment preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET =
      "test-only-private-financing-preview-secret-123456";
    mocks.mapRows.mockReturnValue({
      events: [],
      componentVersions: [],
      accountTermsVersions: [],
    });
    mocks.preview.mockReturnValue({
      proposedAdjustment: { kind: "seller_confirmed_external_payment" },
      proposedEventPayload: { eventType: "payment_posted", eventOrigin: "manual_external" },
      warnings: [],
      blockingValidation: [],
    });
  });

  it("computes a signed read-only preview and checks duplicate candidates", async () => {
    const supabaseClient = client({ duplicateData: [{ id: "possible-duplicate" }] });
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient,
    });

    const response = await POST(request(body()), { params });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.previewToken).toEqual(expect.any(String));
    expect(payload.duplicateCandidates).toEqual([{ id: "possible-duplicate" }]);
    expect(supabaseClient.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseClient.rpc).toHaveBeenCalledWith(
      "find_private_financing_external_payment_duplicate_candidates",
      expect.objectContaining({
        p_owner_id: "owner-1",
        p_account_id: "pf_acct_1",
        p_amount_cents: 51_785,
        p_payment_method: "venmo",
        p_source_reference: "VENMO-123",
      }),
    );
    expect(supabaseClient.rpc).not.toHaveBeenCalledWith(
      "append_private_financing_event",
      expect.anything(),
    );
  });

  it("normalizes and binds external-payment inputs before preview", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    await POST(
      request(
        body({
          sourceReference: " ref-7 ",
          reason: " received ",
          borrowerVisibleExplanation: " Thank you. ",
          selectedExtraComponentId: " extra ",
        }),
      ),
      { params },
    );
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReference: "ref-7",
        reason: "received",
        borrowerVisibleExplanation: "Thank you.",
        selectedExtraComponentId: "extra",
      }),
    );
  });

  it("returns the authentication response without reading account data", async () => {
    mocks.authenticate.mockResolvedValue({
      response: Response.json({ error: "sign in" }, { status: 401 }),
    });
    const response = await POST(request(body()), { params });
    expect(response.status).toBe(401);
  });

  it("rejects future external-payment dates", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    const response = await POST(request(body({ effectiveDate: "2999-01-01" })), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("private_financing_future_external_payment");
  });

  it("rejects insertion before an existing ledger event", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    const response = await POST(request(body({ effectiveDate: "2000-01-01" })), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(
      "private_financing_external_payment_backdating_not_supported",
    );
  });

  it("returns 404 for an RLS-invisible or missing account", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client({ account: null }),
    });
    expect((await POST(request(body()), { params })).status).toBe(404);
  });

  it("returns a stable validation error for malformed payment input", async () => {
    mocks.preview.mockImplementation(() => {
      throw new TypeError("paymentMethod must be supported");
    });
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    const response = await POST(request(body({ paymentMethod: "crypto" })), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("private_financing_invalid_external_payment");
  });

  it("fails closed when duplicate detection is unavailable", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client({ duplicateError: { code: "XX000" } }),
    });
    const response = await POST(request(body()), { params });
    expect(response.status).toBe(500);
    expect(mocks.preview).toHaveBeenCalledOnce();
  });

  it("rejects malformed JSON", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "seller-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: client(),
    });
    const malformed = new Request("https://test/preview", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    });
    expect((await POST(malformed, { params })).status).toBe(400);
  });
});
