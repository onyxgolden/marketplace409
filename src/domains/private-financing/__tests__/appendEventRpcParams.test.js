import { describe, expect, it } from "vitest";
import { buildAppendEventRpcParams } from "../appendEventRpcParams.js";

describe("buildAppendEventRpcParams", () => {
  it("maps a principal_correction payload to the RPC's exact p_* parameter names", () => {
    const payload = {
      eventType: "principal_correction", eventOrigin: "interactive_user", effectiveDate: "2026-08-30",
      componentId: "zi", correctionBasis: "discretionary_concession", deltaCents: -5_000,
      correctedComponentPrincipalRemainingCentsAfter: 995_000, reason: "goodwill", borrowerVisibleExplanation: "We reduced your balance.",
    };
    const params = buildAppendEventRpcParams(payload, { ownerId: "owner-1", accountId: "pf_acct_1", internalNote: "seller note" });
    expect(params).toMatchObject({
      p_owner_id: "owner-1", p_account_id: "pf_acct_1", p_event_type: "principal_correction",
      p_event_origin: "interactive_user", p_effective_date: "2026-08-30",
      p_component_id: "zi", p_correction_basis: "discretionary_concession", p_delta_cents: -5_000,
      p_corrected_component_principal_remaining_cents_after: 995_000, p_reason: "goodwill",
      p_borrower_visible_explanation: "We reduced your balance.", p_internal_note: "seller note",
    });
  });

  it("never includes a p_created_by key at all -- the RPC always derives it itself", () => {
    const payload = { eventType: "interest_correction", eventOrigin: "interactive_user", effectiveDate: "2026-08-30", componentId: "ib", correctionBasis: "contractual_administrative", deltaCents: -100, reason: "typo" };
    const params = buildAppendEventRpcParams(payload, { ownerId: "owner-1", accountId: "pf_acct_1" });
    expect(Object.prototype.hasOwnProperty.call(params, "p_created_by")).toBe(false);
  });

  it("never derives p_idempotency_key/p_source_reference/p_payment_method from the payload -- always null for SF-2D actions", () => {
    const payload = {
      eventType: "payment_reversal", eventOrigin: "interactive_user", effectiveDate: "2026-08-30", reversesEventId: "pf_evt_1", amountCents: 100,
      allocation: { interestPaidByComponentCents: {}, principalPaidByComponentCents: { ib: 100 }, unallocatedCents: 0 }, reason: "bounced",
    };
    const params = buildAppendEventRpcParams(payload, { ownerId: "owner-1", accountId: "pf_acct_1" });
    expect(params.p_idempotency_key).toBeNull();
    expect(params.p_source_reference).toBeNull();
    expect(params.p_payment_method).toBeNull();
    expect(params.p_external_evidence_reference).toBeNull();
  });

  it("maps allocation and principalRemainingByComponentCents sub-objects to their flat p_* fields", () => {
    const payload = {
      eventType: "payment_reversal", eventOrigin: "interactive_user", effectiveDate: "2026-08-30",
      reversesEventId: "pf_evt_1", amountCents: 51_785,
      allocation: { interestPaidByComponentCents: { ib: 100 }, principalPaidByComponentCents: { ib: 43_452, zi: 8_233 }, unallocatedCents: 0 },
      principalRemainingByComponentCents: { ib: 4_500_000, zi: 1_000_000 },
      reason: "bounced",
    };
    const params = buildAppendEventRpcParams(payload, { ownerId: "owner-1", accountId: "pf_acct_1" });
    expect(params.p_interest_paid_by_component_cents).toEqual({ ib: 100 });
    expect(params.p_principal_paid_by_component_cents).toEqual({ ib: 43_452, zi: 8_233 });
    expect(params.p_unallocated_cents).toBe(0);
    expect(params.p_principal_remaining_by_component_cents).toEqual({ ib: 4_500_000, zi: 1_000_000 });
  });

  it("maps selectedExtraComponentId and payoff_concession's per-component delta map", () => {
    const paymentPayload = {
      eventType: "payment_posted", eventOrigin: "interactive_user", effectiveDate: "2026-08-30", amountCents: 1_000,
      allocation: { interestPaidByComponentCents: {}, principalPaidByComponentCents: { ib: 1_000 }, unallocatedCents: 0 },
      principalRemainingByComponentCents: { ib: 999_000 }, selectedExtraComponentId: "ib",
    };
    expect(buildAppendEventRpcParams(paymentPayload, { ownerId: "owner-1", accountId: "pf_acct_1" }).p_selected_extra_component_id).toBe("ib");

    const concessionPayload = {
      eventType: "payoff_concession", eventOrigin: "interactive_user", effectiveDate: "2026-08-30",
      deltaCentsByComponentCents: { ib: -1_000, zi: 0 }, principalRemainingByComponentCents: { ib: 0, zi: 0 }, reason: "final forgiveness",
    };
    expect(buildAppendEventRpcParams(concessionPayload, { ownerId: "owner-1", accountId: "pf_acct_1" }).p_delta_cents_by_component_cents).toEqual({ ib: -1_000, zi: 0 });
  });

  it("defaults every unmapped field to null rather than undefined -- an explicit, complete RPC call every time", () => {
    const payload = { eventType: "account_closed", eventOrigin: "interactive_user", effectiveDate: "2026-08-30", closureReason: "paid_in_full" };
    const params = buildAppendEventRpcParams(payload, { ownerId: "owner-1", accountId: "pf_acct_1" });
    expect(params.p_amount_cents).toBeNull();
    expect(params.p_delta_cents).toBeNull();
    expect(params.p_closure_reason).toBe("paid_in_full");
    expect(params.p_internal_note).toBeNull();
    expect(params.p_selected_extra_component_id).toBeNull();
    expect(params.p_delta_cents_by_component_cents).toBeNull();
  });
});
