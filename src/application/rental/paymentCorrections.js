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
//     (manually recorded: cash / cashiers_check) payments. A provider
//     payment moved real money — its amount/date/method would lie about
//     what settled; notes and receipt reference stay correctable.
//   - Corrected amounts must be positive — never zero or negative.
//   - A payment with any refunded amount cannot have its amount corrected
//     (refund math is anchored to the original amount).
//   - Money-touching corrections on a reconciled payment are blocked by the
//     RPC ("undo the bank reconciliation first", mirroring R4's void guard);
//     notes/receipt-reference corrections go through flagged as a warning.
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
]);

export const PAYMENT_CORRECTION_NOTE_FIELDS = Object.freeze([
  "receiptReference",
  "notes",
]);

export const PAYMENT_CORRECTION_FIELDS = Object.freeze([
  ...PAYMENT_CORRECTION_MONEY_FIELDS,
  ...PAYMENT_CORRECTION_NOTE_FIELDS,
]);

export const OFFLINE_PAYMENT_METHODS = Object.freeze(["cash", "cashiers_check"]);

// Column names on rental_payments for each correction field — the audit row
// stores before/after against these columns.
export const CORRECTION_FIELD_COLUMNS = Object.freeze({
  amountCents: "amount_cents",
  receivedAt: "received_at",
  paymentMethod: "payment_method",
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
 * Does this correction change any money fact (amount, date, method)?
 * changes: the validated value.changes object { amountCents?, ... }.
 */
export function correctionTouchesMoney(changes) {
  if (!changes || typeof changes !== "object") return false;
  return PAYMENT_CORRECTION_MONEY_FIELDS.some((field) => changes[field] !== undefined);
}

/**
 * Validate a correction submission.
 * input: { amountCents?, receivedAt?, paymentMethod?, receiptReference?, notes?, reason }
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
 * Serialize a correction audit row for the API/UI.
 * row: rental_payment_corrections row; changes is { column: { from, to } }.
 */
export function serializePaymentCorrection(row) {
  const fieldLabels = {
    amount_cents: "Amount",
    received_at: "Received date",
    payment_method: "Payment method",
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
