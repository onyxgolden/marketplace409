// Receipts / invoice intake — pure validation, ids, and status rules.
// Rentec parity R26 (free layer — leapfrog, not copy). The receipt record is
// a manually-entered intake record: vendor, date, amount, line items, tax.
// Matching against vendor bills (R3/R4) is deterministic
// (see receiptMatching.js); AI extraction is a hard-gated stub
// (see receiptExtraction.js). The API routes own persistence.

export const RECEIPT_ID_PREFIX = "rental_receipt_";
export const RECEIPT_ID_PATTERN = /^rental_receipt_[0-9a-f]+$/i;
export const RECEIPT_STATUSES = Object.freeze(["inbox", "applied", "voided"]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HINT = 200;
const MAX_NOTES = 2000;
const MAX_PROPERTY = 160;
const MAX_LINE_ITEMS = 200;
const MAX_LINE_DESCRIPTION = 400;

const text = (value) => (typeof value === "string" ? value.trim() : "");
const isValidDate = (value) =>
  typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

export function buildReceiptId() {
  return `${RECEIPT_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isValidReceiptId(value) {
  return typeof value === "string" && RECEIPT_ID_PATTERN.test(value);
}

export function canEditReceipt(receipt) {
  return receipt?.status === "inbox";
}

export function canApplyReceipt(receipt) {
  return receipt?.status === "inbox";
}

// Line items: [{ description, quantity?, amountCents }]. When any line items
// are given, they must add up to the receipt total minus tax (otherwise the
// receipt silently disagrees with its own breakdown).
export function validateReceiptLineItems(lineItems, { amountCents, taxCents }) {
  const errors = [];
  if (lineItems === undefined || lineItems === null) return { valid: true, errors: [], value: [] };
  if (!Array.isArray(lineItems)) {
    return { valid: false, errors: ["Line items must be a list."], value: null };
  }
  if (lineItems.length > MAX_LINE_ITEMS) {
    return { valid: false, errors: [`No more than ${MAX_LINE_ITEMS} line items are allowed.`], value: null };
  }
  let sum = 0;
  const value = [];
  for (let index = 0; index < lineItems.length; index += 1) {
    const item = lineItems[index] || {};
    const description = text(item.description).slice(0, MAX_LINE_DESCRIPTION);
    const amountItemCents = Number(item.amountCents);
    if (!description) errors.push(`Line item ${index + 1} needs a description.`);
    if (!Number.isSafeInteger(amountItemCents) || amountItemCents < 0) {
      errors.push(`Line item ${index + 1} needs an amount in whole cents (0 or more).`);
    }
    const quantity = item.quantity === undefined || item.quantity === null ? null : Number(item.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
      errors.push(`Line item ${index + 1} quantity must be a positive number.`);
    }
    value.push({
      description: description || `Line ${index + 1}`,
      quantity,
      amountCents: Number.isSafeInteger(amountItemCents) && amountItemCents >= 0 ? amountItemCents : 0,
    });
    if (Number.isSafeInteger(amountItemCents) && amountItemCents >= 0) sum += amountItemCents;
  }
  if (errors.length > 0) return { valid: false, errors, value: null };
  const expected = Number(amountCents) - Number(taxCents);
  if (Number.isSafeInteger(Number(amountCents)) && sum !== expected) {
    return {
      valid: false,
      errors: ["Line items must add up to the receipt total minus tax."],
      value: null,
    };
  }
  return { valid: true, errors: [], value };
}

// Pure validation for recording a receipt. Vendor identification is either a
// known vendor (vendorId) or a free-text hint (vendorNameHint — the "unknown
// vendor" path, where the UI offers create-vendor via the R3 route).
export function validateReceiptInput(input) {
  const errors = [];
  const vendorId = text(input?.vendorId);
  const vendorNameHint = text(input?.vendorNameHint).slice(0, MAX_HINT);
  if (!vendorId && !vendorNameHint) {
    errors.push("A vendor is required — pick one or type the name shown on the receipt.");
  }

  const receiptDate = text(input?.receiptDate);
  if (!isValidDate(receiptDate)) errors.push("Receipt date must be a valid date.");

  const amountCents = Number(input?.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    errors.push("Receipt total must be a positive number of cents.");
  }

  const taxCentsRaw = input?.taxCents;
  const taxCents = taxCentsRaw === undefined || taxCentsRaw === null || taxCentsRaw === "" ? 0 : Number(taxCentsRaw);
  if (!Number.isSafeInteger(taxCents) || taxCents < 0) {
    errors.push("Tax must be a non-negative number of cents.");
  } else if (Number.isSafeInteger(amountCents) && taxCents > amountCents) {
    errors.push("Tax cannot be more than the receipt total.");
  }

  const propertyId = text(input?.propertyId).slice(0, MAX_PROPERTY);
  const documentId = text(input?.documentId);
  const notes = text(input?.notes).slice(0, MAX_NOTES);

  const lineCheck = validateReceiptLineItems(input?.lineItems, { amountCents, taxCents });
  for (const error of lineCheck.errors) errors.push(error);

  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    value: {
      vendorId: vendorId || null,
      vendorNameHint: vendorId ? null : vendorNameHint,
      propertyId: propertyId || null,
      receiptDate,
      amountCents,
      taxCents,
      lineItems: lineCheck.value,
      documentId: documentId || null,
      notes: notes || null,
    },
  };
}

// Validation for editing an inbox receipt. Applied/voided receipts are
// immutable — changes resolve through the R4 payment void, never edits.
export function validateReceiptEdit(input, receipt) {
  const errors = [];
  if (!canEditReceipt(receipt)) {
    errors.push("Only inbox receipts can be edited.");
    return { valid: false, errors };
  }
  const patch = {};
  if (input?.vendorId !== undefined || input?.vendorNameHint !== undefined) {
    const vendorId = text(input?.vendorId);
    const vendorNameHint = text(input?.vendorNameHint).slice(0, MAX_HINT);
    if (!vendorId && !vendorNameHint) {
      errors.push("A vendor is required — pick one or type the name shown on the receipt.");
    } else {
      patch.vendor_id = vendorId || null;
      patch.vendor_name_hint = vendorId ? null : vendorNameHint;
    }
  }
  if (input?.receiptDate !== undefined) {
    const receiptDate = text(input.receiptDate);
    if (!isValidDate(receiptDate)) errors.push("Receipt date must be a valid date.");
    else patch.receipt_date = receiptDate;
  }
  if (input?.amountCents !== undefined) {
    const amountCents = Number(input.amountCents);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      errors.push("Receipt total must be a positive number of cents.");
    } else patch.amount_cents = amountCents;
  }
  if (input?.taxCents !== undefined) {
    const taxCents = Number(input.taxCents);
    if (!Number.isSafeInteger(taxCents) || taxCents < 0) {
      errors.push("Tax must be a non-negative number of cents.");
    } else {
      const total = patch.amount_cents ?? Number(receipt.amount_cents);
      if (Number.isSafeInteger(total) && taxCents > total) errors.push("Tax cannot be more than the receipt total.");
      else patch.tax_cents = taxCents;
    }
  }
  if (input?.propertyId !== undefined) patch.property_id = text(input.propertyId).slice(0, MAX_PROPERTY) || null;
  if (input?.documentId !== undefined) patch.document_id = text(input.documentId) || null;
  if (input?.notes !== undefined) patch.notes = text(input.notes).slice(0, MAX_NOTES) || null;
  if (input?.lineItems !== undefined) {
    const total = patch.amount_cents ?? Number(receipt.amount_cents);
    const tax = patch.tax_cents ?? Number(receipt.tax_cents ?? 0);
    const lineCheck = validateReceiptLineItems(input.lineItems, { amountCents: total, taxCents: tax });
    for (const error of lineCheck.errors) errors.push(error);
    if (lineCheck.valid) patch.line_items = lineCheck.value;
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], value: patch };
}
