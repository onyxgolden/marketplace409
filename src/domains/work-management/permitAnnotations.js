// FORGE Work Management — Work Package Planner, slice 3 domain logic
// for permit LINK annotations (pure functions, no I/O).
//
// A permit annotation is a LINK, not a permit record: a label plus an
// HTTPS URL, with an optional permit reference and note. There is no
// permit entity, lifecycle, status, date, or approval in this slice.
//
// URL rule (syntax-only — NO network fetch/DNS/HEAD at save; a dead
// link stays saved and editable): the URL must be an absolute HTTPS
// URL with a nonempty DNS hostname. Rejected: any non-HTTPS scheme,
// credentials in the URL, localhost, loopback, and private IP
// literals (IPv4 and IPv6). Normalization lowercases the host (the
// URL parser does that) and preserves the meaningful path and query;
// the stored value is the parser's href, so the same link always
// stores the same way. The database RPC enforces the same rule at the
// boundary (see the slice-3 migration), so a direct RPC caller gets
// the same verdict as the UI.

export const PERMIT_ANNOTATION_LIMITS = Object.freeze({
  label: 160,
  url: 2048,
  permitReference: 120,
  note: 1000,
  reason: 2000,
});

export const PERMIT_ANNOTATION_TARGETS = Object.freeze(["package", "drawing"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIPv4Literal(hostname) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function isPrivateOrLoopbackIPv4(hostname) {
  if (!isIPv4Literal(hostname)) return false;
  const octets = hostname.split(".").map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets;
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8 ("this network")
  return false;
}

function isPrivateOrLoopbackIPv6(hostname) {
  // The URL parser hands back IPv6 literals WITH brackets
  // ("[::1]"); strip them before comparing.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "::") return true; // loopback / unspecified
  if (host.startsWith("fe80:")) return true; // link-local fe80::/10
  if (/^f[c-d][0-9a-f]{2}:/.test(host)) return true; // unique-local fc00::/7
  return false;
}

/**
 * Validates and normalizes a permit-link URL. Returns { ok: true, url }
 * with the normalized href, or { ok: false, error } with a plain-English
 * reason. Pure and synchronous — it never fetches, resolves DNS, or
 * performs a HEAD request.
 */
export function normalizePermitAnnotationUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, error: "Enter a web address for the permit link." };
  }
  const trimmed = value.trim();
  if (trimmed.length > PERMIT_ANNOTATION_LIMITS.url) {
    return { ok: false, error: `Web address must be at most ${PERMIT_ANNOTATION_LIMITS.url} characters.` };
  }
  // The URL parser percent-encodes spaces, so check the raw string
  // first — a space in what was typed is a typo, not part of a URL.
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, error: "Web address must not contain spaces." };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a valid secure (https) web address." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "Permit links must use a secure (https) web address." };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, error: "Web address must not contain a username or password." };
  }
  const hostname = parsed.hostname;
  if (!hostname) {
    return { ok: false, error: "Enter a valid secure (https) web address." };
  }
  const lowerHost = hostname.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost")) {
    return { ok: false, error: "Permit links cannot point at this machine (localhost)." };
  }
  if (isPrivateOrLoopbackIPv4(hostname) || isPrivateOrLoopbackIPv6(hostname)) {
    return { ok: false, error: "Permit links cannot point at a private or loopback address." };
  }
  return { ok: true, url: parsed.href };
}

function validateLabel(value, errors) {
  if (!isNonEmptyString(value)) {
    errors.push("Label is required.");
    return null;
  }
  const label = value.trim();
  if (label.length > PERMIT_ANNOTATION_LIMITS.label) {
    errors.push(`Label must be at most ${PERMIT_ANNOTATION_LIMITS.label} characters.`);
    return null;
  }
  return label;
}

