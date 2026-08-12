import { describe, expect, it } from "vitest";
import { createRentalPayment } from "../rental-payment.types";
import { createRentalSettlement } from "../../rental-settlement";
import { createPaymentWebhookEvent } from "../../payment-webhook";
import { createACHAuthorization } from "../../ach-authorization";
const payment = (overrides = {}) => ({ id: "payment_1", chargeId: "charge_1", leaseId: "lease_1", tenantId: "tenant_1",
  provider: "stripe", providerCustomerId: null, providerPaymentId: null, amountCents: 125000, refundedAmountCents: 0,
  currencyCode: "USD", status: "processing" as const, idempotencyKey: "rent-payment:charge_1:attempt_1",
  failureCode: null, failureMessage: null, createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z", succeededAt: null, ...overrides });
describe("rental payment foundation", () => {
  it("keeps processing separate from succeeded", () => {
    expect(createRentalPayment(payment()).status).toBe("processing");
    expect(() => createRentalPayment(payment({ status: "succeeded" }))).toThrow("succeededAt");
  });
  it("requires settlement math to reconcile", () => {
    expect(() => createRentalSettlement({ id: "settlement_1", paymentId: "payment_1", provider: "stripe",
      providerBalanceTransactionId: null, providerPayoutId: null, grossAmountCents: 125000, feeAmountCents: 500,
      netAmountCents: 125000, currencyCode: "USD", status: "pending", availableAt: null, paidOutAt: null,
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" })).toThrow("gross amount minus fees");
  });
  it("requires processed webhook evidence", () => {
    expect(() => createPaymentWebhookEvent({ id: "webhook_1", provider: "stripe", providerEventId: "evt_1",
      eventType: "payment_intent.succeeded", objectId: "pi_1", status: "processed", receivedAt: "2026-09-01T00:00:00.000Z",
      processedAt: null, failureMessage: null, payloadHash: "sha256:abc" })).toThrow("processedAt");
  });
  it("retains revocation evidence for ACH authorization", () => {
    expect(() => createACHAuthorization({ id: "ach_1", tenantId: "tenant_1", leaseId: "lease_1", provider: "stripe",
      providerCustomerId: "cus_1", providerPaymentMethodId: "pm_1", mandateReference: "mandate_1",
      authorizationTextVersion: "2026-08-12", authorizedAt: "2026-09-01T00:00:00.000Z", revokedAt: null,
      status: "revoked", ipAddress: null, userAgent: null, createdAt: "2026-09-01T00:00:00.000Z" })).toThrow("revokedAt");
  });
});
