// R18 (rentec-parity): tenant payment correction — pure domain rules.
//
// A recorded tenant payment can be corrected (wrong amount, wrong date,
// wrong payment method, wrong memo) WITHOUT deleting it. The correction is
// audit-trailed: the payment row keeps the corrected values (every read
// model — tenant ledger, statements, receipts — reads rental_payments), and
// the originals are preserved per-field in rental_payment_corrections with
// before/after, a required reason, and the actor.
//
// Financial guardrails (mirrored by the correct_rental_payment RPC, which is
// the write path — these pure helpers are the test surface):
//   - Only completed ('succeeded') payments are correctable.
//   - Amount/date/method corrections are allowed ONLY on offline
//     (manually recorded: cash / cashiers_check / check) payments. A provider
//     payment moved real money — its amount/date/method would lie about
//     what settled; notes and receipt reference stay correctable.
//   - Corrected amounts must be positive — never zero or negative.
//   - A payment with any refunded amount cannot have its amount corrected
//     (refund math is anchored to the original amount).
//   - Money-touching corrections on a reconciled payment are blocked by the
//     RPC ("undo the bank reconciliation first", mirroring R4's void guard);
//     notes/receipt-reference corrections go through flagged as a warning.
//   - Deposit state is NOT a money fact (it moves no balance), so it stays
//     correctable on a reconciled payment like notes; the standalone
//     deposit-state toggle remains the path for provider payments.
//   - Deposit amount (2026-10-31): no deposit-amount field existed on the
//     payment row and no payment↔deposit-record link exists — deposit money
//     lives in the separate security-deposit ledger, which the codebase
//     deliberately never mixes into rent payments. The correction path
//     therefore carries deposit_amount_cents on the payment row itself: the
//     portion of this payment's amount that is security-deposit money
//     (default 0). It is an allocation note, NOT a third money bucket:
//     charge paid and overpayment credit derive from amount_cents only, so
//     a deposit-amount change moves no balance and can never strand one —
//     but the invariant 0 <= deposit <= payment amount is enforced on both
//     sides (amount shrink or deposit growth), refused, never clamped.
//     A carved-out alternative (rent-applicable = amount − deposit) would
//     be a NEW money model and was NOT built here.
//   - Moving a payment to another charge on the same lease IS money-touching
//     (balances move on both charges, credit re-derived) and follows the
//     same offline-only / unrefunded / reconciled gates as an amount change.
//     Same-lease and payable-target checks live in the RPC (the validator
//     has no charge data); the pure computeChargeMoveCorrection() below
//     mirrors the RPC's move math for tests.
//
// Permission mapping: corrections are owner/co-owner only on the API.
// (R17's granular key for this sensitivity is payments.void_refund —
//  bookkeepers record payments but never void/refund them; a correction is
//  in the same trust class. The API gates on getActiveWorkspaceRole today
//  and documents the R17 key so the rewire is one line.)

export const PAYMENT_CORRECTION_MONEY_FIELDS = Object.freeze([
  "amountCents",
  "receivedAt",
  "paymentMethod",
  "chargeId",
]);

export const PAYMENT_CORRECTION_NOTE_FIELDS = Object.freeze([
  "receiptReference",
  "notes",
]);

// Deposit state is neither money nor a note: it moves no balance, but it is
// a landlord-controlled fact (received vs deposited) that belongs in the
// same audit trail. It is validated alongside the money fields (offline
// only) without counting as money-touching for the reconciliation guard.
export const PAYMENT_CORRECTION_DEPOSIT_FIELD = "depositState";

export const PAYMENT_CORRECTION_FIELDS = Object.freeze([
  ...PAYMENT_CORRECTION_MONEY_FIELDS,
  PAYMENT_CORRECTION_DEPOSIT_FIELD,
  // Deposit amount: money-adjacent (offline-only, refunded-excluded) but
  // NOT money-touching — it moves no charge or credit balance.
  "depositAmountCents",
  ...PAYMENT_CORRECTION_NOTE_FIELDS,
]);

