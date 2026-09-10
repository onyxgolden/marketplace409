// Versioned, runtime-validated contract for a single tester-feedback entry (FORGE_PRODUCTION_USER_
// FEEDBACK_AND_ACTIVATION_PLAN.md, Phase 1 "Evidence schema"). Mirrors scripts/repair-controller/
// repairContracts.mjs and scripts/ui-improvement-manager/screenshot-evidence/screenshotManifestContracts.mjs's
// validation style deliberately (fail closed on any unknown/malformed field, return a frozen object with
// a fixed key order) so this subsystem stays recognizably consistent to a reader, without literally
// importing repair- or screenshot-specific types that would be a category error for tester feedback.
// A feedback entry's evidenceRefs may reference a screenshot manifest entry by id, but this module has
// no dependency on that manifest's shape -- the two evolve independently.
//
// This is a capture-time contract only: it validates the shape of one feedback entry. Collection UI,
// persistence, duplicate detection, and triage automation are separate, later, separately-authorized
// work (Phase 1's own scope note: "define the tester-mission documents and the evidence/feedback-
// capture contract only").

export const FEEDBACK_ENTRY_SCHEMA_VERSION = "1.0";

export class MalformedFeedbackEntryError extends Error {
  constructor(reason) {
    super(`Malformed FeedbackEntry: ${reason}`);
    this.name = "MalformedFeedbackEntryError";
    this.reason = reason;
  }
}

// The five roles the plan's Phase 1 missions are written against, plus the plan's own named optional
// personas -- included here only as valid shape values; whether a role is actually production-ready
// to recruit for is a Phase 1 doc/process decision, not something this contract enforces.
export const TESTER_ROLE = Object.freeze({
  LANDLORD: "landlord",
  CO_OWNER: "co_owner",
  TENANT: "tenant",
  PRIVATE_FINANCING_BORROWER: "private_financing_borrower",
  RV_SHORT_TERM_LANDLORD: "rv_short_term_landlord",
  PROPERTY_MANAGER: "property_manager",
  BOOKKEEPER: "bookkeeper",
  READ_ONLY: "read_only",
});

export const FEEDBACK_ENVIRONMENT = Object.freeze({ LOCAL: "local", PREVIEW: "preview", PRODUCTION: "production" });

export const MISSION_STATE = Object.freeze({ STARTED: "started", COMPLETED: "completed", ABANDONED: "abandoned" });

// From the plan's own severity list: "blocker, serious, confusing, cosmetic, enhancement".
export const FEEDBACK_SEVERITY = Object.freeze({
  BLOCKER: "blocker", SERIOUS: "serious", CONFUSING: "confusing", COSMETIC: "cosmetic", ENHANCEMENT: "enhancement",
});

// From the plan's evidence schema: "Financial/security/data-integrity risk flags".
export const FEEDBACK_RISK_FLAG = Object.freeze({
  FINANCIAL: "financial", SECURITY: "security", DATA_INTEGRITY: "data_integrity",
});

