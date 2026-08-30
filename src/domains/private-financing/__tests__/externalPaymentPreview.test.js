import { beforeEach, describe, expect, it, vi } from "vitest";

const { previewExternalManualPayment } = vi.hoisted(() => ({
  previewExternalManualPayment: vi.fn(),
}));

vi.mock("../adjustmentPreview.js", () => ({ previewExternalManualPayment }));

import { previewSellerConfirmedExternalPayment } from "../externalPaymentPreview.js";

const baseArgs = (overrides = {}) => ({
  events: [],
  componentVersions: [],
  accountTermsVersions: [],
  asOfDate: "2026-08-30",
  amountCents: 51_785,
  paymentMethod: "venmo",
  sourceReference: "VENMO-123",
  reason: "Seller confirmed receipt",
  borrowerVisibleExplanation: "Your payment was received.",
  ...overrides,
});

describe("previewSellerConfirmedExternalPayment", () => {
  beforeEach(() => {
    previewExternalManualPayment.mockReset();
    previewExternalManualPayment.mockReturnValue({
      proposedAdjustment: { kind: "external_manual_payment", amountCents: 51_785 },
      proposedEventPayload: {
        eventType: "payment_posted",
        eventOrigin: "manual_import",
        effectiveDate: "2026-08-30",
        amountCents: 51_785,
        allocation: {
          interestPaidByComponentCents: { primary: 10_000 },
          principalPaidByComponentCents: { primary: 41_785 },
          unallocatedCents: 0,
        },
      },
      warnings: [],
      blockingValidation: [],
    });
  });

  it("forces manual_external and deterministic idempotency into the shared preview", () => {
    previewSellerConfirmedExternalPayment(baseArgs());
    expect(previewExternalManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        eventOrigin: "manual_external",
        idempotencyKey: "manual_external:venmo:VENMO-123",
        amountCents: 51_785,
      }),
    );
  });

  it("binds normalized provenance and borrower explanation into the proposed event", () => {
    const result = previewSellerConfirmedExternalPayment(
      baseArgs({ sourceReference: " transfer-77 ", borrowerVisibleExplanation: " Payment received. " }),
    );
    expect(result.proposedEventPayload).toMatchObject({
      eventType: "payment_posted",
      eventOrigin: "manual_external",
      paymentMethod: "venmo",
      sourceReference: "transfer-77",
      borrowerVisibleExplanation: "Payment received.",
    });
    expect(result.proposedAdjustment).toMatchObject({
      kind: "seller_confirmed_external_payment",
      paymentMethod: "venmo",
      sourceReference: "transfer-77",
    });
  });

  it("preserves blockers without inventing a postable payload", () => {
    previewExternalManualPayment.mockReturnValue({
      proposedAdjustment: { kind: "external_manual_payment" },
      proposedEventPayload: null,
      warnings: ["Overpayment"],
      blockingValidation: ["Acknowledge overpayment"],
    });
    const result = previewSellerConfirmedExternalPayment(baseArgs());
    expect(result.proposedEventPayload).toBeNull();
    expect(result.blockingValidation).toEqual(["Acknowledge overpayment"]);
  });

  it.each(["venmo", "cash_app", "zelle", "paypal", "bank_transfer", "cash", "check", "money_order", "other"])(
    "accepts supported method %s",
    (paymentMethod) => {
      expect(() => previewSellerConfirmedExternalPayment(baseArgs({ paymentMethod }))).not.toThrow();
    },
  );

  it("rejects unsupported methods before allocation", () => {
    expect(() => previewSellerConfirmedExternalPayment(baseArgs({ paymentMethod: "crypto" }))).toThrow(
      "paymentMethod must be one of",
    );
    expect(previewExternalManualPayment).not.toHaveBeenCalled();
  });

  it("requires a source reference and reason", () => {
    expect(() => previewSellerConfirmedExternalPayment(baseArgs({ sourceReference: " " }))).toThrow(
      "sourceReference must be a non-empty string",
    );
    expect(() => previewSellerConfirmedExternalPayment(baseArgs({ reason: "" }))).toThrow(
      "reason must be a non-empty string",
    );
  });

  it("threads selected-component and overpayment choices unchanged", () => {
    previewSellerConfirmedExternalPayment(
      baseArgs({ selectedExtraComponentId: "second", acknowledgeOverpayment: true }),
    );
    expect(previewExternalManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ selectedExtraComponentId: "second", acknowledgeOverpayment: true }),
    );
  });

  it("does not expose an empty borrower explanation", () => {
    const result = previewSellerConfirmedExternalPayment(baseArgs({ borrowerVisibleExplanation: " " }));
    expect(result.proposedEventPayload.borrowerVisibleExplanation).toBeNull();
  });
});