export const OFFLINE_PAYMENT_METHODS = Object.freeze(["cash", "cashiers_check", "check"]);

// Column names on rental_payments for each correction field — the audit row
// stores before/after against these columns.
export const CORRECTION_FIELD_COLUMNS = Object.freeze({
  amountCents: "amount_cents",
  receivedAt: "received_at",
  paymentMethod: "payment_method",
  depositState: "deposit_state",
  depositAmountCents: "deposit_amount_cents",
  chargeId: "charge_id",
  receiptReference: "receipt_reference",
  notes: "notes",
});

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const toPositiveInt = (value) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
};

// Deposit amounts may be zero (no deposit portion) but never negative.
const toNonNegativeInt = (value) => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
};

const isValidDateString = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) &&
  !Number.isNaN(new Date(`${value.trim()}T00:00:00Z`).getTime());

function isFutureDate(value) {
  const when = new Date(`${value}T00:00:00Z`).getTime();
  return when > Date.now() + 5 * 60 * 1000;
}

/**
 * Eligibility: can this payment row be corrected at all?
 * payment: rental_payments row (snake_case columns).
 * Returns { ok, reason } — reason is the plain-English denial.
 */
export function canCorrectPayment(payment) {
  if (!payment) return { ok: false, reason: "The payment was not found." };
  if (payment.status !== "succeeded") {
    return {
      ok: false,
      reason: "Only completed payments can be corrected.",
    };
  }
  return { ok: true, reason: null };
}

/**
 * Does this correction change any money fact (amount, date, method, or the
 * charge the payment applies to)? Deposit state, notes, and receipt
 * reference are not money facts.
 * changes: the validated value.changes object { amountCents?, ... }.
 */
export function correctionTouchesMoney(changes) {
  if (!changes || typeof changes !== "object") return false;
  return PAYMENT_CORRECTION_MONEY_FIELDS.some((field) => changes[field] !== undefined);
}

/**
 * Validate a correction submission.
 * input: { amountCents?, receivedAt?, paymentMethod?, depositState?,
 *          depositAmountCents?, chargeId?, receiptReference?, notes?, reason }
 * payment: the rental_payments row being corrected.
 * Returns { valid, errors, value } where value = { changes, reason } with
 * changes holding ONLY the supplied fields (normalized).
 */
