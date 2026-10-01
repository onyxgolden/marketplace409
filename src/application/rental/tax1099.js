// Rentec parity R23 — 1099 tax-year prep domain (pure functions, no I/O).
//
// Two layers, per Jason's build-spend motto (hard boundary):
//   FREE LAYER (built): data prep — aggregate reportable payments per recipient
//     for the tax year, recipient records (TIN stored encrypted, masked on
//     every list view), $600 threshold flagging, 1099-NEC vs 1099-MISC
//     categorization, filing-status machine.
//   PARTNER LAYER (design only, HARD GATE): e-filing partner is a swappable
//     stub (efilePartner1099.js) that always reports "not connected" and
//     refuses submission. No paid signups, no real filings.
//
// TIN DECISION (documented): full TINs are encrypted with AES-256-GCM in the
// API route using the server env key FORGE_1099_TIN_KEY, stored as
// "v1.<iv>.<ciphertext>.<tag>" base64. Fail-closed: with no key configured,
// encrypt/decrypt throws TIN_KEY_MISSING instead of degrading silently.
// Masked display "XXX-XX-1234" is derived at the API/serialization boundary;
// the plaintext TIN never reaches a list response.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

export const TAX1099_ID_PREFIXES = Object.freeze({
  recipient: "rental_1099_recipient_",
  entry: "rental_1099_entry_",
  payerProfile: "rental_1099_payer_",
});

export function buildRecipientId() {
  return `${TAX1099_ID_PREFIXES.recipient}${crypto.randomUUID().replaceAll("-", "")}`;
}
export function buildPaymentEntryId() {
  return `${TAX1099_ID_PREFIXES.entry}${crypto.randomUUID().replaceAll("-", "")}`;
}
export function buildPayerProfileId() {
  return `${TAX1099_ID_PREFIXES.payerProfile}${crypto.randomUUID().replaceAll("-", "")}`;
}

// IRS $600 reporting threshold (federal) for 1099-NEC Box 1 and 1099-MISC Box 1.
export const REPORTING_THRESHOLD_CENTS = 60000;

export const RECIPIENT_KINDS = Object.freeze(["vendor", "owner"]);
export const ENTITY_TYPES = Object.freeze([
  "individual",
  "sole_proprietorship",
  "partnership",
  "llc",
  "c_corporation",
  "s_corporation",
  "trust_estate",
  "tax_exempt",
  "other",
]);
export const TIN_TYPES = Object.freeze(["ssn", "ein", "itin", "unknown"]);

// C and S corporations are generally NOT 1099-reportable (the IRS exempts
// most payments to corporations). Attorney/medical exceptions exist — the UI
// carries a "confirm with your CPA" note rather than trying to model them.
export const CORPORATION_EXCLUDED_ENTITY_TYPES = Object.freeze(["c_corporation", "s_corporation"]);

export const FILING_STATUSES = Object.freeze(["not_started", "ready", "exported", "filed_manually"]);
export const FILING_STATUS_LABELS = Object.freeze({
  not_started: "Not started",
  ready: "Ready",
  exported: "Exported",
  filed_manually: "Filed manually",
});

// not_started -> ready -> exported -> filed_manually.
// ready can reset to not_started; exported can return to ready (re-export).
// filed_manually is terminal.
export const FILING_STATUS_TRANSITIONS = Object.freeze({
  not_started: Object.freeze(["ready"]),
  ready: Object.freeze(["exported", "not_started"]),
  exported: Object.freeze(["filed_manually", "ready"]),
  filed_manually: Object.freeze([]),
});

export function canTransitionFilingStatus(from, to) {
  return FILING_STATUSES.includes(from) && FILING_STATUSES.includes(to)
    ? FILING_STATUS_TRANSITIONS[from].includes(to)
    : false;
}

