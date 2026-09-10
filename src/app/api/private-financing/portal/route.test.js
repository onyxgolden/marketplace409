import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET, borrowerIdentityIds, buildBorrowerPortalModelSafely, buildBorrowerProjectionModel, summarizeBorrowerEvents, BorrowerSummaryUnavailableError } from "./route";

// A minimal chainable Supabase query-builder stand-in: every chain method returns itself, and it
// resolves (via `.then` or `.maybeSingle()`) to the canned `result` regardless of how it was built.
function chainable(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function fakeDb({ user, authError = null, claim = { data: { claimedIdentityCount: 0 }, error: null }, fromResults = {} }) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }) },
    rpc: vi.fn().mockResolvedValue(claim),
    from: vi.fn((table) => chainable(fromResults[table] ?? { data: [], error: null })),
  };
}

function request(search = "") {
  return new Request(`https://test/api/private-financing/portal${search}`);
}

describe("GET private financing borrower portal", () => {
  it("carries the invited email from the query string through the 401 sign-in URL when unauthenticated", async () => {
    mocks.createClient.mockResolvedValue(fakeDb({ user: null, authError: { message: "no session" } }));
    const response = await GET(request("?email=Borrower@Example.com"));
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.invitedEmail).toBe("borrower@example.com");
    expect(body.signInUrl).toBe("/auth?next=%2Fforge%2Fprivate-financing%2Fportal&email=borrower%40example.com");
  });

  it("carries the invited email through a failed-claim 400 response", async () => {
    mocks.createClient.mockResolvedValue(fakeDb({
      user: { id: "user-1", email: "wrong@example.com" },
      claim: { data: null, error: { code: "P0001" } },
    }));
    const response = await GET(request("?email=borrower@example.com"));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.invitedEmail).toBe("borrower@example.com");
    expect(body.signInUrl).toContain("email=borrower%40example.com");
  });

  it("flags mismatched:true when the signed-in email differs from the invited email and nothing matched", async () => {
    mocks.createClient.mockResolvedValue(fakeDb({ user: { id: "user-1", email: "wrong@example.com" } }));
    const response = await GET(request("?email=borrower@example.com"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.mismatched).toBe(true);
    expect(body.invitedEmail).toBe("borrower@example.com");
    expect(body.accounts).toEqual([]);
  });

  it("does not flag a mismatch when there was no invited email to compare against", async () => {
    mocks.createClient.mockResolvedValue(fakeDb({ user: { id: "user-1", email: "wrong@example.com" } }));
    const response = await GET(request());
    const body = await response.json();
    expect(body.mismatched).toBe(false);
    expect(body.invitedEmail).toBeNull();
  });
});

