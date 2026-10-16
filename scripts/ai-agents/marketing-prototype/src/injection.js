/**
 * injection.js — seeded injection-family recognizer (classifier only).
 *
 * Fixture records are data, including instructions, finality claims and
 * purported authority. This recognizer flags the SEEDED families below so
 * their text — and anything it supports — is quarantined. It is not a
 * boundary and makes no claim of universal attack detection: safety comes
 * from the absence of execution/publish capabilities and from never
 * upgrading quarantined evidence.
 *
 * Families:
 *   FORGED_AUDITOR  — forged auditor/metric-override instructions
 *   FAKE_AUTHORITY  — prose claiming Jason's approval/authority
 *   PII_CANARY      — seeded sensitive-data canary (SSN-like pattern)
 *   PUBLISH_DIRECTIVE — instructions to publish / go live / send
 *   EXFIL_DIRECTIVE — instructions to send/forward data outward
 */

export const INJECTION_FAMILIES = {
  FORGED_AUDITOR: [
    "auditor override",
    "override the metrics",
    "inflate",
    "mark as approved",
    "approved by auditor",
    "restate as",
    "adjust the ctr",
    "adjust the roas",
  ],
  FAKE_AUTHORITY: [
    "per jason's order",
    "jason approved",
    "jason said",
    "approved by jason",
    "jason authorized",
    "jason signed off",
  ],
  PUBLISH_DIRECTIVE: [
    "publish now",
    "go live",
    "post this",
    "send this out",
    "launch the campaign",
    "push to production",
  ],
  EXFIL_DIRECTIVE: ["send to ", "email this to", "forward to ", "exfiltrate"],
};

const PII_PATTERNS = [/\b\d{3}-\d{2}-\d{4}\b/, /social security number/i];

/**
 * Scan one text value. Returns the matched family name or null.
 * Matching is case-insensitive substring (seeded families only).
 */
export function detectInjection(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const low = text.toLowerCase();
  for (const [family, needles] of Object.entries(INJECTION_FAMILIES)) {
    for (const n of needles) {
      if (low.includes(n)) return family;
    }
  }
  for (const re of PII_PATTERNS) {
    if (re.test(text)) return "PII_CANARY";
  }
  return null;
}

/**
 * Free-text fields scanned per fixture kind: [fieldName, ...].
 * IDs, enums, timestamps and numeric fields are never scanned.
 */
export const SCANNED_FIELDS = {
  campaigns: ["name", "notes"],
  events: [],
  aggregate_counts: ["notes"],
  bindings: [],
  header_claims: ["rationale"],
  content_brief: ["product_label"],
  completeness: ["notes"],
  taxonomy: [],
  benefit_registry: [],
};

/** Scan a validated row; returns [{field, family}] for every hit. */
export function scanRow(kind, row) {
  const hits = [];
  for (const field of SCANNED_FIELDS[kind] ?? []) {
    const v = row[field];
    if (typeof v !== "string") continue;
    const family = detectInjection(v);
    if (family) hits.push({ field, family });
  }
  return hits;
}