// Plain-English categorization guide (surfaced in the UI next to each form).
export const FORM_TYPE_GUIDE = Object.freeze({
  "1099-NEC": Object.freeze({
    label: "1099-NEC",
    box: "Box 1 — Nonemployee compensation",
    appliesTo: "Vendors and contractors you paid $600 or more for services during the year.",
    plainEnglish:
      "The IRS uses Form 1099-NEC to report pay to people who worked for you but were not your employees — plumbers, electricians, lawn crews, repair contractors.",
  }),
  "1099-MISC": Object.freeze({
    label: "1099-MISC",
    box: "Box 1 — Rents",
    appliesTo: "Owners you paid $600 or more in rents during the year.",
    plainEnglish:
      "The IRS uses Form 1099-MISC Box 1 to report rents you paid out — for example, rental income distributions to a property owner.",
  }),
});

export function resolveFormType(recipientKind) {
  return recipientKind === "owner" ? "1099-MISC" : "1099-NEC";
}

// ---------------------------------------------------------------------------
// TIN handling
// ---------------------------------------------------------------------------

const TIN_KEY_ENV = "FORGE_1099_TIN_KEY";
const TIN_CIPHER_PREFIX = "v1";

function tinKeyBytes() {
  const raw = process.env[TIN_KEY_ENV];
  if (!raw || !raw.trim()) {
    const error = new Error("TIN encryption key is not configured (set FORGE_1099_TIN_KEY).");
    error.code = "TIN_KEY_MISSING";
    throw error;
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptTin(tin) {
  const digits = normalizeTin(tin);
  const key = tinKeyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TIN_CIPHER_PREFIX}.${iv.toString("base64")}.${ciphertext.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptTin(payload) {
  if (typeof payload !== "string" || !payload.startsWith(`${TIN_CIPHER_PREFIX}.`)) {
    const error = new Error("Unrecognized TIN payload format.");
    error.code = "TIN_FORMAT_UNKNOWN";
    throw error;
  }
  const parts = payload.split(".");
  if (parts.length !== 4) {
    const error = new Error("Unrecognized TIN payload format.");
    error.code = "TIN_FORMAT_UNKNOWN";
    throw error;
  }
  const key = tinKeyBytes();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64"));
  decipher.setAuthTag(Buffer.from(parts[3], "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64")), decipher.final()]).toString("utf8");
}

export function normalizeTin(tin) {
  const digits = String(tin ?? "").replace(/\D/g, "");
  if (digits.length !== 9) {
    const error = new Error("TIN must be 9 digits (SSN, EIN, or ITIN).");
    error.code = "TIN_INVALID";
    throw error;
  }
  return digits;
}

// "XXX-XX-1234" — the only TIN representation that may appear in list views,
// previews, or logs. The full value is decrypted only inside the export endpoint.
export function maskTin(tinOrLast4) {
  const digits = String(tinOrLast4 ?? "").replace(/\D/g, "");
  const last4 = digits.slice(-4).padStart(4, "X");
  return `XXX-XX-${last4}`;
}

export function tinLast4(tin) {
  return normalizeTin(tin).slice(-4);
}

// FIRE "type of TIN" indicator (positions per IRS_FIRE_FORMAT.md).
export const FIRE_TIN_TYPE_INDICATORS = Object.freeze({ ein: "1", ssn: "2", itin: "3", unknown: " " });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isValidDateString = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(new Date(`${value.trim()}T00:00:00Z`).getTime());
const toPositiveInt = (value) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
};

