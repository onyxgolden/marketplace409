// FORGE Doc-to-Overview — slice A: classification and exclusion checks.
//
// Pure, I/O-free domain logic. Every candidate document is classified
// before it can enter a manifest:
//
//   admit  — non-procedure reference material, permitted, within limits.
//   hold   — procedure-like (SOP, operating instruction, checklist,
//            step-by-step procedure) or ambiguous: a human must classify
//            it explicitly before it can proceed. Never silently admitted,
//            never silently transformed into training material.
//   reject — excluded content (tenant, financial/payment/ledger,
//            personnel-sensitive, secrets-bearing), missing permission,
//            oversized, or unreadable. Hard reject: no human override in
//            slice A, because the brief excludes these classes outright.
//
// Detectors are conservative named heuristics, not a perfect classifier:
// a clean reference document must admit, and each detector must fire on
// its own fixture (see the colocated tests). Anything genuinely ambiguous
// about procedure-ness lands in `hold`, where a curator decides.

import {
  MAX_DOCUMENT_CHARS,
  MAX_DOCUMENT_PAGES,
} from "./limits.js";

// --- Procedure signals (→ hold) -------------------------------------------

const STRONG_PROCEDURE_PATTERNS = [
  { code: "PROCEDURE_SOP", pattern: /standard operating procedure/i },
  { code: "PROCEDURE_SOP", pattern: /\bSOP\b/ },
  { code: "PROCEDURE_WORK_INSTRUCTION", pattern: /work instruction/i },
  { code: "PROCEDURE_OPERATING", pattern: /operating (instruction|procedure)s?/i },
  { code: "PROCEDURE_STEP_BY_STEP", pattern: /step-by-step/i },
];

const CHECKBOX_LINE = /^\s*[-*]\s*\[[ xX]\]/;
const NUMBERED_STEP_LINE = /^\s*(?:step\s+)?\d+[.)]\s+\S/i;
const STEP_HEADER_LINE = /^\s*step\s+\d+\b/i;

function procedureSignals(text) {
  const signals = [];
  for (const { code, pattern } of STRONG_PROCEDURE_PATTERNS) {
    if (pattern.test(text)) signals.push(code);
  }
  const lines = text.split(/\r?\n/);
  const checkboxCount = lines.filter((l) => CHECKBOX_LINE.test(l)).length;
  if (checkboxCount >= 2) signals.push("PROCEDURE_CHECKLIST");
  const numberedCount = lines.filter((l) => NUMBERED_STEP_LINE.test(l)).length;
  const headerCount = lines.filter((l) => STEP_HEADER_LINE.test(l)).length;
  if (numberedCount >= 3 || headerCount >= 2) signals.push("PROCEDURE_STEP_SEQUENCE");
  return [...new Set(signals)];
}

// --- Exclusion detectors (→ reject) ---------------------------------------

function luhnValid(digits) {
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (doubleIt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

const SECRET_PATTERNS = [
  { code: "SECRETS_PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { code: "SECRETS_API_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "SECRETS_API_KEY", pattern: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { code: "SECRETS_API_KEY", pattern: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { code: "SECRETS_PASSWORD", pattern: /\bpassword\s*[:=]\s*\S+/i },
  { code: "SECRETS_API_KEY", pattern: /\bapi[_-]?key\s*[:=]\s*\S+/i },
  { code: "SECRETS_TOKEN", pattern: /\bbearer\s+[A-Za-z0-9._-]{10,}\b/i },
];

function exclusionReasons(text) {
  const reasons = [];
  for (const { code, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) reasons.push(code);
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) reasons.push("PERSONNEL_SSN");
  // Card numbers: digit groups with separators, confirmed by Luhn so a
  // random long number (a part number, a quantity) does not trip it.
  const cardCandidates = text.match(/\b\d[0-9 -]{11,22}\d\b/g) ?? [];
  if (cardCandidates.some((c) => {
    const digits = c.replace(/[^0-9]/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
  })) reasons.push("FINANCIAL_CARD");
  if (/\baccount\s+number\s*[:#]?\s*\d{6,}/i.test(text)) reasons.push("FINANCIAL_ACCOUNT");
  if (/\b(routing\s+number|wire\s+transfer)\b/i.test(text) && /\d{6,}/.test(text)) {
    reasons.push("FINANCIAL_ACCOUNT");
  }
  // Tenant record: a tenant identity tied to rent/lease money, not a mere
  // mention of the word "tenant" in reference prose.
  if (/\btenant\b/i.test(text) && /\b(rent|lease)\b/i.test(text) && /\$\s?[\d,]+/.test(text)) {
    reasons.push("TENANT_RECORD");
  }
  // Ledger: a ledger named with balances/totals and money amounts.
  if (/\bledger\b/i.test(text) && /\b(balance|total)\b/i.test(text) && /\$\s?[\d,]+/.test(text)) {
    reasons.push("LEDGER");
  }
  return [...new Set(reasons)];
}

function isUnreadable(text) {
  if (typeof text !== "string" || text.trim().length === 0) return true;
  // Scanned/OCR-garbled material: a high replacement-character ratio means
  // the text cannot be trusted as the source's words.
  const replacements = (text.match(/�/g) ?? []).length;
  return replacements / Math.max(text.length, 1) > 0.05;
}

/**
 * Classifies one candidate document.
 * Input: { text, pageCount?, permissionGranted?, permissionBasis? }.
 * Output: { decision: "admit" | "hold" | "reject",
 *           reasons: [{ code, message }] }.
 * Order is deliberate: exclusions and hard limits reject first, procedure
 * signals hold next, everything else admits. A held document can only
 * proceed via an explicit, attributed human decision (see picker.js).
 */
export function classifyDocument(document) {
  const text = document?.text ?? "";
  const reasons = [];

  if (isUnreadable(text)) {
    return {
      decision: "reject",
      reasons: [{ code: "UNREADABLE", message: "Source text is empty or too garbled to trust (scanned/unreadable material is refused, never hallucinated)." }],
    };
  }
  for (const code of exclusionReasons(text)) {
    reasons.push({ code, message: `Excluded content class: ${code}.` });
  }
  if (reasons.length > 0) return { decision: "reject", reasons };

  if (document?.permissionGranted !== true) {
    return {
      decision: "reject",
      reasons: [{ code: "MISSING_PERMISSION", message: "Explicit source permission/licensing is required before a document can enter a source set." }],
    };
  }
  const charCount = text.length;
  if (charCount > MAX_DOCUMENT_CHARS) {
    return {
      decision: "reject",
      reasons: [{ code: "OVERSIZED", message: `Document has ${charCount} characters (limit ${MAX_DOCUMENT_CHARS}).` }],
    };
  }
  if (document?.pageCount != null && document.pageCount > MAX_DOCUMENT_PAGES) {
    return {
      decision: "reject",
      reasons: [{ code: "OVERSIZED", message: `Document has ${document.pageCount} pages (limit ${MAX_DOCUMENT_PAGES}).` }],
    };
  }

  const signals = procedureSignals(text);
  if (signals.length > 0) {
    return {
      decision: "hold",
      reasons: signals.map((code) => ({
        code,
        message: "Procedure-like material: held for explicit human classification; it is not admitted as reference material automatically.",
      })),
    };
  }
  return { decision: "admit", reasons: [] };
}
