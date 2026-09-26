import { isUsStateCode } from "./usStates";

// Shared validation for structured US addresses. Returns
// { ok, errors } where errors maps field -> human-readable message.
//
// Modes:
//   - { allowEmptyGroup: false } (property add): street, city, state, and ZIP
//     are all required.
//   - { allowEmptyGroup: true } (editing an older record): when every field
//     is blank the group is skipped entirely; once any field is filled the
//     full group rules apply.
export const ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

export function validateAddressFields(fields = {}, { allowEmptyGroup = false } = {}) {
  const street = String(fields.street || "").trim();
  const unit = String(fields.unit || "").trim();
  const city = String(fields.city || "").trim();
  const state = String(fields.state || "").trim().toUpperCase();
  const zip = String(fields.zip || "").trim();
  const errors = {};

  if (allowEmptyGroup && !street && !unit && !city && !state && !zip) {
    return { ok: true, errors, values: { street, unit, city, state, zip } };
  }

  if (!street) errors.street = "Street address is required.";
  if (!city) errors.city = "City is required.";
  if (!state) {
    errors.state = "State is required.";
  } else if (!isUsStateCode(state)) {
    errors.state = "Select a US state.";
  }
  if (!zip) {
    errors.zip = "ZIP code is required.";
  } else if (!ZIP_PATTERN.test(zip)) {
    errors.zip = "Enter a valid ZIP code (12345 or 12345-6789).";
  }

  return { ok: Object.keys(errors).length === 0, errors, values: { street, unit, city, state, zip } };
}

/** True when a rental unit carries any structured address content. */
export function hasStructuredAddress(address = {}) {
  return ["street", "unit", "city", "state", "zip"].some((key) => String(address[key] || "").trim() !== "");
}

/** "123 Main St, Apt 4, Springfield, IL 62701" — skips blank parts. */
export function formatAddress(address = {}) {
  const street = String(address.street || "").trim();
  const unit = String(address.unit || "").trim();
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim().toUpperCase();
  const zip = String(address.zip || "").trim();
  const locality = [city, state].filter(Boolean).join(", ");
  const tail = [locality, zip].filter(Boolean).join(" ");
  return [street, unit, tail].filter(Boolean).join(", ");
}

/** Pulls the structured address fields off a rental unit record. */
export function addressOfUnit(unit = {}) {
  return {
    street: unit.addressStreet || unit.address_street || "",
    unit: unit.addressUnit || unit.address_unit || "",
    city: unit.addressCity || unit.address_city || "",
    state: unit.addressState || unit.address_state || "",
    zip: unit.addressZip || unit.address_zip || "",
  };
}
