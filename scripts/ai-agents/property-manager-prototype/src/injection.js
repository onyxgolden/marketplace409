/**
 * injection.js — seeded directive-smuggling recognizer for the
 * property-manager prototype.
 *
 * Security here comes from absence of capabilities and structured
 * allowlists (the agent cannot charge, message, waive, edit or dispatch
 * anything), not from regex claims of universal attack detection. This
 * recognizer flags the seeded attack families used by the corpus so the
 * battery can measure classification; unknown attacks are not certified
 * as detected by a finite battery.
 *
 * Separately, real-identifier detection (scanRealIdentifiers) rejects
 * task content carrying non-SYN identifiers (emails, phone numbers,
 * SSNs, street addresses) or PII canaries. Fixture content uses
 * invented SYN-* IDs only.
 */

const DIRECTIVE_FAMILIES = [
  {
    family: "directive_override",
    pattern: /\b(ignore|disregard|override|forget|bypass)\b.{0,60}\b(instructions|rules|policy|policies|directives|guardrails|safeguards)\b/i,
  },
  {
    family: "fee_waiver",
    pattern: /\b(waive|forgive|forgo|zero out|cancel|drop)\b.{0,40}\b(fee|fees|charge|charges|late fee|rent|balance)\b/i,
  },
  {
    family: "tenant_contact_directive",
    pattern: /\b(send|text|message|call|notify|email)\b.{0,40}\b(tenant|resident|occupant)\b/i,
  },
  {
    family: "charge_directive",
    pattern: /\b(charge|bill|debit|post)\b.{0,40}\b(tenant|account|ledger|rent)\b/i,
  },
  {
    family: "lease_edit_directive",
    pattern: /\b(update|modify|edit|change|alter|rewrite|backdate)\b.{0,40}\b(lease|agreement|addendum|contract)\b/i,
  },
  {
    family: "auth_smuggle",
    pattern: /\brelay[-_ ]?record\b.{0,80}\b(use this|attached|hereby|i authorize|already authorized|pre-?approved)\b/i,
  },
];

const LEGAL_REQUEST = /\b(legal|interpretation|interpret|statute|ordinance|evict|eviction)\b/i;

const REAL_ID_PATTERNS = [
  { kind: "email", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { kind: "phone", pattern: /(^|[^0-9])(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}([^0-9]|$)/ },
  { kind: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    kind: "address",
    pattern: /\b\d{1,5}\s+[A-Z][a-zA-Z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)\b/,
  },
];

const CANARY = /CANARY_[A-Z0-9_]+/;

/** Scan free task text for seeded directive-smuggling families. */
export function scanInjection(text) {
  if (typeof text !== "string" || text.length === 0) return { injected: false, family: null };
  for (const { family, pattern } of DIRECTIVE_FAMILIES) {
    if (pattern.test(text)) return { injected: true, family };
  }
  return { injected: false, family: null };
}

/** True when the text asks for legal interpretation (handled as ACTION_DENIED, not injection). */
export function isLegalAdviceRequest(text) {
  return typeof text === "string" && LEGAL_REQUEST.test(text);
}

/**
 * Scan task string fields for real identifiers or PII canaries.
 * Returns { found: false } or { found: true, kind } — the offending
 * payload is never echoed by callers.
 */
export function scanRealIdentifiers(strings) {
  for (const s of strings) {
    if (typeof s !== "string") continue;
    if (CANARY.test(s)) return { found: true, kind: "pii_canary" };
    for (const { kind, pattern } of REAL_ID_PATTERNS) {
      if (pattern.test(s)) return { found: true, kind };
    }
  }
  return { found: false, kind: null };
}