export function validatePaymentCorrection(input, payment) {
  const errors = [];
  const eligibility = canCorrectPayment(payment);
  if (!eligibility.ok) {
    return { valid: false, errors: [eligibility.reason], value: null };
  }

  const reason = isNonEmptyString(input?.reason) ? input.reason.trim() : "";
  if (!reason) errors.push("A reason is required to correct a payment.");

  const changes = {};
  const isOffline = payment.provider === "offline";
  const refundedCents = Number(payment.refunded_amount_cents || 0);

  if (input?.amountCents !== undefined) {
    const amountCents = toPositiveInt(input.amountCents);
    if (amountCents === null) {
      errors.push("The corrected amount must be a positive whole-cent amount.");
    } else if (!isOffline) {
      errors.push(
        "Only manually recorded payments can have their amount corrected. A provider-settled payment moved real money — correct its notes instead."
      );
    } else if (refundedCents > 0) {
      errors.push("A payment with a refund cannot have its amount corrected.");
    } else {
      changes.amountCents = amountCents;
    }
  }

  if (input?.receivedAt !== undefined) {
    const receivedAt = isNonEmptyString(input.receivedAt) ? input.receivedAt.trim() : "";
    if (!isValidDateString(receivedAt)) {
      errors.push("Enter a valid received date (YYYY-MM-DD).");
    } else if (isFutureDate(receivedAt)) {
      errors.push("The received date cannot be in the future.");
    } else if (!isOffline) {
      errors.push(
        "Only manually recorded payments can have their date corrected. A provider-settled payment moved real money — correct its notes instead."
      );
    } else {
      changes.receivedAt = receivedAt;
    }
  }

  if (input?.paymentMethod !== undefined) {
    const paymentMethod = isNonEmptyString(input.paymentMethod) ? input.paymentMethod.trim() : "";
    if (!OFFLINE_PAYMENT_METHODS.includes(paymentMethod)) {
      errors.push("The corrected payment method must be cash or cashier's check.");
    } else if (!isOffline) {
      errors.push("Only manually recorded payments can have their method corrected.");
    } else {
      changes.paymentMethod = paymentMethod;
    }
  }

  if (input?.depositState !== undefined) {
    const depositState = isNonEmptyString(input.depositState) ? input.depositState.trim() : "";
    if (depositState !== "received" && depositState !== "deposited") {
      errors.push("The deposit state must be received or deposited.");
    } else if (!isOffline) {
      errors.push(
        "Only manually recorded payments can have their deposit state corrected here. Use the deposit-state control instead."
      );
    } else if (refundedCents > 0) {
      errors.push("A payment with a refund cannot have its deposit state corrected.");
    } else {
      changes.depositState = depositState;
    }
  }

  if (input?.chargeId !== undefined) {
    const chargeId = isNonEmptyString(input.chargeId) ? input.chargeId.trim() : "";
    if (!chargeId) {
      errors.push("Choose a charge to apply this payment to.");
    } else if (!isOffline) {
      errors.push("Only manually recorded payments can be moved to a different charge.");
    } else if (refundedCents > 0) {
      errors.push("A payment with a refund cannot be moved to a different charge.");
    } else {
      // Same-lease and payable-target checks live in the RPC (this helper
      // has no charge data); the RPC refuses cross-lease moves and
      // paid/void targets, and a chargeId equal to the current charge is a
      // no-op there (counted as no change).
      changes.chargeId = chargeId;
    }
  }

  if (input?.depositAmountCents !== undefined) {
    const depositAmountCents = toNonNegativeInt(input.depositAmountCents);
    if (depositAmountCents === null) {
      errors.push("The deposit amount cannot be negative.");
    } else if (!isOffline) {
      errors.push(
        "Only manually recorded payments can have their deposit amount corrected. A provider-settled payment moved real money — correct its notes instead."
      );
    } else if (refundedCents > 0) {
      errors.push("A payment with a refund cannot have its deposit amount corrected.");
    } else {
      changes.depositAmountCents = depositAmountCents;
    }
  }

  // Cross-field guard: the deposit portion can never exceed the payment it
  // belongs to — whether the amount shrank or the deposit grew. Refused
  // with a plain-words message, never silently clamped. (Mirrors the RPC.)
  if (changes.amountCents !== undefined || changes.depositAmountCents !== undefined) {
    const effectiveAmount =
      changes.amountCents !== undefined ? changes.amountCents : Number(payment.amount_cents || 0);
    const effectiveDeposit =
      changes.depositAmountCents !== undefined
        ? changes.depositAmountCents
        : Number(payment.deposit_amount_cents || 0);
    if (effectiveDeposit > effectiveAmount) {
      errors.push(
        "The deposit amount cannot exceed the payment amount. Lower the deposit amount first, or correct to a larger payment amount."
      );
    }
  }

  if (input?.receiptReference !== undefined) {
    changes.receiptReference = isNonEmptyString(input.receiptReference)
      ? input.receiptReference.trim()
      : null;
  }

  if (input?.notes !== undefined) {
    changes.notes = isNonEmptyString(input.notes) ? input.notes.trim() : null;
  }

  if (errors.length === 0 && Object.keys(changes).length === 0) {
    errors.push("Nothing to correct — supply at least one field.");
  }

  if (errors.length > 0) return { valid: false, errors, value: null };
  return { valid: true, errors: [], value: { changes, reason } };
}

