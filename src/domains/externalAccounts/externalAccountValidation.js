// FORGE External Accounts Register — domain validation.
//
// Pure, no I/O. Mirrors the server-side rules so the UI can reject bad
// input before it ever reaches the RPCs, and so tests can prove the same
// secret-safety rules both layers enforce. The database trigger is the
// authority; this module is defense in depth, not a guarantee against
// every secret format.
//
// NEVER put a real password, API key, token, recovery code, or secret
// URL in any value validated here, in a fixture, or in a test — the
// test values below are obviously-fake shapes (short, patterned,
// or example domains), never live credentials.

export const EXTERNAL_ACCOUNT_PLAN_STATUSES = Object.freeze([
  "unknown",
  "free",
  "paid",
  "trial",
  "not_applicable",
]);

export const EXTERNAL_ACCOUNT_API_INTEGRATION_STATUSES = Object.freeze([
  "unknown",
  "integrated",
  "not_integrated",
  "not_applicable",
]);

export const EXTERNAL_ACCOUNT_RECORD_STATUSES = Object.freeze([
  "confirmed_account",
  "unverified_lead",
  "evaluating_service",
  "local_tool",
  "no_account_required",
  "closed",
]);

export const EXTERNAL_ACCOUNT_SETUP_STATUSES = Object.freeze([
  "unknown",
  "not_started",
  "in_progress",
  "blocked",
  "ready",
  "not_applicable",
  "retired",
]);

export const EXTERNAL_ACCOUNT_SOURCE_KINDS = Object.freeze([
  "reconstructed_inventory",
  "email_crosscheck",
  "manual",
]);

export const EXTERNAL_ACCOUNT_THREAD_STATES = Object.freeze([
  "none",
  "open",
  "blocked",
  "waiting",
  "complete",
  "abandoned",
]);

export const EXTERNAL_ACCOUNT_SEED_VERSION = "external_accounts_seed_v1";

// Same shapes the database trigger rejects (see migration
// 20261117140000). Kept as one list so a new pattern lands in both
// places together. Patterns match a *value that looks like a secret*,
// never a human-readable locator such as "1Password → FORGE".
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/, // OpenAI-style secret key
  /sk-ant-[A-Za-z0-9_-]{8,}/, // Anthropic secret key
  /gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub token
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, // PEM private key
  /(api[_-]?key|password|passwd|secret|token|auth)\s*[:=]\s*\S+/i, // key=value assignment
  /https?:\/\/[^/\s]*:[^/\s]+@/, // credential URL (user:pass@host)
  /[A-Za-z0-9]{32,}/, // long unbroken token-like blob (only when it looks generated, see below)
];

// A long unbroken blob is only treated as secret-like when it also
// carries mixed case + digits (a generated token), so ordinary long
// words and URLs do not trip the check.
function looksLikeGeneratedToken(value) {
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}

export function containsSecretLikeValue(value) {
  if (value === null || value === undefined) return false;
  const text = String(value);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern === SECRET_PATTERNS[SECRET_PATTERNS.length - 1]) {
      // Long-blob rule: check each whitespace-separated token.
      for (const token of text.split(/\s+/)) {
        if (token.length >= 32 && looksLikeGeneratedToken(token)) return true;
      }
      continue;
    }
    if (pattern.test(text)) return true;
  }
  return false;
}

// The database trigger rejects the same shapes; this helper exists so
// the UI and the tests can name WHICH field tripped, without ever
// echoing the offending value back (the message names the field only).
export function findSecretLikeFields(record, fieldNames) {
  const hits = [];
  for (const field of fieldNames) {
    const value = record?.[field];
    if (value !== null && value !== undefined && String(value).trim() !== "" && containsSecretLikeValue(value)) {
      hits.push(field);
    }
  }
  return hits;
}

const FREE_TEXT_FIELDS = [
  "provider_name",
  "purpose",
  "associated_app",
  "billing_arrangement",
  "credential_location",
  "source_reference",
  "notes",
];

const MAX_LENGTHS = {
  provider_name: 200,
  purpose: 500,
  associated_app: 200,
  billing_arrangement: 500,
  credential_location: 300,
  source_reference: 500,
  notes: 2000,
};

