/**
 * Field verification (Work Package Planner) — pure domain rules.
 *
 * A field verification is a dated, evidence-backed human attestation
 * that a portion of planned work was physically checked against a
 * named plan and recorded actuals. One record per observation: the
 * primary attach target is one work step in one work package, the
 * secondary one takeoff line. The source snapshot is taken
 * server-side at create time (step version + planned hours, or line
 * planned quantity/unit + installed-as-of total + contributing
 * progress entry ids + digest) and the submit/accept RPCs recompute
 * the source fingerprint live and refuse when stale — so a plan
 * change after the review cannot be silently accepted.
 *
 * This module is deliberately dependency-free and importable by
 * both server and browser code. It holds the state machine, the
 * field validation, the variance math, and the error-code catalogue.
 * It never touches the database, never computes a source fingerprint
 * (the server owns that), and never decides authorization — the
 * write RPCs gate on has_workspace_access (owner or active
 * co-owner) and enforce two-person integrity internally.
 *
 * Reference: results/chatgpt/work-package-planner-field-verification-
 * scope-2026-11-16.md (brief §§3-5, §9) and
 * supabase/migrations/20261120000000_forge_work_field_verifications.sql.
 */

export const FIELD_VERIFICATION_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'ACCEPTED',
  'RETURNED',
  'REJECTED',
  'RETIRED',
]);

export const FIELD_VERIFICATION_TARGET_TYPES = Object.freeze([
  'WORK_STEP',
  'TAKEOFF_LINE',
]);

export const FIELD_VERIFICATION_WORK_LOCATIONS = Object.freeze([
  'SHOP',
  'FIELD',
]);

export const FIELD_VERIFICATION_PHYSICAL_COMPLETIONS = Object.freeze([
  'NOT_COMPLETE',
  'PARTIALLY_COMPLETE',
  'COMPLETE',
  'UNABLE_TO_VERIFY',
]);

export const FIELD_VERIFICATION_LINK_KINDS = Object.freeze([
  'BUST',
  'CHANGE_ORDER',
  'PROGRESS_ENTRY',
  'DRAWING',
]);

export const FIELD_VERIFICATION_DECISION_ACTIONS = Object.freeze([
  'submit',
  'accept',
  'return',
  'reject',
]);

export const FIELD_VERIFICATION_TERMINAL_PACKAGE_STATUSES = Object.freeze([
  'cancelled',
  'verified_closed',
]);

/** Legal transitions, from -> [to, ...]. */
export const FIELD_VERIFICATION_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['SUBMITTED', 'RETIRED']),
  SUBMITTED: Object.freeze(['ACCEPTED', 'RETURNED', 'REJECTED', 'RETIRED']),
  ACCEPTED: Object.freeze(['RETIRED']),
  RETURNED: Object.freeze(['SUBMITTED', 'RETIRED']),
  REJECTED: Object.freeze(['RETIRED']),
  RETIRED: Object.freeze([]),
});

export function isFieldVerificationTerminalPackageStatus(status) {
  return FIELD_VERIFICATION_TERMINAL_PACKAGE_STATUSES.includes(status);
}