/**
 * Charge balance math for an amount correction. Pure — the
 * correct_rental_payment RPC applies the same rule; this is the test surface.
 * charge: { amount_cents, paid_amount_cents, status }.
 * deltaCents: new amount minus old amount (may be negative).
 * Returns { ok, reason?, newPaidCents, newStatus }.
 *
 * NOTE: this is the legacy no-credit delta — it is only correct when the
 * payment sourced no overpayment credit. Amount corrections on payments that
 * created tenant credit must use computeCreditAwareCorrection below (which
 * the RPC now mirrors); this helper is kept for the raw guard behavior.
 */
export function applyCorrectionDelta(charge, deltaCents) {
  const amountCents = Number(charge?.amount_cents || 0);
  const paidCents = Number(charge?.paid_amount_cents || 0);
  const delta = Number(deltaCents || 0);
  if (!charge) return { ok: false, reason: "The charge was not found." };
  if (charge.status === "void") {
    return { ok: false, reason: "The charge for this payment was voided." };
  }
  const newPaidCents = paidCents + delta;
  if (newPaidCents < 0 || newPaidCents > amountCents) {
    return {
      ok: false,
      reason: "The corrected amount would push the charge balance below zero or above the charge total.",
    };
  }
  const newStatus =
    newPaidCents >= amountCents ? "paid" : newPaidCents > 0 ? "partially_paid" : charge.status;
  return { ok: true, newPaidCents, newStatus };
}

/**
 * Credit-aware allocation for an amount correction. Pure — the
 * correct_rental_payment RPC (via the reconcile_credit_for_payment_correction
 * helper, same transaction) applies the same rule; this is the test surface.
 *
 * A recorded offline payment holds its FULL received amount, but the charge
 * only ever held the payment's APPLIED portion — any overpayment excess
 * lives in rental_tenant_credits sourced from the payment. The naive
 * newAmount-oldAmount delta corrupts both sides (false unpaid charge +
 * orphan/excess credit), so the correction must re-split the corrected
 * amount between charge and credit:
 *
 *   appliedOld = oldAmount - creditAmount            (what the charge holds
 *                                                      from this payment)
 *   others     = chargePaid - appliedOld             (everyone else's share)
 *   appliedNew = min(newAmount, chargeAmount - others) (what the charge can
 *                                                      absorb now)
 *   newExcess  = newAmount - appliedNew              (what the credit holds)
 *
 * Credit applications are immutable history: when part of the credit was
 * already applied to other charges, the new excess must still cover it —
 * otherwise the correction is blocked (the RPC raises a 409) until those
 * applications are reversed.
 *
 * Input: { oldAmountCents, newAmountCents, chargePaidCents,
 *          chargeAmountCents, chargeStatus, creditAmountCents = 0,
 *          appliedCreditCents = 0 }.
 * Returns { ok: true, appliedOldCents, appliedNewCents, newPaidCents,
 *           newStatus, oldExcessCents, newExcessCents, appliedCreditCents,
 *           newCreditRemainingCents, creditAction: "none"|"create"|"adjust"|"void",
 *           balanceDeltaCents }
 *      or { ok: false, code?, reason }.
 */
