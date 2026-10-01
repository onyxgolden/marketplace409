import { describe, expect, it } from "vitest";
import { canUnvoidBill, isProbableReplacementBill, serializeVoidAudit } from "./vendorBills";

// R18 (rentec-parity): un-void vendor bills.

function voidedBill(overrides = {}) {
  return {
    id: "rental_vendor_bill_1",
    vendor_id: "rental_vendor_1",
    property_id: "prop_1",
    bill_date: "2026-09-15",
    due_date: "2026-10-15",
    amount_cents: 25000,
    paid_amount_cents: 0,
    status: "voided",
    void_reason: "duplicate entry",
    voided_at: "2026-09-20",
    created_at: "2026-09-15T00:00:00Z",
    updated_at: null,
    ...overrides,
  };
}

function replacement(overrides = {}) {
  return voidedBill({
    id: "rental_vendor_bill_2",
    status: "open",
    void_reason: null,
    voided_at: null,
    created_at: "2026-09-25T00:00:00Z",
    ...overrides,
  });
}

describe("canUnvoidBill", () => {
  it("allows un-voiding an untouched voided bill", () => {
    expect(canUnvoidBill(voidedBill())).toBe(true);
  });

  it("refuses open, partial, and paid bills", () => {
    for (const status of ["open", "partial", "paid"]) {
      expect(canUnvoidBill(voidedBill({ status }))).toBe(false);
    }
  });

  it("refuses a voided bill that has applied payments", () => {
    expect(canUnvoidBill(voidedBill({ paid_amount_cents: 5000 }))).toBe(false);
  });
});

describe("isProbableReplacementBill", () => {
  it("flags a later-entered bill for the same vendor + property + date + amount", () => {
    expect(isProbableReplacementBill(replacement(), voidedBill())).toBe(true);
  });

  it("rejects voided candidates", () => {
    expect(isProbableReplacementBill(replacement({ status: "voided" }), voidedBill())).toBe(false);
  });

  it("rejects a different amount", () => {
    expect(isProbableReplacementBill(replacement({ amount_cents: 26000 }), voidedBill())).toBe(false);
  });

  it("rejects a different bill date", () => {
    expect(isProbableReplacementBill(replacement({ bill_date: "2026-09-16" }), voidedBill())).toBe(false);
  });

  it("rejects other vendors and other properties", () => {
    expect(isProbableReplacementBill(replacement({ vendor_id: "other" }), voidedBill())).toBe(false);
    expect(isProbableReplacementBill(replacement({ property_id: "other" }), voidedBill())).toBe(false);
  });

  it("rejects candidates entered before or at the same time", () => {
    expect(isProbableReplacementBill(replacement({ created_at: "2026-09-15T00:00:00Z" }), voidedBill())).toBe(false);
    expect(isProbableReplacementBill(replacement({ created_at: null }), voidedBill({ created_at: null }))).toBe(false);
  });

  it("rejects comparing a bill with itself", () => {
    expect(isProbableReplacementBill(voidedBill(), voidedBill())).toBe(false);
  });
});

describe("serializeVoidAudit", () => {
  it("serializes audit rows with plain-English action labels", () => {
    expect(
      serializeVoidAudit({ id: "a1", entity_type: "vendor_bill", entity_id: "b1", action: "unvoid", reason: "oops", actor_id: "u1", created_at: "2026-09-21" })
    ).toMatchObject({
      id: "a1",
      entityType: "vendor_bill",
      action: "unvoid",
      actionLabel: "Un-voided",
      reason: "oops",
      actorId: "u1",
    });
    expect(
      serializeVoidAudit({ id: "a2", entity_type: "vendor_payment", entity_id: "p1", action: "reissue", reason: "lost", created_at: "2026-09-22" }).actionLabel
    ).toBe("Re-issued");
  });
});
