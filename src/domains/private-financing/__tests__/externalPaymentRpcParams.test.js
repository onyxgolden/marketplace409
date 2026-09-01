import { describe, expect, it } from "vitest";
import {
  EXTERNAL_PAYMENT_METHOD,
  buildExternalPaymentRpcParams,
} from "../externalPaymentRpcParams.js";

function preview(overrides = {}) {
  return {
    eventType: "payment_posted",
    eventOrigin: "manual_external",
    effectiveDate: "2026-08-30",
    amountCents: 51_785,
    allocation: {
      interestPaidByComponentCents: { primary: 10_000 },
      principalPaidByComponentCents: { primary: 33_452, down_payment: 8_333 },
      unallocatedCents: 0,
    },
    principalRemainingByComponentCents: { primary: 2_000_000, down_payment: 500_000 },
    selectedExtraComponentId: null,
    reason: "Seller confirmed receipt",
    borrowerVisibleExplanation: "Payment received through Venmo.",
    ...overrides,
  };
}

describe("buildExternalPaymentRpcParams", () => {
  it("maps a seller-confirmed payment with complete provenance", () => {
    expect(
      buildExternalPaymentRpcParams(preview(), {
        ownerId: "owner-1",
        accountId: "account-1",
        paymentMethod: EXTERNAL_PAYMENT_METHOD.VENMO,
        sourceReference: " venmo-ABC-123 ",
        externalEvidenceReference: " private://receipt/123 ",
        internalNote: " confirmed in app ",
      }),
    ).toMatchObject({
      p_owner_id: "owner-1",
      p_account_id: "account-1",
      p_event_type: "payment_posted",
      p_event_origin: "manual_external",
      p_effective_date: "2026-08-30",
      p_source_reference: "venmo-ABC-123",
      p_idempotency_key: "manual_external:venmo:venmo-ABC-123",
      p_amount_cents: 51_785,
      p_payment_method: "venmo",
      p_external_evidence_reference: "private://receipt/123",
      p_internal_note: "confirmed in app",
      p_interest_paid_by_component_cents: { primary: 10_000 },
      p_principal_paid_by_component_cents: { primary: 33_452, down_payment: 8_333 },
      p_unallocated_cents: 0,
    });
  });

  it.each(Object.values(EXTERNAL_PAYMENT_METHOD))("accepts supported method %s", (paymentMethod) => {
    expect(
      buildExternalPaymentRpcParams(preview(), {
        ownerId: "owner-1",
        accountId: "account-1",
        paymentMethod,
        sourceReference: "reference-1",
      }).p_payment_method,
    ).toBe(paymentMethod);
  });

  it("keeps optional private fields null instead of inventing values", () => {
    const result = buildExternalPaymentRpcParams(preview(), {
      ownerId: "owner-1",
      accountId: "account-1",
      paymentMethod: "cash",
      sourceReference: "cash-receipt-1",
    });
    expect(result.p_external_evidence_reference).toBeNull();
    expect(result.p_internal_note).toBeNull();
  });

  it.each([
    [{ ...preview(), eventType: "principal_correction" }, "External-payment posting"],
    [{ ...preview(), eventOrigin: "interactive_user" }, "External-payment posting"],
  ])("rejects a payload that is not manual_external payment_posted", (payload, message) => {
    expect(() =>
      buildExternalPaymentRpcParams(payload, {
        ownerId: "owner-1",
        accountId: "account-1",
        paymentMethod: "cash",
        sourceReference: "reference-1",
      }),
    ).toThrow(message);
  });

  it("rejects unsupported methods", () => {
    expect(() =>
      buildExternalPaymentRpcParams(preview(), {
        ownerId: "owner-1",
        accountId: "account-1",
        paymentMethod: "bitcoin",
        sourceReference: "reference-1",
      }),
    ).toThrow("paymentMethod must be one of");
  });

  it.each([
    ["ownerId", { ownerId: "", accountId: "account-1", paymentMethod: "cash", sourceReference: "reference-1" }],
    ["accountId", { ownerId: "owner-1", accountId: "", paymentMethod: "cash", sourceReference: "reference-1" }],
    ["sourceReference", { ownerId: "owner-1", accountId: "account-1", paymentMethod: "cash", sourceReference: "" }],
  ])("rejects a missing %s", (_name, options) => {
    expect(() => buildExternalPaymentRpcParams(preview(), options)).toThrow("must be a non-empty string");
  });

  it("makes idempotency account-local, method-specific, and source-derived", () => {
    const result = buildExternalPaymentRpcParams(preview(), {
      ownerId: "owner-1",
      accountId: "account-1",
      paymentMethod: "cash_app",
      sourceReference: "transfer-777",
    });
    expect(result.p_idempotency_key).toBe("manual_external:cash_app:transfer-777");
  });

  it("never sends created_by because the RPC forces auth.uid()", () => {
    const result = buildExternalPaymentRpcParams(preview(), {
      ownerId: "owner-1",
      accountId: "account-1",
      paymentMethod: "check",
      sourceReference: "check-1001",
    });
    expect(result).not.toHaveProperty("p_created_by");
  });
});