export function canFieldVerificationTransition(fromStatus, toStatus) {
  return (FIELD_VERIFICATION_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function isFieldVerificationStatus(status) {
  return FIELD_VERIFICATION_STATUSES.includes(status);
}

export const FIELD_VERIFICATION_ERROR_CODES = Object.freeze({
  INVALID_TARGET: 'WPPFV_INVALID_TARGET',
  TARGET_RETIRED: 'WPPFV_TARGET_RETIRED',
  INVALID_VALUE: 'WPPFV_INVALID_VALUE',
  INVALID_EVIDENCE: 'WPPFV_INVALID_EVIDENCE',
  INCOMPLETE_OBSERVATION: 'WPPFV_INCOMPLETE_OBSERVATION',
  INVALID_TRANSITION: 'WPPFV_INVALID_TRANSITION',
  VERSION_CONFLICT: 'WPPFV_VERSION_CONFLICT',
  SELF_REVIEW: 'WPPFV_SELF_REVIEW',
  SOURCE_CHANGED: 'WPPFV_SOURCE_CHANGED',
  PACKAGE_TERMINAL: 'WPPFV_PACKAGE_TERMINAL',
  PACKAGE_NOT_FOUND: 'WPPFV_PACKAGE_NOT_FOUND',
  VERIFICATION_NOT_FOUND: 'WPPFV_VERIFICATION_NOT_FOUND',
  LINK_NOT_FOUND: 'WPPFV_LINK_NOT_FOUND',
  LINK_EXISTS: 'WPPFV_LINK_EXISTS',
  LINK_RETIRED: 'WPPFV_LINK_RETIRED',
  DUPLICATE_ACTIVE: 'WPPFV_DUPLICATE_ACTIVE',
  RETIRED: 'WPPFV_RETIRED',
  INVALID_ACTION: 'WPPFV_INVALID_ACTION',
  REASON_REQUIRED: 'WPPFV_REASON_REQUIRED',
  REASON_TOO_LONG: 'WPPFV_REASON_TOO_LONG',
  REVIEW_NOTE_REQUIRED: 'WPPFV_REVIEW_NOTE_REQUIRED',
  INVALID_ACTOR: 'WPPFV_INVALID_ACTOR',
  WORKSPACE_FORBIDDEN: 'WPPFV_WORKSPACE_FORBIDDEN',
  IDEMPOTENCY_CONFLICT: 'WPPFV_IDEMPOTENCY_CONFLICT',
  NOT_APPLIED: 'WPPFV_NOT_APPLIED',
});

export const FIELD_VERIFICATION_ERROR_MESSAGES = Object.freeze({
  WPPFV_INVALID_TARGET: 'The verification target is missing or belongs to another package.',
  WPPFV_TARGET_RETIRED: 'The target was retired. Record a new observation against a live target, or review the existing history.',
  WPPFV_INVALID_VALUE: 'One of the values is missing or outside the allowed range.',
  WPPFV_INVALID_EVIDENCE: 'The observation or evidence text is missing or outside the allowed length.',
  WPPFV_INCOMPLETE_OBSERVATION: 'The observation is incomplete for its target: a line needs its observed quantity, a step needs its completion finding, and a submission needs evidence or a substantive note.',
  WPPFV_INVALID_TRANSITION: 'That change is not allowed from the current status.',
  WPPFV_VERSION_CONFLICT: 'This verification changed since you loaded it. Reload it and try again.',
  WPPFV_SELF_REVIEW: 'The reviewer must be a different person from the submitter. Ask another workspace member to review it.',
  WPPFV_SOURCE_CHANGED: 'The plan or recorded actuals changed since this observation was reviewed. Review the updated source and resubmit.',
  WPPFV_PACKAGE_TERMINAL: 'This package is closed. Field verifications are read-only on closed packages.',
  WPPFV_PACKAGE_NOT_FOUND: 'The package was not found in this workspace.',
  WPPFV_VERIFICATION_NOT_FOUND: 'The field verification was not found in this workspace.',
  WPPFV_LINK_NOT_FOUND: 'The link was not found in this workspace.',
  WPPFV_LINK_EXISTS: 'That link is already attached to this verification.',
  WPPFV_LINK_RETIRED: 'That link was already removed.',
  WPPFV_DUPLICATE_ACTIVE: 'An active observation already exists for this target, inspection date, and source.',
  WPPFV_RETIRED: 'This verification was retired. Record a new observation instead.',
  WPPFV_INVALID_ACTION: 'That review action is not supported.',
  WPPFV_REASON_REQUIRED: 'A reason is required for this change.',
  WPPFV_REASON_TOO_LONG: 'The reason is too long. Keep it under 1,000 characters.',
  WPPFV_REVIEW_NOTE_REQUIRED: 'Acceptance requires a review statement describing what was checked.',
  WPPFV_INVALID_ACTOR: 'Your sign-in could not be identified. Sign in again and retry.',
  WPPFV_WORKSPACE_FORBIDDEN: 'You do not have access to this workspace.',
  WPPFV_IDEMPOTENCY_CONFLICT: 'This request was already used with different values. Use a new request and retry.',
  WPPFV_NOT_APPLIED: 'Field verification is not available yet. Ask the workspace owner to apply the field-verification migration.',
});

const FIELD_VERIFICATION_MESSAGE_FALLBACK =
  'The field verification could not be saved. Try again.';

/**
 * Map a PostgREST/Supabase error (or a plain { code, message }) to a
 * field-verification error code + human message, mirroring the busts
 * mapper. The migration raises every expected failure as a named
 * WPPFV_* exception, so the code is the contract; the message is the
 * human wording. Unknown codes fall through to the generic message.
 */
export function mapFieldVerificationRpcError(error) {
  if (!error) {
    return {
      code: FIELD_VERIFICATION_ERROR_CODES.NOT_APPLIED,
      message: FIELD_VERIFICATION_MESSAGE_FALLBACK,
    };
  }
  const message = String(error.message || '');
  const code = String(error.code || '');
  const match = message.match(/WPPFV_[A-Z_]+/);
  const errorCode = match ? match[0] : code;
  if (FIELD_VERIFICATION_ERROR_MESSAGES[errorCode]) {
    return {
      code: errorCode,
      message: FIELD_VERIFICATION_ERROR_MESSAGES[errorCode],
      existingId:
        errorCode === 'WPPFV_DUPLICATE_ACTIVE' || errorCode === 'WPPFV_LINK_EXISTS'
          ? message.split(':').slice(1).join(':').trim() || null
          : null,
    };
  }
  return {
    code: FIELD_VERIFICATION_ERROR_CODES.NOT_APPLIED,
    message: FIELD_VERIFICATION_MESSAGE_FALLBACK,
  };
}

/** True when the value is a finite number with at most `scale` decimals. */
export function isValidDecimal(value, scale = 2) {
  if (value === null || value === undefined || value === '') return false;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return false;
  const text = String(value);
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  return decimals <= scale;
}

export function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function hasControlCharacters(value) {
  return typeof value === 'string' && /[[:cntrl:]]/.test(value);
}

function isNonEmptyText(value, maxLength) {
  return (
    typeof value === 'string' &&
    value.trim().length >= 1 &&
    value.length <= maxLength &&
    !hasControlCharacters(value)
  );
}

function isOptionalText(value, maxLength) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' &&
      value.length <= maxLength &&
      !hasControlCharacters(value))
  );
}