export function computeCreditAwareCorrection({
  oldAmountCents,
  newAmountCents,
  chargePaidCents,
  chargeAmountCents,
  chargeStatus = null,
  creditAmountCents = 0,
  appliedCreditCents = 0,
}) {
  const oldAmount = Number(oldAmountCents);
  const newAmount = Number(newAmountCents);
  const chargePaid = Number(chargePaidCents);
  const chargeAmount = Number(chargeAmountCents);
  const oldExcess = Number(creditAmountCents || 0);
  const appliedCredit = Number(appliedCreditCents || 0);
  if (!Number.isInteger(oldAmount) || oldAmount <= 0 || !Number.isInteger(newAmount) || newAmount <= 0) {
    return { ok: false, reason: "The corrected amount must be positive." };
  }
  const appliedOld = oldAmount - oldExcess;
  if (appliedOld < 0) {
    return { ok: false, reason: "The payment's recorded credit exceeds the recorded payment amount." };
  }
  const others = chargePaid - appliedOld;
  if (!Number.isInteger(others) || others < 0 || others > chargeAmount) {
    return { ok: false, reason: "The charge balance is inconsistent with this payment." };
  }
  const capacity = chargeAmount - others;
  const appliedNew = Math.min(newAmount, capacity);
  const newExcess = newAmount - appliedNew;
  if (appliedCredit > newExcess) {
    return {
      ok: false,
      code: "CREDIT_APPLICATIONS_APPLIED",
      reason:
        "Part of this payment's overpayment credit has already been applied to other charges, " +
        "and the corrected amount leaves too little excess to cover it. Reverse the credit " +
        "applications first, or correct to an amount that keeps enough excess.",
    };
  }
  const newPaid = others + appliedNew;
  if (newPaid < 0 || newPaid > chargeAmount) {
    return {
      ok: false,
      reason: "The corrected amount would push the charge balance below zero or above the charge total.",
    };
  }
  const newStatus =
    newPaid >= chargeAmount ? "paid" : newPaid > 0 ? "partially_paid" : chargeStatus;
  const creditAction =
    oldExcess === 0 ? (newExcess === 0 ? "none" : "create") : newExcess === 0 ? "void" : "adjust";
  return {
    ok: true,
    appliedOldCents: appliedOld,
    appliedNewCents: appliedNew,
    newPaidCents: newPaid,
    newStatus,
    oldExcessCents: oldExcess,
    newExcessCents: newExcess,
    appliedCreditCents: appliedCredit,
    newCreditRemainingCents: newExcess - appliedCredit,
    creditAction,
    balanceDeltaCents: appliedNew - appliedOld,
  };
}

/**
 * Charge-move math for a correction that re-points a payment at another
 * charge on the same lease. Pure — the correct_rental_payment RPC applies
 * the same rule; this is the test surface.
 *
 * The payment's applied portion is its amount minus its overpayment credit
 * (if any). The move unapplies that portion from the old charge and applies
 * min(new amount, new charge remaining) to the new charge; the new excess
 * becomes/adjusts/voids the credit under the same applied-credit guard as
 * computeCreditAwareCorrection (already-applied credit must still fit the
 * new excess, else the correction is blocked until those applications are
 * reversed).
 *
 * Input: { oldCharge: { amount_cents, paid_amount_cents, status, lease_id,
 *          due_date }, newCharge: { amount_cents, paid_amount_cents, status,
 *          lease_id }, oldAmountCents, newAmountCents, creditAmountCents = 0,
 *          appliedCreditCents = 0 }.
 * Returns { ok: true, oldAppliedCents, newAppliedCents,
 *           oldChargeNewPaidCents, oldChargeNewStatus,
 *           newChargeNewPaidCents, newChargeNewStatus, oldExcessCents,
 *           newExcessCents, appliedCreditCents, newCreditRemainingCents,
 *           creditAction: "none"|"create"|"adjust"|"void",
 *           balanceDeltaCents }
 *      or { ok: false, code?, reason }.
 */
