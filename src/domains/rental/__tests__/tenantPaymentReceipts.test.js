import { describe, expect, it } from "vitest";
import {
  buildTenantReceiptDeliveryId,
  buildTenantReceiptEmail,
  buildTenantReceiptProviderIdempotencyKey,
} from "../tenantPaymentReceipts";

describe("buildTenantReceiptDeliveryId", () => {
  it("is deterministic per owner and payment", () => {
    const a = buildTenantReceiptDeliveryId({ ownerId: "owner_1", paymentId: "rental_payment_1" });
    const b = buildTenantReceiptDeliveryId({ ownerId: "owner_1", paymentId: "rental_payment_1" });
    expect(a).toBe(b);
    expect(a).toContain("rental_payment_1");
  });

  it("differs across payments — no cross-payment dedup collisions", () => {
    const a = buildTenantReceiptDeliveryId({ ownerId: "owner_1", paymentId: "rental_payment_1" });
    const b = buildTenantReceiptDeliveryId({ ownerId: "owner_1", paymentId: "rental_payment_2" });
    expect(a).not.toBe(b);
  });

  it("throws when owner or payment is missing", () => {
    expect(() => buildTenantReceiptDeliveryId({ ownerId: "owner_1" })).toThrow();
    expect(() => buildTenantReceiptDeliveryId({ paymentId: "rental_payment_1" })).toThrow();
  });
});

describe("buildTenantReceiptProviderIdempotencyKey", () => {
  it("is deterministic per delivery id", () => {
    const a = buildTenantReceiptProviderIdempotencyKey("rtr_owner_1_rental_payment_1");
    const b = buildTenantReceiptProviderIdempotencyKey("rtr_owner_1_rental_payment_1");
    expect(a).toBe(b);
    expect(a).toContain("rtr_owner_1_rental_payment_1");
  });

  it("throws when the delivery id is missing", () => {
    expect(() => buildTenantReceiptProviderIdempotencyKey()).toThrow();
  });
});

describe("buildTenantReceiptEmail", () => {
  const facts = {
    tenantName: "Eric Carrillo",
    amountCents: 160000,
    propertyLabel: "308 Paula",
    occurredAt: "2026-09-26T23:54:00Z",
    transactionRef: "pi_fixture",
  };

  it("carries amount, date, property, and transaction reference", () => {
    const email = buildTenantReceiptEmail(facts);
    expect(email.subject).toContain("$1600.00");
    expect(email.subject).toContain("308 Paula");
    expect(email.bodyText).toContain("$1600.00");
    expect(email.bodyText).toContain("308 Paula");
    expect(email.bodyText).toContain("September 26, 2026");
    expect(email.bodyText).toContain("pi_fixture");
    expect(email.bodyText).toContain("Eric Carrillo");
  });

  it("omits property clauses when no property label is available", () => {
    const { propertyLabel, ...withoutProperty } = facts;
    const email = buildTenantReceiptEmail(withoutProperty);
    expect(email.subject).not.toContain(" — ");
    expect(email.bodyText).not.toContain("undefined");
  });

  it("omits the reference line when no transaction reference is available", () => {
    const { transactionRef, ...withoutRef } = facts;
    const email = buildTenantReceiptEmail(withoutRef);
    expect(email.bodyText).not.toContain("Transaction reference");
  });

  it("throws on a non-positive amount", () => {
    expect(() => buildTenantReceiptEmail({ ...facts, amountCents: 0 })).toThrow();
    expect(() => buildTenantReceiptEmail({ ...facts, amountCents: -5 })).toThrow();
    expect(() => buildTenantReceiptEmail({ ...facts, amountCents: 10.5 })).toThrow();
  });

  it("falls back to a neutral greeting when the tenant name is missing", () => {
    const email = buildTenantReceiptEmail({ ...facts, tenantName: null });
    expect(email.bodyText).toContain("Hi there,");
  });
});