export function isValidAccountEmail(value) {
  if (value === null || value === undefined || String(value).trim() === "") return true;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value).trim());
}

function trimmed(value) {
  return value === null || value === undefined ? null : String(value).trim();
}

function checkCommon(payload, { forUpdate }) {
  const errors = [];
  if (!forUpdate) {
    if (!trimmed(payload.provider_name)) errors.push("Provider name is required.");
    if (!trimmed(payload.purpose)) errors.push("Purpose is required.");
    if (!trimmed(payload.associated_app)) errors.push("Associated app is required.");
  } else {
    for (const field of ["provider_name", "purpose", "associated_app"]) {
      if (field in payload && payload[field] !== null && trimmed(payload[field]) === "") {
        errors.push(`${field} cannot be blank.`);
      }
    }
  }
  for (const field of ["plan_status", "api_integration_status", "record_status", "setup_status", "source_kind"]) {
    if (payload[field] !== undefined && payload[field] !== null) {
      const allowed =
        field === "plan_status" ? EXTERNAL_ACCOUNT_PLAN_STATUSES
        : field === "api_integration_status" ? EXTERNAL_ACCOUNT_API_INTEGRATION_STATUSES
        : field === "record_status" ? EXTERNAL_ACCOUNT_RECORD_STATUSES
        : field === "setup_status" ? EXTERNAL_ACCOUNT_SETUP_STATUSES
        : EXTERNAL_ACCOUNT_SOURCE_KINDS;
      if (!allowed.includes(payload[field])) errors.push(`${field} is not a recognized value.`);
    }
  }
  if (payload.still_needed !== undefined && payload.still_needed !== null && typeof payload.still_needed !== "boolean") {
    errors.push("Still needed must be yes, no, or undecided.");
  }
  if (!isValidAccountEmail(payload.account_email)) {
    errors.push("Account email does not look like an email address.");
  }
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    if (payload[field] !== undefined && payload[field] !== null && String(payload[field]).length > max) {
      errors.push(`${field} is too long (max ${max} characters).`);
    }
  }
  const secretFields = findSecretLikeFields(payload, FREE_TEXT_FIELDS);
  for (const field of secretFields) {
    errors.push(`${field} looks like it contains a secret. Enter a location or description instead, never the secret itself.`);
  }
  return errors;
}

// Validate a create payload (all required fields) or an update payload
// (partial; only the fields present are checked). Returns { ok, errors }.
// `still_needed` accepts true/false/null (null = undecided).
export function validateExternalAccountPayload(payload, { forUpdate = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: ["Provide the account details as an object."] };
  }
  const errors = checkCommon(payload, { forUpdate });
  return { ok: errors.length === 0, errors };
}

export function validateExternalAccountThreadPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: ["Provide the work thread details as an object."] };
  }
  const errors = [];
  if (!trimmed(payload.title)) errors.push("Thread title is required.");
  if (payload.title !== undefined && payload.title !== null && String(payload.title).length > 500) {
    errors.push("Thread title is too long (max 500 characters).");
  }
  if (payload.reference !== undefined && payload.reference !== null && String(payload.reference).length > 1000) {
    errors.push("Thread reference is too long (max 1000 characters).");
  }
  if (payload.state !== undefined && payload.state !== null && !EXTERNAL_ACCOUNT_THREAD_STATES.includes(payload.state)) {
    errors.push("Thread state is not a recognized value.");
  }
  if (payload.next_action !== undefined && payload.next_action !== null && String(payload.next_action).length > 500) {
    errors.push("Next action is too long (max 500 characters).");
  }
  const secretFields = findSecretLikeFields(payload, ["title", "reference", "next_action"]);
  for (const field of secretFields) {
    errors.push(`${field} looks like it contains a secret. Enter a location or description instead, never the secret itself.`);
  }
  return { ok: errors.length === 0, errors };
}

// URL-safe slug for stable seed keys: external_accounts_seed_v1:<slug>.
export function slugifyProviderName(providerName) {
  return String(providerName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function seedKeyForSlug(slug) {
  return `${EXTERNAL_ACCOUNT_SEED_VERSION}:${slug}`;
}
