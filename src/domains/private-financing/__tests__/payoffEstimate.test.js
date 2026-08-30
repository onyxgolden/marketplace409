import { describe, expect, it } from "vitest";
import { computeAccountPayoffEstimate } from "../payoffEstimate.js";
import { computeAccountBalanceSummary } from "../accountBalanceSummary.js";

// This fixture happens to match South Main's own opening terms -- kept because several tests below assert
// specific dollar figures. accountBalanceSummary.test.js and the "independent account terms" test further
// down in this file prove the underlying engine is not coupled to these particular numbers.
const componentRows = [
  { owner_id: "owner-1", id: "comp_ib", account_id: "pf_acct_1", component_key: "ib", label: "Interest-bearing note", original_principal_cents: 4_500_000, rate_bps: 300, day_count_convention: "actual_365", scheduled_component_amount_cents: 43_452, allocation_priority: 1, effective_date: "2022-03-23", version_number: 1 },
  { owner_id: "owner-1", id: "comp_zi", account_id: "pf_acct_1", component_key: "zi", label: "Zero-interest note", original_principal_cents: 1_000_000, rate_bps: 0, day_count_convention: "actual_365", scheduled_component_amount_cents: 8_333, allocation_priority: 2, effective_date: "2022-03-23", version_number: 1 },
];
const termsRows = [
  {
    owner_id: "owner-1", id: "terms_1", account_id: "pf_acct_1", version_number: 1, payment_frequency: "monthly",
    first_payment_due_date: "2022-04-23", regular_scheduled_payment_amount_cents: 51_785, maturity_date: null,
    allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
    prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
    effective_date: "2022-03-23", acting_seller_id: "owner-1", amendment_reason: null,
  },
];
const openEventRow = {
  id: "pf_evt_open", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "account_opened",
  event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2022-03-23",
  recorded_at: "2022-03-23T00:00:00Z",
};

describe("computeAccountPayoffEstimate", () => {
  it("returns null when there is no balance summary (no events yet)", () => {
    expect(computeAccountPayoffEstimate({ eventRows: [], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary: null, lateFeePolicy: "disabled" })).toBeNull();
  });

  it("computes a real payoff estimate for an open account, calculated through the given asOfDate", () => {
    const balanceSummary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    const estimate = computeAccountPayoffEstimate({
      eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled",
    });
    expect(estimate).not.toBeNull();
    expect(estimate.calculatedThroughDate).toBe("2022-03-23");
    expect(estimate.principalByComponentCents.ib).toBe(4_500_000);
    expect(estimate.principalByComponentCents.zi).toBe(1_000_000);
    expect(estimate.calculatedPayoffCents).toBe(4_500_000 + 1_000_000); // zero days elapsed -- no accrual yet
  });

  it("excludes late charges (0, for an account whose own policy disables them) and never includes any fee field", () => {
    const balanceSummary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    const estimate = computeAccountPayoffEstimate({
      eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled",
    });
    expect(estimate.lateChargesCents).toBe(0);
    expect(estimate).not.toHaveProperty("stripeFeeCents");
    expect(estimate).not.toHaveProperty("processorFeeCents");
    expect(estimate).not.toHaveProperty("platformFeeCents");
  });

  it("returns null (never a fabricated $0 late-charge estimate) for an account whose own policy enables late fees, since V1 has no late-fee calculation engine yet", () => {
    const balanceSummary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    const estimate = computeAccountPayoffEstimate({
      eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "enabled",
    });
    expect(estimate).toBeNull();
  });

  it("sets an informational expiration strictly after issuedAt, for a future-refresh prompt", () => {
    const balanceSummary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    const estimate = computeAccountPayoffEstimate({
      eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled",
    });
    expect(estimate.expirationDate > estimate.issuedAt).toBe(true);
  });

  it("produces a deterministic quoteId from (accountId, asOfDate) -- reproducible, not randomly generated", () => {
    const balanceSummary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    const estimate1 = computeAccountPayoffEstimate({ eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled" });
    const estimate2 = computeAccountPayoffEstimate({ eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled" });
    expect(estimate1.quoteId).toBe(estimate2.quoteId);
  });

  it("returns null for a closed account rather than letting computePayoffQuote's own throw (on a closed account) escape", () => {
    // computeAccountPayoffEstimate checks the ALREADY-COMPUTED balanceSummary.closed flag before ever
    // calling computePayoffQuote, so a real closing ledger isn't needed to prove this boundary --
    // constructing one is exercised end-to-end by replayEvents.test.js and zeroBalanceInvariant.test.js.
    const closedBalanceSummary = { closed: true, totalPrincipalRemainingCents: 0 };
    const estimate = computeAccountPayoffEstimate({
      eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary: closedBalanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled",
    });
    expect(estimate).toBeNull();
  });

  it("carries the standard estimate disclaimer for display", () => {
    const balanceSummary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    const estimate = computeAccountPayoffEstimate({
      eventRows: [openEventRow], componentRows, termsRows, accountId: "pf_acct_1", balanceSummary, asOfDate: "2022-03-23", lateFeePolicy: "disabled",
    });
    expect(estimate.isEstimate).toBe(true);
    expect(estimate.estimateDisclaimer).toMatch(/estimate/i);
  });

  it("computes a correct estimate for an account whose terms are independent of South Main's own numbers", () => {
    // A different rate, different principal, different start date, and only ONE component -- proving the
    // estimate path is driven entirely by whatever terms are passed in, not coupled to the fixture used by
    // the other tests here.
    const genericComponents = [
      { owner_id: "owner-2", id: "comp_only", account_id: "acct_generic", component_key: "only", label: "Note", original_principal_cents: 250_000, rate_bps: 750, day_count_convention: "actual_365", scheduled_component_amount_cents: 6_000, allocation_priority: 1, effective_date: "2025-01-10", version_number: 1 },
    ];
    const genericTerms = [
      {
        owner_id: "owner-2", id: "terms_generic", account_id: "acct_generic", version_number: 1, payment_frequency: "monthly",
        first_payment_due_date: "2025-02-10", regular_scheduled_payment_amount_cents: 6_000, maturity_date: null,
        allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra",
        prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365",
        effective_date: "2025-01-10", acting_seller_id: "owner-2", amendment_reason: null,
      },
    ];
    const genericOpenEvent = {
      id: "evt_open_generic", owner_id: "owner-2", account_id: "acct_generic", event_type: "account_opened",
      event_origin: "interactive_user", created_by: "owner-2", ledger_sequence: 1, effective_date: "2025-01-10",
      recorded_at: "2025-01-10T00:00:00Z",
    };
    const balanceSummary = computeAccountBalanceSummary([genericOpenEvent], genericComponents, genericTerms, { asOfDate: "2025-01-10" });
    const estimate = computeAccountPayoffEstimate({
      eventRows: [genericOpenEvent], componentRows: genericComponents, termsRows: genericTerms, accountId: "acct_generic", balanceSummary, asOfDate: "2025-01-10", lateFeePolicy: "disabled",
    });
    expect(estimate.principalByComponentCents.only).toBe(250_000);
    expect(estimate.totalPrincipalCents).toBe(250_000);
    expect(estimate.calculatedPayoffCents).toBe(250_000);
  });
});
