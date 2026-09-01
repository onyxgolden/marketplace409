// Secret/PII exclusion for the *text* metadata that accompanies a screenshot (page title, readiness
// marker descriptions, error messages, route labels) -- distinct from redaction.mjs, which masks
// pixels/DOM text inside the captured image itself. Reuses the Engineering Brain's own scanners
// unchanged (scripts/engineering-brain/piiScanner.mjs, secretScanner.mjs) rather than re-implementing
// pattern matching a second time -- see the FB-UI-0 checkpoint report, "reuse scanForPii/scanForSecrets
// on any text evidence." Both are generic string-in/reason-codes-out functions with no
// Engineering-Brain-specific dependency.

import { scanForPii } from "../../engineering-brain/piiScanner.mjs";
import { scanForSecrets } from "../../engineering-brain/secretScanner.mjs";

export class EvidenceTextRejectedError extends Error {
  constructor(field, reasonCodes) {
    super(`Evidence text field "${field}" was rejected: ${reasonCodes.join(", ")}`);
    this.name = "EvidenceTextRejectedError";
    this.field = field;
    this.reasonCodes = reasonCodes;
  }
}

// Scans one field's text and throws (fail-closed) if either scanner flags it, rather than silently
// stripping/replacing the value -- a manifest field that failed this check should never be written at
// all, not written in a "best effort" redacted form, since the manifest is metadata, not the
// screenshot itself, and has no separate masking pass of its own.
export function assertEvidenceTextClean(field, text) {
  if (typeof text !== "string" || text.length === 0) return;
  const reasonCodes = [...scanForPii(text), ...scanForSecrets(text)];
  if (reasonCodes.length > 0) throw new EvidenceTextRejectedError(field, reasonCodes);
}

// Convenience for scanning every string-valued field of a manifest-entry-shaped object in one call,
// field name included in the thrown error so a caller can report exactly which piece of evidence was
// rejected.
export function assertEvidenceObjectClean(evidenceObject) {
  for (const [field, value] of Object.entries(evidenceObject)) {
    if (typeof value === "string") assertEvidenceTextClean(field, value);
  }
}
