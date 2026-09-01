import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const authenticate = vi.fn();
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: (...args) => authenticate(...args),
}));

import { POST } from "./route.js";

function body(overrides = {}) {
  return {
    acknowledgeIrreversible: true,
    confirmationText: "IMPORT",
    sourceKey: "history-1",
    calculationStartDate: "2026-01-01",
    asOfDate: "2026-02-01",
    account: {
      product: "personal_loan",
      openedDate: "2026-01-01",
      lateFeePolicy: "disabled",
      platformFeeCents: 0,
      feePayer: "lender",
      paymentAcceptancePolicy: "partial_allowed",
      components: [{
        componentKey: "primary",
        label: "Primary",
        originalPrincipalCents: 100000,
        rateBps: 0,
        dayCountConvention: "actual_365",
        scheduledComponentAmountCents: 5000,
        allocationPriority: 1,
      }],
      paymentFrequency: "monthly",
      firstPaymentDueDate: "2026-02-01",
      regularScheduledPaymentAmountCents: 5000,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
      prepaymentPolicy: "allowed_without_penalty_does_not_advance_due_date",
      dayCountConvention: "actual_365",
    },
    payments: [{
      sourceReference: "payment-1",
      effectiveDate: "2026-02-01",
      amountCents: 5000,
    }],
    proposedPrincipalCredits: [{
      componentId: "primary",
      amountCents: 500,
      effectiveDate: "2026-02-01",
      sourceReference: "credit-1",
      correctionBasis: "discretionary_concession",
      reason: "Approved credit",
      borrowerVisibleExplanation: "One-time credit.",
    }],
    ...overrides,
  };
}

function request(payload) {
  return new NextRequest("https://forge.test/api/private-financing/imports/historical/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

describe("historical financing import confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({
      data: { status: "imported", accountId: "account-1", paymentEventCount: 1, creditEventCount: 1 },
      error: null,
    });
    authenticate.mockResolvedValue({
      user: { id: "actor-1" },
      effectiveOwnerId: "owner-1",
      supabaseClient: { rpc },
    });
  });

  it("rejects unauthenticated callers without invoking the RPC", async () => {
    authenticate.mockResolvedValueOnce({ response: new Response("unauthorized", { status: 401 }) });
    const response = await POST(request(body()));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires explicit acknowledgement and typed confirmation", async () => {
    const response = await POST(request(body({ confirmationText: "import" })));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recomputes allocations and imports under the canonical owner", async () => {
    const response = await POST(request(body()));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.reconciliation).toEqual({
      paymentCount: 1,
      totalCashCents: 5000,
      totalInterestPaidCents: 0,
      totalCashAppliedToPrincipalCents: 5000,
      totalPrincipalCreditCents: 500,
      principalAfterCreditsCents: 94500,
      totalUnallocatedCents: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      "import_private_financing_historical_account",
      expect.objectContaining({
        p_owner_id: "owner-1",
        p_source_key: "history-1",
        p_payments: [expect.objectContaining({
          ledgerOrder: 1,
          amountCents: 5000,
          principalPaidByComponentCents: { primary: 5000 },
          principalRemainingByComponentCents: { primary: 95000 },
        })],
        p_principal_credits: [expect.objectContaining({
          ledgerOrder: 2,
          componentId: "primary",
          amountCents: 500,
          correctedComponentPrincipalRemainingCentsAfter: 94500,
        })],
      }),
    );
  });

  it("maps a changed-plan import conflict to 409", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "conflict" } });
    const response = await POST(request(body()));
    expect(response.status).toBe(409);
  });

  it("fails before RPC when a credit exceeds remaining principal", async () => {
    const response = await POST(request(body({
      proposedPrincipalCredits: [{
        ...body().proposedPrincipalCredits[0],
        amountCents: 999999,
      }],
    })));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
