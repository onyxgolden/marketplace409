import { describe, expect, it } from "vitest";
import {
  canCorrectPayment,
  correctionTouchesMoney,
  validatePaymentCorrection,
  applyCorrectionDelta,
  computeCreditAwareCorrection,
  computeChargeMoveCorrection,
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
  it("is true when amount, date, method, or charge change", () => {
    expect(correctionTouchesMoney({ amountCents: 150000 })).toBe(true);
    expect(correctionTouchesMoney({ receivedAt: "2026-09-02" })).toBe(true);
    expect(correctionTouchesMoney({ paymentMethod: "cashiers_check" })).toBe(true);
    expect(correctionTouchesMoney({ chargeId: "rent_charge_2" })).toBe(true);
  });

  it("is false for notes-only, receipt-reference, deposit-state, deposit-amount, empty, or missing changes", () => {
    expect(correctionTouchesMoney({ notes: "new notes" })).toBe(false);
    expect(correctionTouchesMoney({ receiptReference: "MO-42" })).toBe(false);
    expect(correctionTouchesMoney({ depositState: "deposited" })).toBe(false);
    // Deposit amount moves no charge or credit balance by design.
    expect(correctionTouchesMoney({ depositAmountCents: 50000 })).toBe(false);
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

  it("accepts a deposit-state change on an offline payment without touching money", () => {
    const result = validatePaymentCorrection({ depositState: "deposited", reason: "bank run" }, offlinePayment());
    expect(result.valid).toBe(true);
    expect(result.value.changes.depositState).toBe("deposited");
    expect(correctionTouchesMoney(result.value.changes)).toBe(false);
  });

  it("rejects invalid deposit states and deposit-state changes on provider or refunded payments", () => {
    expect(validatePaymentCorrection({ depositState: "lost", reason: "x" }, offlinePayment()).valid).toBe(false);
    const stripe = offlinePayment({ provider: "stripe", payment_method: "ach" });
    expect(validatePaymentCorrection({ depositState: "deposited", reason: "x" }, stripe).valid).toBe(false);
    const refunded = offlinePayment({ refunded_amount_cents: 160000 });
    const result = validatePaymentCorrection({ depositState: "deposited", reason: "x" }, refunded);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/refund/i);
  });

  it("accepts a charge move on an offline payment as a money-touching change", () => {
    const result = validatePaymentCorrection({ chargeId: "rent_charge_2", reason: "wrong month" }, offlinePayment());
    expect(result.valid).toBe(true);
    expect(result.value.changes.chargeId).toBe("rent_charge_2");
    expect(correctionTouchesMoney(result.value.changes)).toBe(true);
  });

  it("rejects charge moves on provider or refunded payments and empty targets", () => {
    const stripe = offlinePayment({ provider: "stripe", payment_method: "ach" });
    expect(validatePaymentCorrection({ chargeId: "rent_charge_2", reason: "x" }, stripe).valid).toBe(false);
    const refunded = offlinePayment({ refunded_amount_cents: 160000 });
    const result = validatePaymentCorrection({ chargeId: "rent_charge_2", reason: "x" }, refunded);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/refund/i);
    expect(validatePaymentCorrection({ chargeId: "   ", reason: "x" }, offlinePayment()).valid).toBe(false);
  });

  it("accepts a deposit amount on an offline payment without touching money", () => {
    const result = validatePaymentCorrection({ depositAmountCents: 50000, reason: "part deposit" }, offlinePayment());
    expect(result.valid).toBe(true);
    expect(result.value.changes.depositAmountCents).toBe(50000);
    expect(correctionTouchesMoney(result.value.changes)).toBe(false);
    const zeroed = validatePaymentCorrection({ depositAmountCents: 0, reason: "not deposit" }, offlinePayment());
    expect(zeroed.valid).toBe(true);
    expect(zeroed.value.changes.depositAmountCents).toBe(0);
  });

  it("rejects negative deposit amounts and deposit amounts above the payment amount", () => {
    expect(validatePaymentCorrection({ depositAmountCents: -100, reason: "x" }, offlinePayment()).valid).toBe(false);
    const over = validatePaymentCorrection({ depositAmountCents: 160001, reason: "x" }, offlinePayment());
    expect(over.valid).toBe(false);
    expect(over.errors[0]).toMatch(/cannot exceed the payment amount/i);
  });

  it("rejects shrinking the amount below the recorded deposit amount", () => {
    const withDeposit = offlinePayment({ deposit_amount_cents: 50000 });
    const result = validatePaymentCorrection({ amountCents: 40000, reason: "x" }, withDeposit);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cannot exceed the payment amount/i);
    // Growing the deposit and the amount together stays consistent.
    const grown = validatePaymentCorrection(
      { amountCents: 200000, depositAmountCents: 60000, reason: "x" },
      withDeposit
    );
    expect(grown.valid).toBe(true);
  });

  it("blocks deposit amounts on provider or refunded payments", () => {
    const stripe = offlinePayment({ provider: "stripe", payment_method: "ach" });
    expect(validatePaymentCorrection({ depositAmountCents: 50000, reason: "x" }, stripe).valid).toBe(false);
    const refunded = offlinePayment({ refunded_amount_cents: 160000 });
    const result = validatePaymentCorrection({ depositAmountCents: 50000, reason: "x" }, refunded);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/refund/i);
  });
});