export function validateRecipientInput(input) {
  const errors = [];
  const kind = isNonEmptyString(input?.kind) ? input.kind.trim() : "";
  if (!RECIPIENT_KINDS.includes(kind)) errors.push("Recipient kind must be vendor or owner.");

  const displayName = isNonEmptyString(input?.displayName) ? input.displayName.trim() : "";
  if (!displayName) errors.push("Recipient name is required.");

  const entityType = isNonEmptyString(input?.entityType) ? input.entityType.trim() : "individual";
  if (!ENTITY_TYPES.includes(entityType)) errors.push("Entity type is not recognized.");

  const tinType = isNonEmptyString(input?.tinType) ? input.tinType.trim() : "unknown";
  if (!TIN_TYPES.includes(tinType)) errors.push("TIN type is not recognized.");

  // TIN is optional on create (it can be collected later), but when supplied it
  // must be exactly 9 digits. An empty string means "leave unchanged" on PATCH.
  const tinRaw = input?.tin;
  let tin = null;
  if (tinRaw !== undefined && tinRaw !== null && String(tinRaw).trim() !== "") {
    try {
      tin = normalizeTin(tinRaw);
    } catch {
      errors.push("TIN must be exactly 9 digits (SSN, EIN, or ITIN).");
    }
  }

  const state = isNonEmptyString(input?.state) ? input.state.trim().toUpperCase() : "";
  if (state && !/^[A-Z]{2}$/.test(state)) errors.push("State must be a 2-letter code (e.g. TX).");

  const zip = isNonEmptyString(input?.zip) ? input.zip.trim() : "";
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) errors.push("ZIP must be 5 digits (optionally ZIP+4).");

  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? {
      kind,
      displayName,
      entityType,
      tinType,
      tin, // digits string, or null when not supplied
      linkedVendorId: isNonEmptyString(input?.linkedVendorId) ? input.linkedVendorId.trim() : null,
      addressLine1: isNonEmptyString(input?.addressLine1) ? input.addressLine1.trim() : null,
      addressLine2: isNonEmptyString(input?.addressLine2) ? input.addressLine2.trim() : null,
      city: isNonEmptyString(input?.city) ? input.city.trim() : null,
      state: state || null,
      zip: zip || null,
      notes: isNonEmptyString(input?.notes) ? input.notes.trim() : null,
    } : null,
  };
}

export function validatePaymentEntryInput(input) {
  const errors = [];
  const recipientId = isNonEmptyString(input?.recipientId) ? input.recipientId.trim() : "";
  if (!recipientId) errors.push("A recipient is required.");

  const taxYear = Number(input?.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
    errors.push("Tax year must be a valid year (e.g. 2026).");
  }

  const paymentDate = isNonEmptyString(input?.paymentDate) ? input.paymentDate.trim() : "";
  if (!isValidDateString(paymentDate)) errors.push("Enter a valid payment date (YYYY-MM-DD).");

  const amountCents = toPositiveInt(input?.amountCents);
  if (!amountCents) errors.push("Amount must be a positive whole number of cents.");

  const source = isNonEmptyString(input?.source) ? input.source.trim() : "manual";
  if (!["manual", "r9_owner_distribution", "adjustment"].includes(source)) {
    errors.push("Entry source is not recognized.");
  }

  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? {
      recipientId,
      taxYear,
      paymentDate,
      amountCents,
      source,
      sourceRef: isNonEmptyString(input?.sourceRef) ? input.sourceRef.trim() : null,
      memo: isNonEmptyString(input?.memo) ? input.memo.trim() : null,
    } : null,
  };
}