describe("private financing borrower portal summary", () => {
  it("scopes memberships to unique borrower identities claimed by the signed-in auth user", () => {
    expect(borrowerIdentityIds([{ id: "borrower-1" }, { id: "borrower-1" }, { id: "borrower-2" }, { id: null }])).toEqual([
      "borrower-1",
      "borrower-2",
    ]);
  });

  it("does not display zero for a fallback account with real remaining principal (current schema)", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000,
        interest_paid_by_component_cents: { note: 10000 },
        principal_remaining_by_component_cents: { note: 3184347 },
      },
    ]);
    expect(summary.principalRemainingCents).toBe(3184347);
    expect(summary.principalRemainingCents).not.toBe(0);
    expect(summary).toEqual({ paymentCount: 1, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 3184347 });
  });

  it("includes a later principal correction instead of showing the preceding payment balance", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000,
        interest_paid_by_component_cents: { note: 10000 },
        principal_remaining_by_component_cents: { note: 3300000 },
      },
      {
        id: "corr-1", ledger_sequence: 2, event_type: "principal_correction",
        component_id: "note", corrected_component_principal_remaining_cents_after: 3184347,
      },
    ]);
    expect(summary).toEqual({ paymentCount: 1, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 3184347 });
  });

  it("derives interest paid from the current schema's per-component interest map, net of reversals", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000,
        interest_paid_by_component_cents: { "interest-bearing": 7000, "zero-interest": 0 },
        principal_remaining_by_component_cents: { "interest-bearing": 90000, "zero-interest": 40000 },
      },
    ]);
    expect(summary.interestPaidCents).toBe(7000);
  });

  it("summarizes interest-bearing and zero-interest components correctly without conflating them", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 15000,
        interest_paid_by_component_cents: { "interest-bearing": 5000, "zero-interest": 0 },
        principal_remaining_by_component_cents: { "interest-bearing": 80000, "zero-interest": 40000 },
      },
    ]);
    // Both components' remaining balances aggregate into one total, but neither is lost or double-counted.
    expect(summary.principalRemainingCents).toBe(120000);
  });

  it("aggregates multiple components correctly when only one is later corrected", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 15000,
        interest_paid_by_component_cents: { a: 5000, b: 1000 },
        principal_remaining_by_component_cents: { a: 80000, b: 40000, c: 20000 },
      },
      { id: "corr-1", ledger_sequence: 2, event_type: "principal_correction", component_id: "b", corrected_component_principal_remaining_cents_after: 35000 },
    ]);
    // a and c keep their last known snapshot values (80000, 20000); only b changes (40000 -> 35000).
    expect(summary.principalRemainingCents).toBe(80000 + 35000 + 20000);
  });

  it("does not double-count principal or interest across a payment followed by its reversal", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000,
        interest_paid_by_component_cents: { note: 10000 },
        principal_remaining_by_component_cents: { note: 90000 },
      },
      {
        id: "rev-1", ledger_sequence: 2, event_type: "payment_reversal", amount_cents: 60000,
        interest_paid_by_component_cents: { note: 10000 },
        principal_remaining_by_component_cents: { note: 100000 },
      },
    ]);
    // The reversal's own snapshot is authoritative -- principal is restored, and net interest paid is zero.
    expect(summary.principalRemainingCents).toBe(100000);
    expect(summary.interestPaidCents).toBe(0);
  });

  it("returns exactly zero for a legitimately paid-off account (distinct from 'cannot compute')", () => {
    const summary = summarizeBorrowerEvents([
      {
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 100000,
        interest_paid_by_component_cents: { note: 0 },
        principal_remaining_by_component_cents: { note: 0 },
      },
      {
        id: "close-1", ledger_sequence: 2, event_type: "payoff_concession",
        delta_cents_by_component_cents: { note: 0 },
        principal_remaining_by_component_cents: { note: 0 },
      },
    ]);
    expect(summary.principalRemainingCents).toBe(0);
  });

  it("fails closed (throws) instead of fabricating a zero balance when a payment is missing its principal snapshot", () => {
    expect(() =>
      summarizeBorrowerEvents([{ id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000 }]),
    ).toThrow(BorrowerSummaryUnavailableError);
  });

  it("fails closed on an event type it cannot safely interpret without full replay (compensating_correction)", () => {
    expect(() =>
      summarizeBorrowerEvents([
        {
          id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000,
          interest_paid_by_component_cents: { note: 0 }, principal_remaining_by_component_cents: { note: 90000 },
        },
        { id: "comp-1", ledger_sequence: 2, event_type: "compensating_correction", component_id: "note", delta_cents: 5000, reverses_event_id: "corr-x" },
      ]),
    ).toThrow(BorrowerSummaryUnavailableError);
  });

  it("fails closed when no event carries any principal-remaining snapshot at all", () => {
    expect(() => summarizeBorrowerEvents([{ id: "open", ledger_sequence: 1, event_type: "account_opened" }])).toThrow(
      BorrowerSummaryUnavailableError,
    );
  });

  it("builds a borrower-safe payoff model through the authoritative replay engine", () => {
    const model = buildBorrowerProjectionModel({
      asOfDate: "2026-01-01",
      eventRows: [{
        id: "open", account_id: "account-1", event_type: "account_opened", event_origin: "system_import",
        ledger_sequence: 1, effective_date: "2026-01-01", recorded_at: "2026-01-01T00:00:00.000Z",
      }],
      componentRows: [{
        owner_id: "owner-1", id: "component-1", account_id: "account-1", component_key: "note", label: "Note",
        original_principal_cents: 100000, rate_bps: 300, day_count_convention: "actual_365",
        scheduled_component_amount_cents: 10000, allocation_priority: 1, effective_date: "2026-01-01", version_number: 1,
      }],
      termsRows: [{
        owner_id: "owner-1", id: "terms-1", account_id: "account-1", version_number: 1, payment_frequency: "monthly",
        first_payment_due_date: "2026-02-01", regular_scheduled_payment_amount_cents: 10000, maturity_date: null,
        allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
        prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
        effective_date: "2026-01-01", acting_seller_id: "owner-1", amendment_reason: null,
      }],
    });
    expect(model.summary).toMatchObject({ principalRemainingCents: 100000, interestPaidCents: 0, principalCreditsCents: 0 });
    expect(model.projection.baseline.payoffDate).toBeTruthy();
    expect(model.projection.seed.firstProjectedPaymentDate).toBe("2026-02-01");
  });

  it("keeps the borrower account available (current schema) when the optional projection cannot be built", () => {
    // No account_opened event -- replayEvents.js requires exactly one, so buildBorrowerProjectionModel
    // throws before its own internal try/catch, and buildBorrowerPortalModelSafely falls back to the
    // defensive snapshot walk. This exercises the actual trigger condition (a replay failure), not an
    // "unsupported due state" -- those are already handled cleanly inside buildBorrowerProjectionModel
    // itself and never reach this fallback at all.
    const model = buildBorrowerPortalModelSafely({
      asOfDate: "2026-01-01",
      eventRows: [{
        id: "pay-1", ledger_sequence: 1, event_type: "payment_posted",
        amount_cents: 60000,
        interest_paid_by_component_cents: { note: 10000 },
        principal_remaining_by_component_cents: { note: 3184347 },
      }],
      componentRows: [],
      termsRows: [{
        version_number: 1,
        effective_date: "2022-03-23",
        regular_scheduled_payment_amount_cents: 51785,
      }],
    });

    expect(model.progressAvailable).toBe(false);
    expect(model.summaryAvailable).toBe(true);
    expect(model.projection).toBeNull();
    expect(model.summary.principalRemainingCents).toBe(3184347);
    expect(model.summary.principalRemainingCents).not.toBe(0);
    expect(model.regularScheduledPaymentCents).toBe(51785);
  });

  it("fails closed end-to-end (summary: null, summaryAvailable: false) instead of showing $0.00 when both replay and the fallback cannot trust the data", () => {
    // Same missing-account_opened replay failure as above, but this time the events ALSO carry no
    // principal snapshot at all -- so the defensive fallback can't compute anything trustworthy either.
    const model = buildBorrowerPortalModelSafely({
      asOfDate: "2026-01-01",
      eventRows: [{ id: "pay-1", ledger_sequence: 1, event_type: "payment_posted", amount_cents: 60000 }],
      componentRows: [],
      termsRows: [{ version_number: 1, effective_date: "2022-03-23", regular_scheduled_payment_amount_cents: 51785 }],
    });

    expect(model.progressAvailable).toBe(false);
    expect(model.summaryAvailable).toBe(false);
    expect(model.summary).toBeNull();
    expect(model.summaryUnavailableReason).toBeTruthy();
  });

  it("leaves the primary replay projection path unaffected by the fallback correction", () => {
    // Same fixture as the "authoritative replay engine" test above, re-asserted here as an explicit
    // regression guard: this slice only touched the fallback path and buildBorrowerPortalModelSafely's
    // wiring, never buildBorrowerProjectionModel or replayEvents.js itself.
    const model = buildBorrowerProjectionModel({
      asOfDate: "2026-01-01",
      eventRows: [{
        id: "open", account_id: "account-1", event_type: "account_opened", event_origin: "system_import",
        ledger_sequence: 1, effective_date: "2026-01-01", recorded_at: "2026-01-01T00:00:00.000Z",
      }],
      componentRows: [{
        owner_id: "owner-1", id: "component-1", account_id: "account-1", component_key: "note", label: "Note",
        original_principal_cents: 100000, rate_bps: 300, day_count_convention: "actual_365",
        scheduled_component_amount_cents: 10000, allocation_priority: 1, effective_date: "2026-01-01", version_number: 1,
      }],
      termsRows: [{
        owner_id: "owner-1", id: "terms-1", account_id: "account-1", version_number: 1, payment_frequency: "monthly",
        first_payment_due_date: "2026-02-01", regular_scheduled_payment_amount_cents: 10000, maturity_date: null,
        allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
        prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
        effective_date: "2026-01-01", acting_seller_id: "owner-1", amendment_reason: null,
      }],
    });
    expect(model.summary).toMatchObject({ principalRemainingCents: 100000, interestPaidCents: 0, principalCreditsCents: 0 });
    expect(model.projection.baseline.payoffDate).toBeTruthy();
  });
});