function validateOptionalText(value, field, maxLength, errors) {
  if (value == null) return null;
  if (typeof value !== "string") {
    errors.push(`${field} must be text.`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters.`);
    return null;
  }
  return trimmed;
}

function validateReason(value, errors) {
  return validateOptionalText(value, "Reason", PERMIT_ANNOTATION_LIMITS.reason, errors);
}

/**
 * Validates a create input. Returns { ok, errors, values } where values
 * holds the normalized fields (label, url, permitReference, note) when
 * ok. The target (package or drawing, and which drawing) is proven by
 * the application service against the package — never trusted from
 * this validation alone.
 */
export function validatePermitAnnotationInput(input) {
  const errors = [];
  if (input?.targetKind != null && !PERMIT_ANNOTATION_TARGETS.includes(input.targetKind)) {
    errors.push("Permit links attach to a package or a drawing.");
  }
  const label = validateLabel(input?.label, errors);
  let url = null;
  if (input?.url == null || (typeof input.url === "string" && input.url.trim() === "")) {
    errors.push("Enter a web address for the permit link.");
  } else {
    const normalized = normalizePermitAnnotationUrl(input.url);
    if (!normalized.ok) errors.push(normalized.error);
    else url = normalized.url;
  }
  const permitReference = validateOptionalText(
    input?.permitReference, "Permit reference", PERMIT_ANNOTATION_LIMITS.permitReference, errors);
  const note = validateOptionalText(
    input?.note, "Note", PERMIT_ANNOTATION_LIMITS.note, errors);
  if (errors.length > 0) return { ok: false, errors, values: null };
  return { ok: true, errors: [], values: { label, url, permitReference, note } };
}

/**
 * Validates an update patch. `expectedVersion` is required (the
 * optimistic guard — the application service refuses to update
 * without it). At least one of label/url/permitReference/note must be
 * supplied; absent fields keep their current value (null clears an
 * optional field). A reason is optional but length-capped. Returns
 * { ok, errors, values } where values holds only the supplied fields,
 * normalized (absent fields are `undefined`, not null).
 */
export function validatePermitAnnotationUpdateInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  const hasChange = input?.label !== undefined
    || input?.url !== undefined
    || input?.permitReference !== undefined
    || input?.note !== undefined;
  if (!hasChange) errors.push("No changes were supplied.");
  const values = {};
  if (input?.label !== undefined) {
    values.label = validateLabel(input.label, errors);
  }
  if (input?.url !== undefined) {
    if (input.url == null || (typeof input.url === "string" && input.url.trim() === "")) {
      errors.push("Enter a web address for the permit link.");
    } else {
      const normalized = normalizePermitAnnotationUrl(input.url);
      if (!normalized.ok) errors.push(normalized.error);
      else values.url = normalized.url;
    }
  }
  if (input?.permitReference !== undefined) {
    values.permitReference = validateOptionalText(
      input.permitReference, "Permit reference", PERMIT_ANNOTATION_LIMITS.permitReference, errors);
  }
  if (input?.note !== undefined) {
    values.note = validateOptionalText(
      input.note, "Note", PERMIT_ANNOTATION_LIMITS.note, errors);
  }
  if (input?.reason != null) {
    values.reason = validateReason(input.reason, errors);
  }
  if (errors.length > 0) return { ok: false, errors, values: null };
  return { ok: true, errors: [], values };
}

/**
 * Validates a retire input. `expectedVersion` is required (the
 * optimistic guard). A reason is optional but length-capped.
 */
export function validatePermitAnnotationRetireInput(input) {
  const errors = [];
  if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion < 1) {
    errors.push("expectedVersion is required and must be a positive whole number.");
  }
  let reason = null;
  if (input?.reason != null) {
    reason = validateReason(input.reason, errors);
  }
  if (errors.length > 0) return { ok: false, errors, values: null };
  return { ok: true, errors: [], values: { reason } };
}

export function isActivePermitAnnotation(annotation) {
  return annotation?.retiredAt == null;
}