/**
 * Validate a create payload (client-side, pre-flight). Returns an
 * array of WPPFV_* codes; empty means the payload is well-formed.
 * The server re-validates everything — this is the UI's early
 * feedback, not the gate.
 */
export function validateFieldVerificationCreate(input) {
  const codes = [];
  const targetType = input?.targetType;
  if (!FIELD_VERIFICATION_TARGET_TYPES.includes(targetType)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
  }
  if (targetType === 'WORK_STEP') {
    if (!input?.stepId) codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
    if (input?.takeoffLineId) codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
    if (
      !FIELD_VERIFICATION_PHYSICAL_COMPLETIONS.includes(input?.physicalCompletion)
    ) {
      codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
    }
    if (input?.physicalCompletion === 'COMPLETE' && !isNonEmptyText(input?.acceptanceCriteriaChecked, 2000)) {
      codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
    }
    if (input?.observedInstalledQuantity !== null && input?.observedInstalledQuantity !== undefined) {
      codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
    }
  }
  if (targetType === 'TAKEOFF_LINE') {
    if (!input?.takeoffLineId) codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
    if (input?.stepId) codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
    if (input?.physicalCompletion) codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
    if (
      input?.observedInstalledQuantity !== null &&
      input?.observedInstalledQuantity !== undefined &&
      !isValidDecimal(input.observedInstalledQuantity, 4)
    ) {
      codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
    }
  }
  if (!FIELD_VERIFICATION_WORK_LOCATIONS.includes(input?.workLocation)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (!isValidDateString(input?.inspectionDate)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (!input?.sourceCheckedAt) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (!isNonEmptyText(input?.observationNote, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (!isOptionalText(input?.evidenceRef, 500)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (!isOptionalText(input?.evidenceSummary, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (!isOptionalText(input?.observedBasis, 1000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (!isOptionalText(input?.acceptanceCriteriaChecked, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (
    input?.fieldReportedHours !== null &&
    input?.fieldReportedHours !== undefined &&
    !isValidDecimal(input.fieldReportedHours, 2)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (
    input?.fieldReportedHours !== null &&
    input?.fieldReportedHours !== undefined &&
    !isNonEmptyText(input?.fieldHoursSource, 500)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (!isOptionalText(input?.fieldHoursSource, 500)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (!input?.sourceFingerprint || typeof input.sourceFingerprint !== 'string' || input.sourceFingerprint.length !== 32) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.SOURCE_CHANGED);
  }
  return [...new Set(codes)];
}

/** Validate an update payload (set-flag style, mirroring the RPC). */
export function validateFieldVerificationUpdate(input) {
  const codes = [];
  if (!input?.reason || !isNonEmptyText(input.reason, 1000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.REASON_REQUIRED);
  }
  if (input?.setWorkLocation && !FIELD_VERIFICATION_WORK_LOCATIONS.includes(input?.workLocation)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (input?.setInspectionDate && !isValidDateString(input?.inspectionDate)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (
    input?.setObservedInstalledQuantity &&
    input?.observedInstalledQuantity !== null &&
    input?.observedInstalledQuantity !== undefined &&
    !isValidDecimal(input.observedInstalledQuantity, 4)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (
    input?.setPhysicalCompletion &&
    !FIELD_VERIFICATION_PHYSICAL_COMPLETIONS.includes(input?.physicalCompletion)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (
    input?.setFieldReportedHours &&
    input?.fieldReportedHours !== null &&
    input?.fieldReportedHours !== undefined &&
    !isValidDecimal(input.fieldReportedHours, 2)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  if (input?.setObservationNote && !isNonEmptyText(input.observationNote, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (input?.setEvidenceRef && !isOptionalText(input.evidenceRef, 500)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (input?.setEvidenceSummary && !isOptionalText(input.evidenceSummary, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (input?.setObservedBasis && !isOptionalText(input.observedBasis, 1000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (input?.setAcceptanceCriteriaChecked && !isOptionalText(input.acceptanceCriteriaChecked, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_EVIDENCE);
  }
  if (input?.setFieldHoursSource && !isOptionalText(input.fieldHoursSource, 500)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_VALUE);
  }
  return [...new Set(codes)];
}

/** Validate a decision payload (submit/accept/return/reject). */
export function validateFieldVerificationDecision(input) {
  const codes = [];
  if (!FIELD_VERIFICATION_DECISION_ACTIONS.includes(input?.action)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_ACTION);
  }
  if (input?.action === 'accept' && !isNonEmptyText(input?.reviewNote, 2000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.REVIEW_NOTE_REQUIRED);
  }
  if (
    (input?.action === 'return' || input?.action === 'reject') &&
    !isNonEmptyText(input?.reason, 1000)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.REASON_REQUIRED);
  }
  if (input?.reason && !isOptionalText(input.reason, 1000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.REASON_TOO_LONG);
  }
  if (
    (input?.action === 'submit' || input?.action === 'accept') &&
    (!input?.sourceFingerprint || input.sourceFingerprint.length !== 32)
  ) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.SOURCE_CHANGED);
  }
  return [...new Set(codes)];
}

/** Validate a retire payload. */
export function validateFieldVerificationRetire(input) {
  const codes = [];
  if (!input?.reason || !isNonEmptyText(input.reason, 1000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.REASON_REQUIRED);
  }
  return codes;
}

/** Validate a link payload. */
export function validateFieldVerificationLink(input) {
  const codes = [];
  if (!FIELD_VERIFICATION_LINK_KINDS.includes(input?.targetKind)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
  }
  if (!input?.targetId || typeof input.targetId !== 'string' || input.targetId.trim() === '') {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.INVALID_TARGET);
  }
  if (input?.reason && !isOptionalText(input.reason, 1000)) {
    codes.push(FIELD_VERIFICATION_ERROR_CODES.REASON_TOO_LONG);
  }
  return [...new Set(codes)];
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Line variances, derived from the stored snapshots (never
 * client-submitted authoritative math). All figures are quantities
 * in the line's unit; percents are vs the planned quantity.
 */
export function computeLineVariances({ plannedQuantity, recordedQuantity, observedQuantity }) {
  const planned = Number(plannedQuantity);
  const recorded = Number(recordedQuantity);
  const observed = observedQuantity === null || observedQuantity === undefined ? null : Number(observedQuantity);
  const varianceVsPlan =
    observed === null || !Number.isFinite(planned) ? null : roundTo(observed - planned, 4);
  const varianceVsRecorded =
    observed === null || !Number.isFinite(recorded) ? null : roundTo(observed - recorded, 4);
  const percentVsPlan =
    varianceVsPlan === null || !Number.isFinite(planned) || planned === 0
      ? null
      : roundTo((varianceVsPlan / planned) * 100, 2);
  const percentVsRecorded =
    varianceVsRecorded === null || !Number.isFinite(recorded) || recorded === 0
      ? null
      : roundTo((varianceVsRecorded / recorded) * 100, 2);
  return { varianceVsPlan, varianceVsRecorded, percentVsPlan, percentVsRecorded };
}

/**
 * Step hours difference: field-reported hours vs planned step hours.
 * Positive means the field reported more hours than planned.
 */
export function computeHoursDifference(fieldReportedHours, plannedHours) {
  if (fieldReportedHours === null || fieldReportedHours === undefined
    || plannedHours === null || plannedHours === undefined) return null;
  const reported = Number(fieldReportedHours);
  const planned = Number(plannedHours);
  if (!Number.isFinite(reported) || !Number.isFinite(planned)) return null;
  const hoursVsPlan = roundTo(reported - planned, 2);
  const label = hoursVsPlan > 0 ? 'OVER' : hoursVsPlan < 0 ? 'UNDER' : 'MATCH';
  return { hoursVsPlan, label };
}

/**
 * Source freshness for one verification: the stored fingerprint
 * against the live recomputation (from the sources endpoint).
 */
export function computeSourceStatus(storedFingerprint, liveFingerprint) {
  if (!storedFingerprint || !liveFingerprint) return 'CHANGED_SINCE_REVIEW';
  return storedFingerprint === liveFingerprint ? 'CURRENT' : 'CHANGED_SINCE_REVIEW';
}