function fail(reason) {
  throw new MalformedFeedbackEntryError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableNonEmptyString(value) {
  return value === null || value === undefined || isNonEmptyString(value);
}

// "Route/component/API/domain involved" (plan, Phase 1 evidence schema) -- at least one of the four
// must actually identify something, or the entry can't be mapped to a workflow/system at all.
function validateInvolvedSurface(surface) {
  if (!isPlainObject(surface)) fail("involvedSurface must be an object");
  const { route = null, component = null, api = null, domain = null } = surface;
  if (!isNullableNonEmptyString(route)) fail("involvedSurface.route must be a non-empty string or null");
  if (!isNullableNonEmptyString(component)) fail("involvedSurface.component must be a non-empty string or null");
  if (!isNullableNonEmptyString(api)) fail("involvedSurface.api must be a non-empty string or null");
  if (!isNullableNonEmptyString(domain)) fail("involvedSurface.domain must be a non-empty string or null");
  if (route === null && component === null && api === null && domain === null) {
    fail("involvedSurface must identify at least one of route, component, api, or domain");
  }
  return Object.freeze({ route, component, api, domain });
}

// "Resolution commit and verification evidence, once available" -- nullable because most entries are
// captured long before any fix exists.
function validateResolution(resolution) {
  if (resolution === null || resolution === undefined) return null;
  if (!isPlainObject(resolution)) fail("resolution must be an object or null");
  if (!isNonEmptyString(resolution.commitSha)) fail("resolution.commitSha must be a non-empty string");
  if (!isNonEmptyString(resolution.verificationEvidenceRef)) fail("resolution.verificationEvidenceRef must be a non-empty string");
  return Object.freeze({ commitSha: resolution.commitSha, verificationEvidenceRef: resolution.verificationEvidenceRef });
}

export function validateFeedbackEntry(entry) {
  if (!isPlainObject(entry)) fail("must be an object");
  if (!isNonEmptyString(entry.feedbackId)) fail("feedbackId must be a non-empty string");
  if (!isNonEmptyString(entry.workflowId)) fail("workflowId must be a non-empty string");
  if (!isNonEmptyString(entry.stepId)) fail("stepId must be a non-empty string");
  if (!Object.values(TESTER_ROLE).includes(entry.testerRole)) {
    fail(`testerRole must be one of ${Object.values(TESTER_ROLE).join(", ")}`);
  }
  if (!Object.values(FEEDBACK_ENVIRONMENT).includes(entry.environment)) {
    fail(`environment must be one of ${Object.values(FEEDBACK_ENVIRONMENT).join(", ")}`);
  }
  if (!isNonEmptyString(entry.buildRef)) fail("buildRef must be a non-empty string");
  if (!Object.values(MISSION_STATE).includes(entry.state)) {
    fail(`state must be one of ${Object.values(MISSION_STATE).join(", ")}`);
  }
  if (!isNonEmptyString(entry.expectedResult)) fail("expectedResult must be a non-empty string");
  if (!isNonEmptyString(entry.actualResult)) fail("actualResult must be a non-empty string");
  if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds < 0) {
    fail("durationSeconds must be a non-negative number");
  }
  if (!Number.isInteger(entry.attemptCount) || entry.attemptCount < 1) {
    fail("attemptCount must be a positive integer");
  }
  if (!isStringArray(entry.evidenceRefs)) fail("evidenceRefs must be an array of strings");
  if (entry.userComment !== null && entry.userComment !== undefined && typeof entry.userComment !== "string") {
    fail("userComment must be a string or null when present");
  }
  const involvedSurface = validateInvolvedSurface(entry.involvedSurface);
  if (!Object.values(FEEDBACK_SEVERITY).includes(entry.severity)) {
    fail(`severity must be one of ${Object.values(FEEDBACK_SEVERITY).join(", ")}`);
  }
  if (typeof entry.reproducible !== "boolean") fail("reproducible must be a boolean");
  if (!isStringArray(entry.reproSteps)) fail("reproSteps must be an array of strings");
  // A claim of reproducibility with no steps to reproduce it is not actionable evidence.
  if (entry.reproducible && entry.reproSteps.length === 0) {
    fail("reproSteps must be non-empty when reproducible is true");
  }
  if (!isStringArray(entry.riskFlags)) fail("riskFlags must be an array of strings");
  for (const flag of entry.riskFlags) {
    if (!Object.values(FEEDBACK_RISK_FLAG).includes(flag)) {
      fail(`riskFlags entries must be one of ${Object.values(FEEDBACK_RISK_FLAG).join(", ")}, got "${flag}"`);
    }
  }
  if (!isNullableNonEmptyString(entry.relatedFeedbackId)) fail("relatedFeedbackId must be a non-empty string or null");
  const resolution = validateResolution(entry.resolution);
  if (!isNonEmptyString(entry.recordedAt)) fail("recordedAt must be a non-empty string");

  return Object.freeze({
    schemaVersion: FEEDBACK_ENTRY_SCHEMA_VERSION,
    feedbackId: entry.feedbackId,
    workflowId: entry.workflowId,
    stepId: entry.stepId,
    testerRole: entry.testerRole,
    environment: entry.environment,
    buildRef: entry.buildRef,
    state: entry.state,
    expectedResult: entry.expectedResult,
    actualResult: entry.actualResult,
    durationSeconds: entry.durationSeconds,
    attemptCount: entry.attemptCount,
    evidenceRefs: Object.freeze([...entry.evidenceRefs]),
    userComment: entry.userComment ?? null,
    involvedSurface,
    severity: entry.severity,
    reproducible: entry.reproducible,
    reproSteps: Object.freeze([...entry.reproSteps]),
    riskFlags: Object.freeze([...entry.riskFlags]),
    relatedFeedbackId: entry.relatedFeedbackId ?? null,
    resolution,
    recordedAt: entry.recordedAt,
  });
}
