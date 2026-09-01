// Versioned, fail-closed UiFinding contract. Every field the checkpoint required is present and
// validated; nothing here is free-text-only where a caller could accidentally omit a required piece
// of evidence. `findingClass` is the structural mechanism that keeps a deterministic finding from
// ever being confused with a subjective design opinion (see FB-UI-2 report, "The system must
// distinguish deterministic findings from subjective design suggestions") -- every rule module in
// this checkpoint only ever produces "deterministic" findings; "subjective" exists in the schema for
// a possible future rule class, but nothing in FB-UI-2 emits it, and a "subjective" finding is
// validated to a *different, narrower* shape (no severity, since severity implies "this is a defect",
// which a subjective suggestion must never claim to be).

export const FINDING_CONTRACT_SCHEMA_VERSION = "1.0";

export const FINDING_CATEGORY = Object.freeze({
  HORIZONTAL_OVERFLOW: "horizontal_overflow",
  CLIPPED_OR_TRUNCATED_CONTROL: "clipped_or_truncated_control",
  UNREADABLE_CONTRAST: "unreadable_contrast",
  MISSING_DARK_MODE_FOREGROUND: "missing_dark_mode_foreground",
  OVERLAPPING_CONTENT: "overlapping_content",
  EMPTY_STATE_LAYOUT_DEFECT: "empty_state_layout_defect",
  INCONSISTENT_SPACING: "inconsistent_spacing",
  UNDERSIZED_TOUCH_TARGET: "undersized_touch_target",
  MISSING_ACCESSIBLE_NAME: "missing_accessible_name",
  KEYBOARD_FOCUS_VISIBILITY: "keyboard_focus_visibility",
  BREAKPOINT_REGRESSION: "breakpoint_regression",
  LOADING_ERROR_STATUS_COMMUNICATION: "loading_error_status_communication",
  MISLEADING_CHART: "misleading_chart",
});

export const FINDING_SEVERITY = Object.freeze({ LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" });
export const FINDING_CONFIDENCE = Object.freeze({ LOW: "low", MEDIUM: "medium", HIGH: "high" });
export const FINDING_CLASS = Object.freeze({ DETERMINISTIC: "deterministic", SUBJECTIVE: "subjective" });

export const PROPOSAL_STATUS = Object.freeze({
  NEW: "new", REVIEWED: "reviewed", REJECTED: "rejected",
  REVISION_REQUESTED: "revision_requested", PREVIEW_APPROVED: "preview_approved",
});

export class MalformedFindingError extends Error {
  constructor(reason) {
    super(`Malformed UiFinding: ${reason}`);
    this.name = "MalformedFindingError";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new MalformedFindingError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item));
}

export function validateUiFinding(finding) {
  if (typeof finding !== "object" || finding === null) fail("finding must be an object");
  if (!isNonEmptyString(finding.findingId)) fail("findingId must be a non-empty string");
  if (!isNonEmptyString(finding.ruleId)) fail("ruleId must be a non-empty string");
  if (!Object.values(FINDING_CATEGORY).includes(finding.category)) fail(`category must be one of ${Object.values(FINDING_CATEGORY).join(", ")}`);
  if (!Object.values(FINDING_CLASS).includes(finding.findingClass)) fail(`findingClass must be one of ${Object.values(FINDING_CLASS).join(", ")}`);

  // application and route
  if (!isNonEmptyString(finding.application)) fail("application must be a non-empty string");
  if (!isNonEmptyString(finding.routeId)) fail("routeId must be a non-empty string");
  if (!isNonEmptyString(finding.routePath)) fail("routePath must be a non-empty string");
  // viewport
  if (!isNonEmptyString(finding.viewport)) fail("viewport must be a non-empty string");
  // screenshot evidence
  if (!/^sha256:[0-9a-f]{64}$/.test(finding.screenshotHash || "")) fail("screenshotHash must be a sha256:<hex> string (the screenshot evidence reference)");
  // affected component or probable source files
  if (!isStringArray(finding.probableSourceFiles)) fail("probableSourceFiles must be a non-empty array of strings");
  if (finding.affectedComponent !== null && !isNonEmptyString(finding.affectedComponent)) fail("affectedComponent must be a non-empty string or null");

  if (finding.findingClass === FINDING_CLASS.DETERMINISTIC) {
    if (!Object.values(FINDING_SEVERITY).includes(finding.severity)) fail(`severity must be one of ${Object.values(FINDING_SEVERITY).join(", ")} for a deterministic finding`);
  } else if (finding.severity != null) {
    // A subjective suggestion carrying a severity would read as "this is a defect of severity X" --
    // structurally disallowed, not merely discouraged, per the checkpoint's own requirement.
    fail("severity must be omitted for a subjective finding -- a subjective suggestion must never be represented as a defect");
  }
  if (!Object.values(FINDING_CONFIDENCE).includes(finding.confidence)) fail(`confidence must be one of ${Object.values(FINDING_CONFIDENCE).join(", ")}`);

  // plain-language explanation / proposed improvement / validation requirements / prohibited scope / rollback description
  if (!isNonEmptyString(finding.explanation)) fail("explanation must be a non-empty string");
  if (!isNonEmptyString(finding.proposedImprovement)) fail("proposedImprovement must be a non-empty string");
  if (!isStringArray(finding.validationRequirements)) fail("validationRequirements must be a non-empty array of strings");
  if (!isStringArray(finding.prohibitedScope)) fail("prohibitedScope must be a non-empty array of strings");
  if (!isNonEmptyString(finding.rollbackDescription)) fail("rollbackDescription must be a non-empty string");

  if (!Object.values(PROPOSAL_STATUS).includes(finding.status)) fail(`status must be one of ${Object.values(PROPOSAL_STATUS).join(", ")}`);
  if (!isNonEmptyString(finding.detectedAt) || Number.isNaN(Date.parse(finding.detectedAt))) fail("detectedAt must be a valid ISO-8601 timestamp");

  return Object.freeze({
    findingId: finding.findingId, ruleId: finding.ruleId, category: finding.category, findingClass: finding.findingClass,
    application: finding.application, routeId: finding.routeId, routePath: finding.routePath, viewport: finding.viewport,
    screenshotHash: finding.screenshotHash, probableSourceFiles: Object.freeze([...finding.probableSourceFiles]),
    affectedComponent: finding.affectedComponent ?? null,
    severity: finding.findingClass === FINDING_CLASS.DETERMINISTIC ? finding.severity : null,
    confidence: finding.confidence, explanation: finding.explanation, proposedImprovement: finding.proposedImprovement,
    validationRequirements: Object.freeze([...finding.validationRequirements]),
    prohibitedScope: Object.freeze([...finding.prohibitedScope]), rollbackDescription: finding.rollbackDescription,
    status: finding.status, detectedAt: finding.detectedAt,
  });
}

export function validateFindingsManifest(manifest) {
  if (typeof manifest !== "object" || manifest === null) fail("manifest must be an object");
  if (manifest.schemaVersion !== FINDING_CONTRACT_SCHEMA_VERSION) fail(`schemaVersion must be exactly "${FINDING_CONTRACT_SCHEMA_VERSION}"`);
  if (!Array.isArray(manifest.findings)) fail("findings must be an array");
  const findings = manifest.findings.map((finding) => validateUiFinding(finding))
    .sort((a, b) => a.findingId.localeCompare(b.findingId));
  return Object.freeze({ schemaVersion: FINDING_CONTRACT_SCHEMA_VERSION, findings: Object.freeze(findings) });
}
