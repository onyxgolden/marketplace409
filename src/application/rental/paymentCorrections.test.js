import { describe, expect, it } from "vitest";
import {
  canCorrectPayment,
  correctionTouchesMoney,
  validatePaymentCorrection,
  applyCorrectionDelta,
  serializePaymentCorrection,
} from "./paymentCorrections";

// R18 (rentec-parity): correct a recorded tenant payment.

function offlinePayment(overrides = {}) {
  return {
    id: "rental_payment_1",
    tenant_id: "tenant_1",
    rent_charge_id: "rent_charge_1",
    amount_cents: 160000,
    received_at: "2026-09-01",
    payment_method: "cash",
    provider: "offline",
    status: "succeeded",
    notes: "September rent",
    receipt_reference: null,
    refunded_amount_cents: 0,
    ...overrides,
  };
}

describe("canCorrectPayment", () => {
  it("allows correcting a completed payment", () => {
    expect(canCorrectPayment(offlinePayment())).toEqual({ ok: true, reason: null });
  });

  it("blocks non-completed payments", () => {
    for (const status of ["failed", "pending", "cancelled"]) {
      const result = canCorrectPayment(offlinePayment({ status }));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/completed/i);
    }
  });

  it("blocks a missing payment", () => {
    expect(canCorrectPayment(null).ok).toBe(false);
  });
});

describe("correctionTouchesMoney", () => {
  it("is true when amount, date, or method change", () => {
    expect(correctionTouchesMoney({ amountCents: 150000 })).toBe(true);
    expect(correctionTouchesMoney({ receivedAt: "2026-09-02" })).toBe(true);
    expect(correctionTouchesMoney({ paymentMethod: "cashiers_check" })).toBe(true);
  });

  it("is false for notes-only, receipt-reference, empty, or missing changes", () => {
    expect(correctionTouchesMoney({ notes: "new notes" })).toBe(false);
    expect(correctionTouchesMoney({ receiptReference: "MO-42" })).toBe(false);
    expect(correctionTouchesMoney({})).toBe(false);
    expect(correctionTouchesMoney(null)).toBe(false);
  });
});

describe("validatePaymentCorrection", () => {
  it("requires a reason", () => {
    const result = validatePaymentCorrection({ notes: "x" }, offlinePayment());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/reason/i);
  });

  it("requires at least one change", () => {
    const result = validatePaymentCorrection({ reason: "looked fine" }, offlinePayment());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/at least one field/i);
  });

  it("accepts an amount change on an offline payment", () => {
    const result = validatePaymentCorrection({ amountCents: 150000, reason: "overpaid" }, offlinePayment());
    expect(result.valid).toBe(true);
    expect(result.value.changes.amountCents).toBe(150000);
    expect(correctionTouchesMoney(result.value.changes)).toBe(true);
  });

  it("rejects zero or negative amounts", () => {
    for (const amountCents of [0, -100]) {
      const result = validatePaymentCorrection({ amountCents, reason: "bad" }, offlinePayment());
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/positive/i);
    }
  });

  it("blocks amount changes on provider-settled payments", () => {
    const stripe = offlinePayment({ provider: "stripe", payment_method: "ach" });
    const result = validatePaymentCorrection({ amountCents: 150000, reason: "overpaid" }, stripe);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/provider-settled/i);
  });

  it("blocks date and method changes on provider-settled payments", () => {
    const stripe = offlinePayment({ provider: "stripe", payment_method: "ach" });
    expect(validatePaymentCorrection({ receivedAt: "2026-09-02", reason: "x" }, stripe).valid).toBe(false);
    expect(validatePaymentCorrection({ paymentMethod: "cash", reason: "x" }, stripe).valid).toBe(false);
  });

  it("allows notes and receipt reference on provider-settled payments", () => {
    const stripe = offlinePayment({ provider: "stripe", payment_method: "ach" });
    const result = validatePaymentCorrection(
      { notes: "typo fix", receiptReference: "CHK-9", reason: "fix" },
      stripe
    );
    expect(result.valid).toBe(true);
    expect(result.value.changes).toEqual({ notes: "typo fix", receiptReference: "CHK-9" });
    expect(correctionTouchesMoney(result.value.changes)).toBe(false);
  });

  it("blocks amount changes on refunded payments", () => {
    const refunded = offlinePayment({ refunded_amount_cents: 160000 });
    const result = validatePaymentCorrection({ amountCents: 150000, reason: "nope" }, refunded);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/refund/i);
  });

  it("rejects invalid received dates and future dates", () => {
    expect(validatePaymentCorrection({ receivedAt: "not-a-date", reason: "x" }, offlinePayment()).valid).toBe(false);
    expect(validatePaymentCorrection({ receivedAt: "2099-01-01", reason: "x" }, offlinePayment()).valid).toBe(false);
  });

  it("rejects non-offline payment methods", () => {
    const result = validatePaymentCorrection({ paymentMethod: "bitcoin", reason: "x" }, offlinePayment());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cash or cashier's check/i);
  });
});

describe("applyCorrectionDelta", () => {
  it("reduces paid cents when the corrected amount is smaller", () => {
    const charge = { id: "rent_charge_1", amount_cents: 160000, paid_amount_cents: 160000, status: "paid" };
    const result = applyCorrectionDelta(charge, -10000);
    expect(result).toMatchObject({ ok: true, newPaidCents: 150000, newStatus: "partially_paid" });
  });

  it("increases paid cents when the corrected amount is larger", () => {
    const charge = { id: "rent_charge_1", amount_cents: 160000, paid_amount_cents: 120000, status: "partially_paid" };
    const result = applyCorrectionDelta(charge, 40000);
    expect(result).toMatchObject({ ok: true, newPaidCents: 160000, newStatus: "paid" });
  });

  it("rejects a delta that would unpay the charge below zero", () => {
    const charge = { id: "rent_charge_1", amount_cents: 160000, paid_amount_cents: 5000, status: "partially_paid" };
    const result = applyCorrectionDelta(charge, -6000);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/below zero/i);
  });

  it("rejects a delta that would overpay the charge", () => {
    const charge = { id: "rent_charge_1", amount_cents: 160000, paid_amount_cents: 160000, status: "paid" };
    expect(applyCorrectionDelta(charge, 100).ok).toBe(false);
  });

  it("rejects voided charges", () => {
    const charge = { id: "rent_charge_1", amount_cents: 160000, paid_amount_cents: 0, status: "void" };
    const result = applyCorrectionDelta(charge, 1000);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/voided/i);
  });
});

describe("serializePaymentCorrection", () => {
  it("serializes column-keyed before → after changes with labels", () => {
    const row = {
      id: "corr_1",
      payment_id: "rental_payment_1",
      corrected_at: "2026-10-01T00:00:00Z",
      corrected_by: "user_1",
      reason: "overpaid",
      changes: {
        amount_cents: { from: 160000, to: 150000 },
        notes: { from: "a", to: "b" },
      },
      balance_delta_cents: -10000,
      reconciled_warning: false,
    };
    expect(serializePaymentCorrection(row)).toMatchObject({
      id: "corr_1",
      paymentId: "rental_payment_1",
      correctedBy: "user_1",
      reason: "overpaid",
      balanceDeltaCents: -10000,
      reconciledWarning: false,
      changes: [
        { field: "amount_cents", label: "Amount", from: 160000, to: 150000 },
        { field: "notes", label: "Notes", from: "a", to: "b" },
      ],
    });
  });
});
