// Vendor bills — the accounts-payable subledger. Pure validation and status
// rules; the API routes own persistence.
// Rentec parity R3. Ledger design mirrors tenant charges (rent_charges is the
// AR subledger): recording a bill creates NO financial_events row — FORGE
// reports cash-basis, so the expense event posts when the bill is PAID
// (slice R4), exactly like a tenant charge posts income when paid.
//
// Status machine (R3 owns open ⇄ voided; R4 will own partial/paid):
//   open    — recorded, unpaid. Editable. Voidable with a reason.
//   partial — reserved for R4 (partial payment recorded).
//   paid    — reserved for R4 (fully paid). Locked.
//   voided  — reversed, never deleted. Immutable. Requires void_reason.

export const VENDOR_BILL_ID_PREFIX = "rental_vendor_bill_";
export const VENDOR_BILL_STATUSES = Object.freeze(["open", "partial", "paid", "voided"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_CODE_RE = /^[a-z0-9_]+$/;
const MAX_MEMO = 2000;
const MAX_REFERENCE = 200;
const MAX_PROPERTY = 160;

const text = (value) => (typeof value === "string" ? value.trim() : "");
const isValidDate = (value) =>
  typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

export function buildVendorBillId() {
  return `${VENDOR_BILL_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function buildVendorBillSourceKey(billId) {
  return `vendorbill:${billId}`;
}

// Pure validation for recording a bill. `expenseAccountCodes` is the owner's
// active expense codes (chart of accounts, authoritative) or null for legacy
// mode — null skips the membership check but never the format check.
export function validateVendorBillInput(input, { expenseAccountCodes = null } = {}) {
  const errors = [];
  const vendorId = text(input?.vendorId);
  if (!vendorId) errors.push("A vendor is required for the bill.");

  const billDate = text(input?.billDate);
  if (!isValidDate(billDate)) errors.push("Bill date must be a valid date.");

  const dueDate = text(input?.dueDate);
  if (!isValidDate(dueDate)) errors.push("Due date must be a valid date.");
  if (isValidDate(billDate) && isValidDate(dueDate) && dueDate < billDate) {
    errors.push("Due date cannot be before the bill date.");
  }

  const amountCents = Number(input?.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    errors.push("Bill amount must be a positive number of cents.");
  }

  const expenseAccountCode = text(input?.expenseAccountCode);
  if (!ACCOUNT_CODE_RE.test(expenseAccountCode)) {
    errors.push("An expense account is required for the bill.");
  } else if (expenseAccountCodes && !expenseAccountCodes.has(expenseAccountCode)) {
    errors.push("That expense account is not active on the chart of accounts.");
  }

  const propertyId = text(input?.propertyId).slice(0, MAX_PROPERTY);

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: {
      vendorId,
      billDate,
      dueDate,
      amountCents,
      expenseAccountCode,
      propertyId: propertyId || null,
      memo: text(input?.memo).slice(0, MAX_MEMO) || null,
      attachmentReference: text(input?.attachmentReference).slice(0, MAX_REFERENCE) || null,
    },
  };
}

// Validation for editing an open bill. Amount can never drop below what is
// already paid (R4) — lowering it would silently rewrite payment history.
export function validateVendorBillEdit(input, bill, { expenseAccountCodes = null } = {}) {
  const errors = [];
  if (!canEditBill(bill)) {
    errors.push("Only open, unpaid bills can be edited.");
    return { valid: false, errors };
  }
  const patch = {};
  if (input?.billDate !== undefined) {
    const billDate = text(input.billDate);
    if (!isValidDate(billDate)) errors.push("Bill date must be a valid date.");
    else patch.bill_date = billDate;
  }
  if (input?.dueDate !== undefined) {
    const dueDate = text(input.dueDate);
    if (!isValidDate(dueDate)) errors.push("Due date must be a valid date.");
    else patch.due_date = dueDate;
  }
  if (patch.bill_date && patch.due_date && patch.due_date < patch.bill_date) {
    errors.push("Due date cannot be before the bill date.");
  }
  if (input?.amountCents !== undefined) {
    const amountCents = Number(input.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      errors.push("Bill amount must be a positive number of cents.");
    } else if (amountCents < Number(bill.paid_amount_cents || 0)) {
      errors.push("Bill amount cannot be less than what has already been paid.");
    } else {
      patch.amount_cents = amountCents;
    }
  }
  if (input?.expenseAccountCode !== undefined) {
    const code = text(input.expenseAccountCode);
    if (!ACCOUNT_CODE_RE.test(code)) errors.push("An expense account is required for the bill.");
    else if (expenseAccountCodes && !expenseAccountCodes.has(code)) {
      errors.push("That expense account is not active on the chart of accounts.");
    } else patch.expense_account_code = code;
  }
  if (input?.propertyId !== undefined) patch.property_id = text(input.propertyId).slice(0, MAX_PROPERTY) || null;
  if (input?.memo !== undefined) patch.memo = text(input.memo).slice(0, MAX_MEMO) || null;
  if (input?.attachmentReference !== undefined) {
    patch.attachment_reference = text(input.attachmentReference).slice(0, MAX_REFERENCE) || null;
  }
  if (errors.length > 0) return { valid: false, errors };
  if (Object.keys(patch).length === 0) {
    return { valid: false, errors: ["Nothing to update."] };
  }
  return { valid: true, errors: [], patch };
}

// Editable only while open and unpaid. Partial/paid are R4's territory;
// voided is terminal.
export function canEditBill(bill) {
  return bill?.status === "open" && Number(bill?.paid_amount_cents || 0) === 0;
}

// Voidable while open (R3) or partially paid (R4). Paid bills resolve through
// refunds/credits, never a void — same rule as tenant charges.
export function canVoidBill(bill) {
  // Void is reversal of an untouched bill: it must still be open AND have no
  // applied payments. A partially paid bill can never be voided — record a
  // credit/adjustment instead. The write-time UPDATE re-checks both so a
  // payment landing between the read and the write cannot be voided away.
  return bill?.status === "open" && Number(bill?.paid_amount_cents || 0) === 0;
}

export function billBalanceCents(bill) {
  return Math.max(0, Number(bill?.amount_cents || 0) - Number(bill?.paid_amount_cents || 0));
}

/**
 * Parse the GET list query parameters into safe filter values. Throws an
 * Error whose message starts with "Invalid " for any bad filter so the
 * route can answer 400.
 */
export function parseBillFilters(searchParams) {
  const status = searchParams.get("status") || "open";
  if (!VENDOR_BILL_STATUSES.includes(status) && status !== "all" && status !== "overdue") {
    throw new Error(`Invalid status filter: "${status}".`);
  }
  const propertyId = searchParams.get("propertyId") || null;
  const vendorId = searchParams.get("vendorId") || null;
  const overdueOnly = status === "overdue" || searchParams.get("overdue") === "1";
  return { status, propertyId, vendorId, overdueOnly };
}

export function isBillOverdue(bill, todayISO) {
  if (!bill || bill.status === "paid" || bill.status === "voided") return false;
  if (!isValidDate(bill.due_date)) return false;
  return bill.due_date < todayISO && billBalanceCents(bill) > 0;
}

export function serializeVendorBill(row, vendorName = null) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName,
    propertyId: row.property_id || null,
    billDate: row.bill_date,
    dueDate: row.due_date,
    amountCents: Number(row.amount_cents || 0),
    paidAmountCents: Number(row.paid_amount_cents || 0),
    balanceCents: billBalanceCents(row),
    expenseAccountCode: row.expense_account_code,
    memo: row.memo || null,
    attachmentReference: row.attachment_reference || null,
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
