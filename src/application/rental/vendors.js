// Vendor master records — pure validation and helpers for the vendors API.
// Rentec parity R3: Brandy's demand (b), "ALL the vendor options."
// Vendors are workspace-scoped (owner_id); the API enforces it, this module
// enforces field rules.

export const VENDOR_ID_PREFIX = "rental_vendor_";

const MAX_NAME = 160;
const MAX_CONTACT = 120;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_ADDRESS = 500;
const MAX_TRADE = 80;
const MAX_NOTES = 2000;

// Good enough for a contact email on a vendor record — the mailer is not
// involved here, so this is a typo-catcher, not a deliverability proof.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAX_ID_LAST4_RE = /^\d{4}$/;

const text = (value) => (typeof value === "string" ? value.trim() : "");
const clipped = (value, max) => {
  const t = text(value);
  return t ? t.slice(0, max) : "";
};

export function buildVendorId() {
  return `${VENDOR_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

// Pure validation for creating or editing a vendor. `forUpdate` skips the
// name-required rule so PATCH can send a partial body — the route rejects an
// empty patch separately.
export function validateVendorInput(input, { forUpdate = false } = {}) {
  const errors = [];
  const name = clipped(input?.name, MAX_NAME);
  if (!forUpdate && !name) errors.push("Vendor name is required.");
  if (forUpdate && input?.name !== undefined && !name) errors.push("Vendor name cannot be blank.");

  const email = clipped(input?.email, MAX_EMAIL);
  if (email && !EMAIL_RE.test(email)) errors.push("Vendor email does not look like an email address.");

  const taxIdLast4 = text(input?.taxIdLast4);
  if (taxIdLast4 && !TAX_ID_LAST4_RE.test(taxIdLast4)) {
    errors.push("Tax ID must be the last 4 digits.");
  }

  const value = {
    name,
    contactName: clipped(input?.contactName, MAX_CONTACT) || null,
    email: email || null,
    phone: clipped(input?.phone, MAX_PHONE) || null,
    address: clipped(input?.address, MAX_ADDRESS) || null,
    trade: clipped(input?.trade, MAX_TRADE) || null,
    taxClassification: clipped(input?.taxClassification, MAX_CONTACT) || null,
    taxIdLast4: taxIdLast4 || null,
    notes: clipped(input?.notes, MAX_NOTES) || null,
  };
  if (input?.isActive !== undefined) value.isActive = Boolean(input.isActive);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], value };
}

// Case-insensitive duplicate-name check helper — the route loads the owner's
// vendor names and calls this. Two "Acme Plumbing" records are a data-quality
// trap Brandy would hit on day one.
export function isDuplicateVendorName(name, existingNames) {
  const needle = text(name).toLowerCase();
  if (!needle) return false;
  return (existingNames || []).some((n) => text(n).toLowerCase() === needle);
}

export function serializeVendor(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name || null,
    email: row.email || null,
    phone: row.phone || null,
    address: row.address || null,
    trade: row.trade || null,
    taxClassification: row.tax_classification || null,
    taxIdLast4: row.tax_id_last4 || null,
    notes: row.notes || null,
    isActive: row.is_active !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
