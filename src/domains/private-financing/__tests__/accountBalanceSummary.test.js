import { describe, expect, it } from "vitest";
import { computeAccountBalanceSummary } from "../accountBalanceSummary.js";

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

describe("computeAccountBalanceSummary", () => {
  it("returns null when there are no events yet -- never fabricates a balance from nothing", () => {
    expect(computeAccountBalanceSummary([], componentRows, termsRows)).toBeNull();
    expect(computeAccountBalanceSummary(null, componentRows, termsRows)).toBeNull();
  });

  it("computes the starting balance and combined regular scheduled payment right after account_opened, with no payments yet", () => {
    const summary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    expect(summary.remainingPrincipalByComponentCents).toEqual({ ib: 4_500_000, zi: 1_000_000 });
    expect(summary.totalPrincipalRemainingCents).toBe(5_500_000);
    expect(summary.regularScheduledPaymentCents).toBe(43_452 + 8_333);
    expect(summary.closed).toBe(false);
  });

  it("never names this figure with a 'current due'/'amount owed' field name -- it is a contractual schedule figure, not an arrears calculation", () => {
    const summary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    expect(summary).not.toHaveProperty("currentAmountDue");
    expect(summary).not.toHaveProperty("amountDue");
    expect(summary).not.toHaveProperty("amountOwed");
    expect(summary).not.toHaveProperty("regularPaymentCents");
  });

  it("defaults asOfDate to today when not supplied", () => {
    const summary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows);
    expect(summary.asOfDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("reports zero cumulative principal forgiven and zero unpaid accrued interest right at account opening", () => {
    const summary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-03-23" });
    expect(summary.cumulativePrincipalForgivenCents).toBe(0);
    expect(summary.unpaidAccruedInterestCents).toBe(0);
  });

  it("reports cumulative principal forgiven from a discretionary principal_correction event", () => {
    const correctionRow = {
      id: "pf_evt_credit", owner_id: "owner-1", account_id: "pf_acct_1", event_type: "principal_correction",
      event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 2, effective_date: "2022-04-01",
      recorded_at: "2022-04-01T00:00:00Z", reason: "goodwill credit", component_id: "zi",
      correction_basis: "discretionary_concession", delta_cents: -50_000,
      corrected_component_principal_remaining_cents_after: 950_000,
    };
    const summary = computeAccountBalanceSummary([openEventRow, correctionRow], componentRows, termsRows, { asOfDate: "2022-04-01" });
    expect(summary.cumulativePrincipalForgivenCents).toBe(50_000);
    expect(summary.remainingPrincipalByComponentCents.zi).toBe(950_000);
  });

  it("reports unpaid accrued interest that has built up with no payment yet", () => {
    const summary = computeAccountBalanceSummary([openEventRow], componentRows, termsRows, { asOfDate: "2022-04-23" });
    // 4,500,000 cents * 300 bps * 31 days / (10,000 * 365), rounded.
    expect(summary.unpaidAccruedInterestCents).toBeGreaterThan(0);
  });
});
