// R4 domain: vendor payments — record check/ACH payments against vendor bills.
//
// Status machine (shared with vendorBills.js): open ⇄ voided belongs to bill
// recording (R3); partial/paid and the void of a *payment* belong here (R4).
// Financial rule: one payment can pay many bills; one bill can take many
// partial payments; an application can never exceed the bill's remaining
// balance; the applications must sum to the payment amount.

export const VENDOR_PAYMENT_ID_PREFIX = "rental_vendor_payment_";
export const VENDOR_PAYMENT_METHODS = Object.freeze(["check", "ach"]);
export const VENDOR_PAYMENT_STATUSES = Object.freeze(["active", "voided"]);

export function buildVendorPaymentId() {
  return `${VENDOR_PAYMENT_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

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
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(new Date(`${value.trim()}T00:00:00Z`).getTime());

/**
 * Bill balance in cents. bill: { amount_cents, paid_amount_cents }.
 */
export function vendorBillBalanceCents(bill) {
  return Math.max(0, Number(bill.amount_cents || 0) - Number(bill.paid_amount_cents || 0));
}

/**
 * Bill status after applying `appliedCents` more to it.
 * Only ever called on open/partial bills, so the result is partial|paid.
 */
export function billStatusAfterApply(bill, appliedCents) {
  const paid = Number(bill.paid_amount_cents || 0) + appliedCents;
  return paid >= Number(bill.amount_cents || 0) ? "paid" : "partial";
}

/**
 * Bill status after rolling back `rolledBackCents` from it (payment void).
 */
export function billStatusAfterVoid(bill, rolledBackCents) {
  const paid = Number(bill.paid_amount_cents || 0) - rolledBackCents;
  return paid <= 0 ? "open" : "partial";
}

/**
 * Validate a payment submission.
 * input: { id?, vendorId, paymentDate, paymentMethod, checkNumber?, bankAccountId, memo?, amountCents?, applications: [{ billId, amountCents }] }
 * context.bills: bill rows for every referenced bill { id, vendor_id, status, amount_cents, paid_amount_cents }.
 * Returns { valid, errors, value }.
 */
export function validateVendorPaymentInput(input, context = {}) {
  const errors = [];
  const billsById = new Map();
  for (const bill of context.bills || []) billsById.set(bill.id, bill);

  const id = isNonEmptyString(input?.id) ? input.id.trim() : buildVendorPaymentId();
  const vendorId = isNonEmptyString(input?.vendorId) ? input.vendorId.trim() : "";
  if (!vendorId) errors.push("A vendor is required.");

  const paymentDate = isNonEmptyString(input?.paymentDate) ? input.paymentDate.trim() : "";
  if (!isValidDateString(paymentDate)) errors.push("Enter a valid payment date (YYYY-MM-DD).");

  const paymentMethod = isNonEmptyString(input?.paymentMethod) ? input.paymentMethod.trim() : "";
  if (!VENDOR_PAYMENT_METHODS.includes(paymentMethod)) {
    errors.push("Payment method must be check or ACH.");
  }

  const checkNumber = isNonEmptyString(input?.checkNumber) ? input.checkNumber.trim() : "";
  if (paymentMethod === "check" && !checkNumber) {
    errors.push("A check number is required for check payments.");
  }

  const bankAccountId = isNonEmptyString(input?.bankAccountId) ? input.bankAccountId.trim() : "";
  if (!bankAccountId) errors.push("A bank account is required.");

  const memo = isNonEmptyString(input?.memo) ? input.memo.trim() : "";

  const applications = Array.isArray(input?.applications) ? input.applications : [];
  const cleanApps = [];
  if (applications.length === 0) {
    errors.push("Apply the payment to at least one bill.");
  } else {
    const seenBillIds = new Set();
    for (const app of applications) {
      const billId = isNonEmptyString(app?.billId) ? app.billId.trim() : "";
      const amountCents = toPositiveInt(app?.amountCents);
      if (!billId) {
        errors.push("Every payment line needs a bill.");
        continue;
      }
      if (seenBillIds.has(billId)) {
        errors.push("The same bill appears twice on this payment.");
        continue;
      }
      seenBillIds.add(billId);
      if (amountCents === null) {
        errors.push("Every payment line needs a positive amount.");
        continue;
      }
      const bill = billsById.get(billId);
      if (!bill) {
        errors.push("A bill on this payment was not found.");
        continue;
      }
      if (bill.vendor_id !== vendorId) {
        errors.push("All bills on a payment must belong to the same vendor.");
        continue;
      }
      if (bill.status !== "open" && bill.status !== "partial") {
        errors.push("Only open bills can be paid.");
        continue;
      }
      const balance = vendorBillBalanceCents(bill);
      if (amountCents > balance) {
        errors.push("A payment line cannot exceed the bill's remaining balance.");
        continue;
      }
      cleanApps.push({ billId, amountCents });
    }
  }

  const appliedTotal = cleanApps.reduce((sum, app) => sum + app.amountCents, 0);
  let amountCents = toPositiveInt(input?.amountCents);
  if (amountCents === null) {
    // Derive the payment total from the lines when the caller omits it.
    amountCents = appliedTotal > 0 ? appliedTotal : null;
  }
  if (amountCents === null) {
    errors.push("The payment amount must be positive.");
  } else if (cleanApps.length > 0 && appliedTotal !== amountCents) {
    errors.push("The bill lines must add up to the payment amount.");
  }

  if (errors.length > 0) return { valid: false, errors, value: null };
  return {
    valid: true,
    errors: [],
    value: {
      id,
      vendorId,
      paymentDate,
      paymentMethod,
      checkNumber: paymentMethod === "check" ? checkNumber : "",
      bankAccountId,
      memo,
      amountCents,
      applications: cleanApps,
    },
  };
}

/**
 * Validate an edit to a payment header. Editable fields are memo,
 * check number, and payment date — never the amount, method, bank account,
 * or the bill applications. Returns { valid, errors, value } with only the
 * supplied fields.
 */
export function validateVendorPaymentEdit(input) {
  const errors = [];
  const value = {};
  if (input?.memo !== undefined) {
    value.memo = isNonEmptyString(input.memo) ? input.memo.trim() : "";
  }
  if (input?.checkNumber !== undefined) {
    value.checkNumber = isNonEmptyString(input.checkNumber) ? input.checkNumber.trim() : "";
  }
  if (input?.paymentDate !== undefined) {
    const paymentDate = isNonEmptyString(input.paymentDate) ? input.paymentDate.trim() : "";
    if (!isValidDateString(paymentDate)) {
      errors.push("Enter a valid payment date (YYYY-MM-DD).");
    } else {
      value.paymentDate = paymentDate;
    }
  }
  if (Object.keys(value).length === 0 && errors.length === 0) {
    errors.push("Nothing to update.");
  }
  if (errors.length > 0) return { valid: false, errors, value: null };
  return { valid: true, errors: [], value };
}

export function canEditPayment(payment) {
  return payment?.status === "active";
}

export function canVoidPayment(payment) {
  return payment?.status === "active";
}

/**
 * Pure reconciliation check shared by the edit and void paths.
 * reconciliations: [{ status, cleared_event_ids }] (jsonb arrays).
 * A payment whose event ids appear on any ACTIVE reconciliation is locked.
 */
export function paymentIsReconciled(eventIds, reconciliations) {
  const ids = new Set((eventIds || []).map(String));
  if (ids.size === 0) return false;
  for (const rec of reconciliations || []) {
    if (rec?.status !== "active") continue;
    const cleared = Array.isArray(rec.cleared_event_ids) ? rec.cleared_event_ids : [];
    for (const clearedId of cleared) {
      if (ids.has(String(clearedId))) return true;
    }
  }
  return false;
}

/**
 * Serialize a payment row for the API.
 * options.applications: [{ bill_id, amount_cents, bill_bill_date, bill_due_date, bill_amount_cents }]
 */
export function serializeVendorPayment(row, options = {}) {
  const applications = (options.applications || []).map((app) => ({
    billId: app.bill_id,
    amountCents: Number(app.amount_cents || 0),
    billBillDate: app.bill_bill_date || null,
    billDueDate: app.bill_due_date || null,
    billAmountCents: app.bill_amount_cents == null ? null : Number(app.bill_amount_cents),
  }));
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: options.vendorName || null,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    checkNumber: row.check_number || null,
    bankAccountId: row.bank_account_id || null,
    memo: row.memo || "",
    amountCents: Number(row.amount_cents || 0),
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    eventIds: Array.isArray(row.financial_event_ids) ? row.financial_event_ids.map(String) : [],
    applications,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