export function validatePayerProfileInput(input) {
  const errors = [];
  const businessName = isNonEmptyString(input?.businessName) ? input.businessName.trim() : "";
  if (!businessName) errors.push("Business/payer name is required.");

  const taxYear = Number(input?.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
    errors.push("Tax year must be a valid year (e.g. 2026).");
  }

  const tinType = isNonEmptyString(input?.tinType) ? input.tinType.trim() : "ein";
  if (!["ssn", "ein", "unknown"].includes(tinType)) errors.push("TIN type is not recognized.");

  let tin = null;
  if (input?.tin !== undefined && input?.tin !== null && String(input.tin).trim() !== "") {
    try {
      tin = normalizeTin(input.tin);
    } catch {
      errors.push("Payer TIN must be exactly 9 digits.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    value: errors.length === 0 ? {
      businessName,
      taxYear,
      tinType,
      tin,
      addressLine1: isNonEmptyString(input?.addressLine1) ? input.addressLine1.trim() : null,
      addressLine2: isNonEmptyString(input?.addressLine2) ? input.addressLine2.trim() : null,
      city: isNonEmptyString(input?.city) ? input.city.trim() : null,
      state: isNonEmptyString(input?.state) ? input.state.trim().toUpperCase() : null,
      zip: isNonEmptyString(input?.zip) ? input.zip.trim() : null,
      contactName: isNonEmptyString(input?.contactName) ? input.contactName.trim() : null,
      contactPhone: isNonEmptyString(input?.contactPhone) ? input.contactPhone.trim() : null,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Serialization — the API layer MUST use these so a plaintext TIN can never
// leak into a list/get response.
// ---------------------------------------------------------------------------

export function serializeRecipient(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    linkedVendorId: row.linked_vendor_id,
    displayName: row.display_name,
    entityType: row.entity_type,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    country: row.country,
    tinMasked: row.tin_last4 ? maskTin(row.tin_last4) : "Not on file",
    tinLast4: row.tin_last4,
    tinOnFile: row.tin_ciphertext != null,
    tinType: row.tin_type,
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// ---------------------------------------------------------------------------
// Year aggregation — cash basis.
//
// VENDOR (1099-NEC Box 1): vendor payments from the merged R3/R4 tables
// (active payments only, counted in the year of payment_date) plus manual
// payment entries.
//
// OWNER (1099-MISC Box 1): GROSS RENT — read-only from the ledger
// (financial_events: transaction_kind='income', normalized_category=
// 'rental_income', on the recipient's linked properties, in the tax year).
// Net disbursements NEVER count toward Box 1. Manual entries with source
// 'adjustment' are added on top (CPA-directed corrections); 'manual' and
// 'r9_owner_distribution' sources are ignored for owners (they represent
// disbursements, not gross rent).
// ---------------------------------------------------------------------------

export function aggregate1099Year({ recipients = [], vendorPayments = [], paymentEntries = [], filingStates = [], grossRentByRecipient = new Map(), linkedPropertyIdsByRecipient = new Map(), taxYear }) {
  const year = Number(taxYear);
  const statesByRecipient = new Map((filingStates || []).map((state) => [state.recipient_id, state]));

  const vendorTotals = new Map();
  for (const payment of vendorPayments || []) {
    if (payment.status !== "active") continue; // voided payments never count
    const paymentYear = Number(String(payment.payment_date || "").slice(0, 4));
    if (!Number.isInteger(paymentYear) || paymentYear !== year) continue;
    const key = payment.vendor_id;
    const current = vendorTotals.get(key) || { totalCents: 0, paymentCount: 0 };
    current.totalCents += Number(payment.amount_cents || 0);
    current.paymentCount += 1;
    vendorTotals.set(key, current);
  }

  const entryTotals = new Map();
  for (const entry of paymentEntries || []) {
    if (entry.status !== "active") continue;
    if (Number(entry.tax_year) !== year) continue;
    // Owner Box 1 is gross-rent basis: only 'adjustment' entries (CPA
    // corrections) count. 'manual' / 'r9_owner_distribution' are net
    // disbursements and must never inflate Box 1. Vendor entries keep all
    // sources (1099-NEC compensation).
    const entryRecipient = (recipients || []).find((r) => r.id === entry.recipient_id);
    if (entryRecipient?.kind === "owner" && entry.source !== "adjustment") continue;
    const key = entry.recipient_id;
    const current = entryTotals.get(key) || { totalCents: 0, paymentCount: 0 };
    current.totalCents += Number(entry.amount_cents || 0);
    current.paymentCount += 1;
    entryTotals.set(key, current);
  }

  const rows = [];
  for (const recipient of recipients || []) {
    if (!recipient.is_active) continue;
    const formType = resolveFormType(recipient.kind);
    let totalCents = 0;
    let paymentCount = 0;
    let grossRentCents = 0;
    let adjustmentCents = 0;
    if (recipient.kind === "vendor" && recipient.linked_vendor_id) {
      const vendor = vendorTotals.get(recipient.linked_vendor_id);
      if (vendor) {
        totalCents += vendor.totalCents;
        paymentCount += vendor.paymentCount;
      }
    }
    if (recipient.kind === "owner") {
      // Gross-rent basis: Box 1 comes from the ledger, never from net
      // disbursements. Manual 'adjustment' entries are CPA-directed
      // corrections layered on top.
      const gross = grossRentByRecipient.get(recipient.id);
      if (gross) {
        grossRentCents = gross.totalCents;
        totalCents += gross.totalCents;
        paymentCount += gross.eventCount;
      }
    }
    const entries = entryTotals.get(recipient.id);
    if (entries) {
      if (recipient.kind === "owner") {
        // Owners: only 'adjustment' entries count (kept in entryTotals by the
        // loader — see the summary route). Vendors: all entry sources count.
        adjustmentCents = entries.totalCents;
        totalCents += entries.totalCents;
        paymentCount += entries.paymentCount;
      } else {
        totalCents += entries.totalCents;
        paymentCount += entries.paymentCount;
      }
    }

    const thresholdMet = totalCents >= REPORTING_THRESHOLD_CENTS;
    const corpExcluded = CORPORATION_EXCLUDED_ENTITY_TYPES.includes(recipient.entity_type);
    const state = statesByRecipient.get(recipient.id);

    rows.push(Object.freeze({
      recipientId: recipient.id,
      displayName: recipient.display_name,
      kind: recipient.kind,
      entityType: recipient.entity_type,
      tinMasked: recipient.tin_last4 ? maskTin(recipient.tin_last4) : "Not on file",
      tinOnFile: recipient.tin_ciphertext != null,
      formType,
      formBox: FORM_TYPE_GUIDE[formType].box,
      totalCents,
      paymentCount,
      // Reconciliation breakdown (owner recipients): the Box 1 total must
      // equal gross rent from the ledger plus CPA adjustments. The UI renders
      // these so Brandy can reconcile the total against the ledger.
      grossRentCents,
      adjustmentCents,
      // Properties attributed to this recipient for gross-rent Box 1. An
      // owner with zero links silently totals $0 — the UI must warn, never
      // present it as filing-ready.
      linkedPropertyCount: recipient.kind === "owner" ? (linkedPropertyIdsByRecipient.get(recipient.id)?.size ?? 0) : 0,
      thresholdMet,
      corpExcluded,
      // A recipient is reportable when payments cross the $600 threshold and
      // the entity type is not corporation-excluded. Below-threshold rows are
      // still returned (with the flag) so Brandy can see exactly who was
      // excluded and why — the UI renders the flag, not a silent drop.
      reportable: thresholdMet && !corpExcluded,
      exclusionReason: corpExcluded
        ? "C and S corporations are generally not 1099-reportable — confirm exceptions with your CPA."
        : (!thresholdMet ? `Under the $600 IRS threshold — no 1099 required (confirm with your CPA).` : null),
      filingStatus: state?.status || "not_started",
    }));
  }

  rows.sort((a, b) => b.totalCents - a.totalCents || a.displayName.localeCompare(b.displayName));

  const summary = Object.freeze({
    taxYear: year,
    recipientCount: rows.length,
    reportableCount: rows.filter((row) => row.reportable).length,
    totalsByFormType: Object.freeze({
      "1099-NEC": rows.filter((row) => row.reportable && row.formType === "1099-NEC").reduce((sum, row) => sum + row.totalCents, 0),
      "1099-MISC": rows.filter((row) => row.reportable && row.formType === "1099-MISC").reduce((sum, row) => sum + row.totalCents, 0),
    }),
    belowThresholdCount: rows.filter((row) => !row.thresholdMet).length,
    corpExcludedCount: rows.filter((row) => row.corpExcluded).length,
  });

  return Object.freeze({ rows: Object.freeze(rows), summary });
}
