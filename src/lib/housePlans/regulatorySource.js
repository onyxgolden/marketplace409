// HOUSE PLANS (HP-L1) reference metadata model.
//
// Link-only regulatory reference layer: FORGE stores factual metadata about
// regulatory sources -- titles, section identifiers, issuing
// authority/jurisdiction, edition/effective dates, official URLs, topic tags,
// provenance, retrieval/verification dates -- and NEVER summary, content,
// explanation, or paraphrase text about regulatory requirements. This module
// is the pure domain twin of the house_plans_regulatory_sources table: the
// jurisdiction-state vocabulary, the metadata field list, validation, and
// normalization. No I/O, no DB, no network.

export const JURISDICTION_STATES = Object.freeze({
  UNRESOLVED: "UNRESOLVED",
  LIKELY: "LIKELY",
  CONFIRMED_BY_USER: "CONFIRMED_BY_USER",
  VERIFIED_SOURCE: "VERIFIED_SOURCE",
});

export const DEFAULT_JURISDICTION_STATE = JURISDICTION_STATES.UNRESOLVED;

// Factual metadata fields only. Deliberately absent: summary, content,
// description, explanation, paraphrase, interpretation -- the link-only scope
// forbids storing FORGE-authored or copied explanatory text about
// regulatory requirements.
export const REGULATORY_SOURCE_FIELDS = Object.freeze([
  "title",
  "sectionIdentifier",
  "issuingAuthority",
  "jurisdiction",
  "edition",
  "effectiveDate",
  "officialUrl",
  "topicTags",
  "provenance",
  "retrievalDate",
  "verificationDate",
  "jurisdictionState",
]);

// Fields that must never appear on a regulatory source record. Their
// presence would violate the link-only boundary (no FORGE-authored code
// summaries, no copied third-party text).
export const FORBIDDEN_CONTENT_FIELDS = Object.freeze([
  "summary",
  "content",
  "description",
  "explanation",
  "paraphrase",
  "interpretation",
]);

const REQUIRED_FIELDS = Object.freeze(["title", "issuingAuthority", "officialUrl"]);

const OPTIONAL_STRING_FIELDS = Object.freeze([
  "sectionIdentifier",
  "jurisdiction",
  "edition",
  "provenance",
]);

const DATE_FIELDS = Object.freeze(["effectiveDate", "retrievalDate", "verificationDate"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isAbsent(value) {
  return value === undefined || value === null;
}

export function isValidOfficialUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDateValue(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "string" && value.trim().length > 0) {
    return !Number.isNaN(new Date(value).getTime());
  }
  return false;
}

// Pure validation of a regulatory-source metadata record. Returns
// { ok, errors }. Never throws on malformed input.
export function validateRegulatorySource(input) {
  const errors = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["record must be an object"] };
  }

  for (const field of FORBIDDEN_CONTENT_FIELDS) {
    if (!isAbsent(input[field])) {
      errors.push(`"${field}" is not allowed: regulatory sources are metadata-only (title + link), never explanatory text`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!isNonEmptyString(input[field])) {
      errors.push(`"${field}" is required and must be a non-empty string`);
    }
  }

  if (!isAbsent(input.officialUrl) && isNonEmptyString(input.officialUrl) && !isValidOfficialUrl(input.officialUrl)) {
    errors.push('"officialUrl" must be a valid https URL');
  }

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (!isAbsent(input[field]) && !isNonEmptyString(input[field])) {
      errors.push(`"${field}" must be a non-empty string when provided`);
    }
  }

  if (!isAbsent(input.jurisdictionState) && !Object.values(JURISDICTION_STATES).includes(input.jurisdictionState)) {
    errors.push(`"jurisdictionState" must be one of: ${Object.values(JURISDICTION_STATES).join(", ")}`);
  }

  if (!isAbsent(input.topicTags)) {
    if (!Array.isArray(input.topicTags)) {
      errors.push('"topicTags" must be an array of non-empty strings when provided');
    } else {
      for (const tag of input.topicTags) {
        if (!isNonEmptyString(tag)) {
          errors.push('"topicTags" must contain only non-empty strings');
          break;
        }
      }
    }
  }

  for (const field of DATE_FIELDS) {
    if (!isAbsent(input[field]) && !isValidDateValue(input[field])) {
      errors.push(`"${field}" must be a valid date when provided`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Pure normalization: trims string fields, defaults topicTags to [] and
// jurisdictionState to UNRESOLVED. Returns a new object; input is untouched.
export function normalizeRegulatorySource(input) {
  const record = typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};
  const out = {};

  const copyTrimmed = (field) => {
    if (!isAbsent(record[field]) && typeof record[field] === "string") {
      out[field] = record[field].trim();
    } else if (!isAbsent(record[field])) {
      out[field] = record[field];
    }
  };

  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_STRING_FIELDS]) {
    copyTrimmed(field);
  }
  for (const field of DATE_FIELDS) {
    if (!isAbsent(record[field])) out[field] = record[field];
  }

  out.topicTags = Array.isArray(record.topicTags)
    ? record.topicTags.filter(isNonEmptyString).map((tag) => tag.trim())
    : [];
  out.jurisdictionState = Object.values(JURISDICTION_STATES).includes(record.jurisdictionState)
    ? record.jurisdictionState
    : DEFAULT_JURISDICTION_STATE;

  return out;
}
