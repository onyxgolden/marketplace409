import { describe, expect, it } from "vitest";
import { buildBorrowerProjectionModel, summarizeBorrowerEvents } from "./route";

describe("private financing borrower portal summary", () => {
  it("includes a later principal correction instead of showing the preceding payment balance", () => {
    const summary = summarizeBorrowerEvents([
      { event_type: "payment_posted", amount_cents: 60000, interest_paid_cents: 10000, principal_remaining_interest_bearing_cents: 3300000, principal_remaining_zero_interest_cents: 0 },
      { event_type: "principal_correction", component_type: "interest_bearing", corrected_component_principal_remaining_cents_after: 3184347 },
    ]);
    expect(summary).toEqual({ paymentCount: 1, totalPaidCents: 60000, interestPaidCents: 10000, principalRemainingCents: 3184347 });
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
});