export function computeChargeMoveCorrection({
  oldCharge,
  newCharge,
  oldAmountCents,
  newAmountCents,
  creditAmountCents = 0,
  appliedCreditCents = 0,
}) {
  const oldAmount = Number(oldAmountCents);
  const newAmount = Number(newAmountCents);
  if (!Number.isInteger(oldAmount) || oldAmount <= 0 || !Number.isInteger(newAmount) || newAmount <= 0) {
    return { ok: false, reason: "The corrected amount must be positive." };
  }
  if (!oldCharge) return { ok: false, reason: "The charge for this payment was not found." };
  if (oldCharge.status === "void") {
    return { ok: false, reason: "The charge for this payment was voided." };
  }
  if (!newCharge) return { ok: false, reason: "The new charge was not found." };
  if (newCharge.lease_id !== oldCharge.lease_id) {
    return { ok: false, reason: "A payment can only be moved to another charge on the same lease." };
  }
  if (newCharge.status === "void") {
    return { ok: false, reason: "The new charge was voided." };
  }
  if (newCharge.status === "paid") {
    return { ok: false, reason: "The new charge is already paid in full." };
  }
  const oldExcess = Number(creditAmountCents || 0);
  const appliedCredit = Number(appliedCreditCents || 0);
  const oldApplied = oldAmount - oldExcess;
  if (oldApplied < 0) {
    return { ok: false, reason: "The payment's recorded credit exceeds the recorded payment amount." };
  }
  const oldChargePaid = Number(oldCharge.paid_amount_cents || 0);
  const oldChargeAmount = Number(oldCharge.amount_cents || 0);
  const oldChargeNewPaid = oldChargePaid - oldApplied;
  if (oldChargeNewPaid < 0 || oldChargeNewPaid > oldChargeAmount) {
    return { ok: false, reason: "The charge balance is inconsistent with this payment." };
  }
  const newChargePaid = Number(newCharge.paid_amount_cents || 0);
  const newChargeAmount = Number(newCharge.amount_cents || 0);
  const capacity = newChargeAmount - newChargePaid;
  if (capacity <= 0) {
    return { ok: false, reason: "The new charge is already paid in full." };
  }
  const newApplied = Math.min(newAmount, capacity);
  const newExcess = newAmount - newApplied;
  if (appliedCredit > newExcess) {
    return {
      ok: false,
      code: "CREDIT_APPLICATIONS_APPLIED",
      reason:
        "Part of this payment's overpayment credit has already been applied to other charges, " +
        "and the corrected amount leaves too little excess to cover it. Reverse the credit " +
        "applications first, or correct to an amount that keeps enough excess.",
    };
  }
  const newChargeNewPaid = newChargePaid + newApplied;
  const today = new Date().toISOString().slice(0, 10);
  const oldChargeNewStatus =
    oldChargeNewPaid >= oldChargeAmount
      ? "paid"
      : oldChargeNewPaid > 0
        ? "partially_paid"
        : oldCharge.due_date && String(oldCharge.due_date).slice(0, 10) > today
          ? "scheduled"
          : "due";
  const newChargeNewStatus = newChargeNewPaid >= newChargeAmount ? "paid" : "partially_paid";
  const creditAction =
    oldExcess === 0 ? (newExcess === 0 ? "none" : "create") : newExcess === 0 ? "void" : "adjust";
  return {
    ok: true,
    oldAppliedCents: oldApplied,
    newAppliedCents: newApplied,
    oldChargeNewPaidCents: oldChargeNewPaid,
    oldChargeNewStatus,
    newChargeNewPaidCents: newChargeNewPaid,
    newChargeNewStatus,
    oldExcessCents: oldExcess,
    newExcessCents: newExcess,
    appliedCreditCents: appliedCredit,
    newCreditRemainingCents: newExcess - appliedCredit,
    creditAction,
    balanceDeltaCents: newApplied - oldApplied,
  };
}

/**
 * Serialize a correction audit row for the API/UI.
 * row: rental_payment_corrections row; changes is { column: { from, to } }.
 */
export function serializePaymentCorrection(row) {
  const fieldLabels = {
    amount_cents: "Amount",
    received_at: "Received date",
    payment_method: "Payment method",
    deposit_state: "Deposit state",
    deposit_amount_cents: "Deposit amount",
    charge_id: "Applies to charge",
    receipt_reference: "Receipt reference",
    notes: "Notes",
  };
  const changes = [];
  const raw = row.changes || {};
  for (const [column, change] of Object.entries(raw)) {
    changes.push({
      field: column,
      label: fieldLabels[column] || column,
      from: change?.from ?? null,
      to: change?.to ?? null,
    });
  }
  return {
    id: row.id,
    paymentId: row.payment_id,
    correctedAt: row.corrected_at,
    correctedBy: row.corrected_by || null,
    reason: row.reason,
    changes,
    balanceDeltaCents: Number(row.balance_delta_cents || 0),
    reconciledWarning: row.reconciled_warning === true,
  };
}