describe("computeChargeMoveCorrection", () => {
  const oldCharge = {
    id: "rent_charge_1", lease_id: "lease_1", amount_cents: 160000,
    paid_amount_cents: 160000, status: "paid", due_date: "2026-09-01",
  };
  const newCharge = {
    id: "rent_charge_2", lease_id: "lease_1", amount_cents: 160000,
    paid_amount_cents: 0, status: "due", due_date: "2026-10-01",
  };

  it("moves a payment cleanly: old charge unpaid, new charge paid", () => {
    const result = computeChargeMoveCorrection({
      oldCharge, newCharge, oldAmountCents: 160000, newAmountCents: 160000,
    });
    expect(result).toMatchObject({
      ok: true,
      oldAppliedCents: 160000,
      newAppliedCents: 160000,
      oldChargeNewPaidCents: 0,
      oldChargeNewStatus: "due",
      newChargeNewPaidCents: 160000,
      newChargeNewStatus: "paid",
      newExcessCents: 0,
      creditAction: "none",
      balanceDeltaCents: 0,
    });
  });

  it("leaves other contributions on the old charge untouched", () => {
    // $1,600 charge paid in full: $1,400 from this $1,500 payment ($100
    // excess became credit) plus $200 from another payment. Moving the
    // $1,500 payment to a $1,600 open charge unapplies only its $1,400.
    const result = computeChargeMoveCorrection({
      oldCharge, newCharge, oldAmountCents: 150000, newAmountCents: 150000,
      creditAmountCents: 10000,
    });
    expect(result).toMatchObject({
      ok: true,
      oldAppliedCents: 140000,
      oldChargeNewPaidCents: 20000,
      oldChargeNewStatus: "partially_paid",
      newChargeNewPaidCents: 150000,
      newChargeNewStatus: "partially_paid",
      newExcessCents: 0,
      creditAction: "void",
    });
  });

  it("grows the credit when the new charge is smaller than the payment", () => {
    const result = computeChargeMoveCorrection({
      oldCharge, newCharge: { ...newCharge, amount_cents: 150000 },
      oldAmountCents: 180000, newAmountCents: 180000, creditAmountCents: 20000,
    });
    expect(result).toMatchObject({
      ok: true,
      oldAppliedCents: 160000,
      newAppliedCents: 150000,
      newExcessCents: 30000,
      creditAction: "adjust",
      balanceDeltaCents: -10000,
    });
  });

  it("creates a credit when the move overpays the new charge", () => {
    const result = computeChargeMoveCorrection({
      oldCharge, newCharge: { ...newCharge, amount_cents: 100000 },
      oldAmountCents: 160000, newAmountCents: 160000,
    });
    expect(result).toMatchObject({
      ok: true,
      newAppliedCents: 100000,
      newExcessCents: 60000,
      creditAction: "create",
      balanceDeltaCents: -60000,
    });
  });

  it("voids the credit when the new charge absorbs the full payment", () => {
    const result = computeChargeMoveCorrection({
      oldCharge, newCharge: { ...newCharge, amount_cents: 200000 },
      oldAmountCents: 180000, newAmountCents: 180000, creditAmountCents: 20000,
    });
    expect(result).toMatchObject({
      ok: true,
      newAppliedCents: 180000,
      newExcessCents: 0,
      creditAction: "void",
      newChargeNewStatus: "partially_paid",
    });
  });

  it("marks a fully unpaid old charge scheduled when its due date is in the future", () => {
    const result = computeChargeMoveCorrection({
      oldCharge: { ...oldCharge, due_date: "2099-01-01" },
      newCharge, oldAmountCents: 160000, newAmountCents: 160000,
    });
    expect(result).toMatchObject({ ok: true, oldChargeNewStatus: "scheduled" });
  });

  it("blocks when partially applied credit cannot be covered by the new excess", () => {
    // $200 credit, $150 already applied; the new $1,700 charge leaves $100 excess.
    const result = computeChargeMoveCorrection({
      oldCharge, newCharge: { ...newCharge, amount_cents: 170000 },
      oldAmountCents: 180000, newAmountCents: 180000,
      creditAmountCents: 20000, appliedCreditCents: 15000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CREDIT_APPLICATIONS_APPLIED");
    expect(result.reason).toMatch(/already been applied/i);
  });

  it("refuses voided, paid, cross-lease, and missing charge targets", () => {
    const base = { oldCharge, newCharge, oldAmountCents: 160000, newAmountCents: 160000 };
    expect(computeChargeMoveCorrection({ ...base, oldCharge: { ...oldCharge, status: "void" } }).ok).toBe(false);
    expect(computeChargeMoveCorrection({ ...base, newCharge: { ...newCharge, status: "void" } }).ok).toBe(false);
    expect(computeChargeMoveCorrection({ ...base, newCharge: { ...newCharge, status: "paid" } }).ok).toBe(false);
    expect(computeChargeMoveCorrection({ ...base, newCharge: { ...newCharge, lease_id: "lease_2" } }).ok).toBe(false);
    expect(computeChargeMoveCorrection({ ...base, oldCharge: null }).ok).toBe(false);
    expect(computeChargeMoveCorrection({ ...base, newCharge: null }).ok).toBe(false);
    expect(computeChargeMoveCorrection({ ...base, newAmountCents: 0 }).ok).toBe(false);
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

describe("computeCreditAwareCorrection", () => {
  // Reviewer's example: $1,600 charge, $1,700 offline payment => charge paid
  // $1,600 + $100 untouched tenant credit. Correct payment to $1,650:
  // charge stays $1,600 paid, credit adjusts to $50.
  it("re-splits a reduced payment between a full charge and untouched credit", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 165000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      appliedOldCents: 160000,
      appliedNewCents: 160000,
      newPaidCents: 160000,
      newStatus: "paid",
      oldExcessCents: 10000,
      newExcessCents: 5000,
      newCreditRemainingCents: 5000,
      creditAction: "adjust",
      balanceDeltaCents: 0,
    });
  });

  it("voids untouched credit when the corrected amount removes the excess", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 150000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      appliedNewCents: 150000,
      newPaidCents: 150000,
      newStatus: "partially_paid",
      newExcessCents: 0,
      creditAction: "void",
      balanceDeltaCents: -10000,
    });
  });

  it("grows untouched credit when the corrected amount increases", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 180000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      appliedNewCents: 160000,
      newPaidCents: 160000,
      newExcessCents: 20000,
      newCreditRemainingCents: 20000,
      creditAction: "adjust",
      balanceDeltaCents: 0,
    });
  });

  it("creates a credit when a correction pushes a payment over the charge", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 150000,
      newAmountCents: 170000,
      chargePaidCents: 150000,
      chargeAmountCents: 160000,
      chargeStatus: "partially_paid",
      creditAmountCents: 0,
      appliedCreditCents: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      appliedOldCents: 150000,
      appliedNewCents: 160000,
      newPaidCents: 160000,
      newStatus: "paid",
      newExcessCents: 10000,
      creditAction: "create",
      balanceDeltaCents: 10000,
    });
  });

  it("keeps the legacy no-credit math for payments that sourced no credit", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 160000,
      newAmountCents: 150000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 0,
      appliedCreditCents: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      newPaidCents: 150000,
      newStatus: "partially_paid",
      creditAction: "none",
      balanceDeltaCents: -10000,
    });
  });

  it("adjusts a partially applied credit when the new excess still covers the applications", () => {
    // $100 credit, $30 already applied to a later charge; correct $1,700 -> $1,680.
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 168000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 3000,
    });
    expect(result).toMatchObject({
      ok: true,
      newExcessCents: 8000,
      newCreditRemainingCents: 5000,
      creditAction: "adjust",
      newPaidCents: 160000,
    });
  });

  it("blocks when partially applied credit cannot be covered by the new excess", () => {
    // $100 credit, $60 already applied; correct $1,700 -> $1,630 leaves $30 excess.
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 163000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 6000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CREDIT_APPLICATIONS_APPLIED");
    expect(result.reason).toMatch(/already been applied/i);
  });

  it("blocks when fully applied credit cannot be covered by the new excess", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 165000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 10000,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CREDIT_APPLICATIONS_APPLIED");
  });

  it("adjusts a fully applied credit when the correction grows the excess", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 175000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 10000,
    });
    expect(result).toMatchObject({
      ok: true,
      newExcessCents: 15000,
      newCreditRemainingCents: 5000,
      creditAction: "adjust",
    });
  });

  it("accounts for other contributions to the charge when recomputing capacity", () => {
    // $1,600 charge paid in full: $1,400 applied from the corrected $1,500
    // payment ($100 excess became credit) plus $200 from another payment.
    // Correcting $1,500 -> $1,450 must leave the other $200 untouched.
    const result = computeCreditAwareCorrection({
      oldAmountCents: 150000,
      newAmountCents: 145000,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
      creditAmountCents: 10000,
      appliedCreditCents: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      appliedOldCents: 140000,
      appliedNewCents: 140000,
      newPaidCents: 160000,
      newStatus: "paid",
      newExcessCents: 5000,
      creditAction: "adjust",
      balanceDeltaCents: 0,
    });
  });

  it("rejects a non-positive corrected amount", () => {
    const result = computeCreditAwareCorrection({
      oldAmountCents: 170000,
      newAmountCents: 0,
      chargePaidCents: 160000,
      chargeAmountCents: 160000,
      chargeStatus: "paid",
    });
    expect(result.ok).toBe(false);
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

  it("labels deposit-state and charge changes for the history view", () => {
    const row = {
      id: "corr_2",
      payment_id: "rental_payment_1",
      corrected_at: "2026-10-02T00:00:00Z",
      corrected_by: "user_1",
      reason: "wrong month",
      changes: {
        deposit_state: { from: "received", to: "deposited" },
        charge_id: { from: "rent_charge_1", to: "rent_charge_2" },
      },
      balance_delta_cents: 0,
      reconciled_warning: false,
    };
    expect(serializePaymentCorrection(row)).toMatchObject({
      changes: [
        { field: "deposit_state", label: "Deposit state", from: "received", to: "deposited" },
        { field: "charge_id", label: "Applies to charge", from: "rent_charge_1", to: "rent_charge_2" },
      ],
    });
  });
});
