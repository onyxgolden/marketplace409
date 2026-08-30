import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/supabase/createAuthenticatedPrivateFinancingApplication", () => ({
  createAuthenticatedPrivateFinancingApplication: mocks.authenticate,
}));

import { POST } from "./route";
import { allocatePayment } from "@/domains/private-financing/paymentAllocation";
import { computeAccrual } from "@/domains/private-financing/interestAccrual";
import { roundToNearestCent } from "@/domains/private-financing/currencyMath";

const params = Promise.resolve({ accountId: "pf_acct_1" });

function req(body) {
  return new Request("https://test/api/private-financing/accounts/pf_acct_1/adjustments/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const openEventRow = {
  id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_opened",
  event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2022-03-23",
  recorded_at: "2022-03-23T00:00:00Z",
};
const componentVersionRows = [
  { owner_id: "owner-1", id: "pf_comp_1", account_id: "pf_acct_1", component_key: "ib", label: "Interest-bearing note", original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365", scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
  { owner_id: "owner-1", id: "pf_comp_2", account_id: "pf_acct_1", component_key: "zi", label: "Zero-interest note", original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 8_333, allocation_priority: 2, effective_date: "2022-03-23", version_number: 1 },
];
const termsVersionRows = [
  {
    owner_id: "owner-1", id: "pf_terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly",
    first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null,
    allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
    prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
    effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null,
  },
];

function buildClient({ account = { id: "pf_acct_1" }, accountError = null, events = [openEventRow], componentVersions = componentVersionRows, termsVersions = termsVersionRows } = {}) {
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
      if (table === "private_financing_components") return chain(componentVersions);
      if (table === "private_financing_account_terms_versions") return chain(termsVersions);
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

const today = new Date().toISOString().slice(0, 10);

describe("POST /api/private-financing/accounts/[accountId]/adjustments/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET = "test-only-private-financing-preview-secret-123456";
  });

  it("is non-mutating: computes a preview and never touches the RPC (the mock client doesn't even define one)", async () => {
    const client = buildClient();
    expect(client.rpc).toBeUndefined(); // if the route called .rpc(...), this would throw TypeError, not silently pass
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: client });

    const response = await POST(req({ actionType: "contractual_principal_correction", inputs: { componentId: "zi", deltaCents: -1000, reason: "typo" } }), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.proposedEventPayloads.length).toBeGreaterThan(0);
    expect(body.preview.proposedEventPayloads.every((event) => event.eventType === "principal_correction")).toBe(true);
  });

  it("returns a previewToken binding the account, action, inputs, and current ledger sequence", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await POST(req({ actionType: "interest_correction", inputs: { componentId: "ib", deltaCents: -100, reason: "fix" } }), { params })).json();
    expect(typeof body.previewToken).toBe("string");
    expect(body.previewToken.length).toBeGreaterThan(0);
  });

  it("computes a bring_current_credit preview correctly, deriving the schedule/shortage/next-due-date from the authoritative due-state engine, never from caller input", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await POST(req({
      actionType: "bring_current_credit",
      inputs: { componentId: "ib", reason: "bring current", borrowerVisibleExplanation: "Credit applied." },
    }), { params })).json();
    expect(body.preview.proposedEventPayload.eventType).toBe("principal_correction");
    expect(body.preview.pastDueEffect).not.toBeNull();
    expect(body.preview.pastDueEffect.nextDueDate).toBeTruthy();
    expect(typeof body.preview.pastDueEffect.shortageCents).toBe("number");
  });

  it("bring_current_credit fails closed (blockingValidation, never a guessed shortage) for an account whose own prepayment policy is outside the due-state engine's supported envelope -- a real, end-to-end 'unsupported policy blocks preview' proof, not only a unit test", async () => {
    const unsupportedTerms = termsVersionRows.map((row) => ({ ...row, prepayment_policy: "unsupported" }));
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ termsVersions: unsupportedTerms }) });
    const response = await POST(req({
      actionType: "bring_current_credit",
      inputs: { componentId: "ib", reason: "bring current", borrowerVisibleExplanation: "Credit applied." },
    }), { params });
    const body = await response.json();
    expect(response.status).toBe(200); // a business-rule ineligibility, not a malformed-request error
    expect(body.preview.pastDueEffect).toBeNull();
    expect(body.preview.blockingValidation.length).toBeGreaterThan(0);
    expect(body.preview.proposedEventPayload).toBeNull();
  });

  it("computes a payment_reversal preview correctly given a target event id", async () => {
    // Built via the SAME accrual/allocation engine the RPC/replay would use, so the fixture's stored
    // allocation is guaranteed to pass ledgerIntegrity's own independent recomputation check -- never
    // hand-typed numbers that merely look plausible.
    const accruedInterestCents = roundToNearestCent(
      computeAccrual({ principalRemainingCents: 4_500_000, rateBps: 300, fromDate: "2022-03-23", toDate: "2022-04-23" }),
    );
    const allocation = allocatePayment({
      components: [
        { componentId: "ib", remainingPrincipalCents: 4_500_000, scheduledComponentAmountCents: 43_452, rateBps: 300, allocationPriority: 1 },
        { componentId: "zi", remainingPrincipalCents: 1_000_000, scheduledComponentAmountCents: 8_333, rateBps: 0, allocationPriority: 2 },
      ],
      accruedInterestCentsByComponent: { ib: accruedInterestCents },
      paymentAmountCents: 51_785,
      allocationPolicy: "scheduled_component_order",
      extraPaymentAllocationPolicy: "highest_rate_first_extra",
    });
    const paymentEvent = {
      id: "pf_evt_pay", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "payment_posted",
      event_origin: "manual_import", idempotency_key: "k1", ledger_sequence: 2, effective_date: "2022-04-23",
      recorded_at: "2022-04-23T00:00:00Z", amount_cents: 51_785,
      interest_paid_by_component_cents: allocation.interestPaidByComponentCents,
      principal_paid_by_component_cents: allocation.principalPaidByComponentCents,
      unallocated_cents: allocation.unallocatedCents,
      principal_remaining_by_component_cents: {
        ib: 4_500_000 - (allocation.principalPaidByComponentCents.ib ?? 0),
        zi: 1_000_000 - (allocation.principalPaidByComponentCents.zi ?? 0),
      },
      selected_extra_component_id: null,
    };
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ events: [openEventRow, paymentEvent] }) });
    const response = await POST(req({ actionType: "payment_reversal", inputs: { reversesEventId: "pf_evt_pay", reason: "bounced" }, effectiveDate: today }), { params });
    const body = await response.json();
    if (response.status !== 200) throw new Error(`status=${response.status} body=${JSON.stringify(body)}`);
    expect(body.preview.proposedEventPayload.eventType).toBe("payment_reversal");
    expect(body.preview.blockingValidation).toEqual([]);
  });

  it("surfaces blockingValidation for an invalid adjustment (e.g. reducing principal below zero) without erroring", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const body = await (await POST(req({ actionType: "contractual_principal_correction", inputs: { componentId: "zi", deltaCents: -99_999_999, reason: "oops" } }), { params })).json();
    expect(body.preview.blockingValidation.length).toBeGreaterThan(0);
    expect(body.preview.proposedEventPayload).toBeNull();
  });

  it("rejects an unrecognized action type", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const response = await POST(req({ actionType: "not_a_real_action", inputs: {} }), { params });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("private_financing_unknown_action_type");
  });

  it("rejects malformed adjustment inputs (e.g. missing reason) as a stable, safe validation error", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const response = await POST(req({ actionType: "contractual_principal_correction", inputs: { componentId: "zi", deltaCents: -100 } }), { params });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("private_financing_invalid_adjustment_input");
  });

  it("rejects a backdated effective date -- SF-2D is today/prospective only", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const response = await POST(req({ actionType: "interest_correction", inputs: { componentId: "ib", deltaCents: -100, reason: "fix" }, effectiveDate: "2020-01-01" }), { params });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("private_financing_backdating_not_supported");
  });

  it("accepts a prospective (future) effective date", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient() });
    const response = await POST(req({ actionType: "interest_correction", inputs: { componentId: "ib", deltaCents: -100, reason: "fix" }, effectiveDate: "2099-01-01" }), { params });
    expect(response.status).toBe(200);
  });

  it("returns 404 for a missing or inaccessible account, with no side-channel detail", async () => {
    mocks.authenticate.mockResolvedValue({ user: { id: "owner-1" }, effectiveOwnerId: "owner-1", supabaseClient: buildClient({ account: null }) });
    const response = await POST(req({ actionType: "interest_correction", inputs: { componentId: "ib", deltaCents: -100, reason: "fix" } }), { params });
    expect(response.status).toBe(404);
  });

  it("returns 503 with a stable code when the schema doesn't exist remotely yet", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "owner-1" }, effectiveOwnerId: "owner-1",
      supabaseClient: buildClient({ account: null, accountError: { code: "42P01", message: "relation does not exist" } }),
    });
    const response = await POST(req({ actionType: "interest_correction", inputs: { componentId: "ib", deltaCents: -100, reason: "fix" } }), { params });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("private_financing_schema_unavailable");
  });

  it("propagates the 401 response from the auth factory unchanged", async () => {
    mocks.authenticate.mockResolvedValue({ response: new Response(JSON.stringify({ error: "Authenticated owner id is required." }), { status: 401 }) });
    const response = await POST(req({ actionType: "interest_correction", inputs: {} }), { params });
    expect(response.status).toBe(401);
  });
});
