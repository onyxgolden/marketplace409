// FORGE Work Management — Work Package Planner, slice 7: IFA-to-IFC
// redline review workflow (forge-ai-drop
// results/chatgpt/work-package-planner-slice7-ifa-ifc-redline-scope-2026-11-08.md).
//
// Pure, db-free domain logic — no I/O, unit-testable in isolation. The
// db-injected application service lives in
// `src/application/work-management/drawingReviews.js`.
//
// The rules this module owns:
// 1. A review targets ONE immutable drawing revision (never a mutable
//    filename or a package-level generic annotation). Multiple rounds
//    may occur for one logical drawing across revisions; each round is
//    bound to the exact revision and its content digest.
// 2. Controlled drawings are NOT editable in-tool. Approval of an IFA
//    review never relabels the IFA file as IFC: only a distinct
//    uploaded IFC revision plus a release record makes a drawing
//    construction-usable. A field hand-redline is a separate immutable
//    historical evidence artifact, never an edit to the controlled
//    drawing.
// 3. Closed rounds are immutable; reopening means a new round. No two
//    simultaneously OPEN reviews for the same revision. A rejected
//    revision cannot be released IFC; a new drafter revision starts a
//    new round.
// 4. Steps may plan and link against IFA (marked preliminary); IFA
//    alone never authorizes construction use. Daily progress still
//    records (flagged PRE_IFC where a drawing linkage exists —
//    preIfcTag, shown in the takeoff history display only);
//    assignments and the manpower curve are status-signal only — this
//    module changes no progress math, assignment, or curve logic.
// 5. Slice independence: no busts/backcharges, field verification,
//    reusable templates, permit lifecycle, notifications, or automatic
//    scheduling live here. Roles: owner/co-owner-only gates until the
//    admin-permissions role model lands; separation of duties IS
//    enforced at the decide step (see the migration): when a reviewer
//    is designated and differs from the round opener, the opener may
//    not decide their own round. A terminal package (cancelled /
//    verified closed) withdraws every drawing it holds: no IFC badge,
//    no construction use, no preliminary flag.

export const REVIEW_STATES = Object.freeze([
  "OPEN",
  "RETURNED",
  "APPROVED",
  "APPROVED_WITH_REDLINES",
  "CANCELLED",
]);

export const REDLINE_SEVERITIES = Object.freeze(["INFO", "REQUIRED"]);

export const REDLINE_RESOLUTIONS = Object.freeze([
  "OPEN",
  "RESOLVED",
  "ACCEPTED_AS_NOTED",
]);

export const REVIEW_DECISIONS = Object.freeze([
  "APPROVE",
  "APPROVE_WITH_REDLINES",
  "RETURN_TO_DRAFTER",
]);

export const FIELD_RECORD_STATES = Object.freeze([
  "HISTORICAL_PENDING_RECONCILIATION",
  "RECONCILED",
  "RETIRED",
]);

export const MAX_REVISION_CODE_LENGTH = 40;
export const MAX_DOCUMENT_REF_LENGTH = 1000;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_ANCHOR_TEXT_LENGTH = 500;
export const MAX_REASON_LENGTH = 1000;
export const MAX_RESOLUTION_NOTE_LENGTH = 1000;

// Revision codes are short plain labels ("A", "B", "0", "IFA-2").
// Must agree with the database CHECK in the slice-7 migration.
const REVISION_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/i;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Collapses whitespace and trims; returns "" for non-strings. */
export function collapseLabel(value) {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  return "";
}

function isValidRevisionCode(value) {
  if (typeof value !== "string") return false;
  const code = collapseLabel(value);
  return code.length >= 1 && code.length <= MAX_REVISION_CODE_LENGTH
    && REVISION_CODE_PATTERN.test(code);
}

function isValidDocumentRef(value) {
  return isNonEmptyString(value) && value.length <= MAX_DOCUMENT_REF_LENGTH;
}

function isValidSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isValidComment(value) {
  if (typeof value !== "string") return false;
  return value.trim().length >= 1 && value.length <= MAX_COMMENT_LENGTH
    && !CONTROL_CHAR_PATTERN.test(value)
    && !HTML_TAG_PATTERN.test(value);
}

function isValidReason(value, { required = false } = {}) {
  if (value == null) return !required;
  if (typeof value !== "string") return false;
  if (required) return value.trim().length >= 1 && value.length <= MAX_REASON_LENGTH;
  return value.length <= MAX_REASON_LENGTH;
}

function isValidExpectedVersion(value) {
  return Number.isInteger(value) && value >= 1;
}

function validateAnchor({ anchorPage, anchorX, anchorY, anchorText }, errors) {
  if (anchorPage !== undefined && anchorPage !== null) {
    if (!Number.isInteger(anchorPage) || anchorPage < 1) {
      errors.push("Anchor page must be a whole number (1 or more).");
    }
  }
  const hasX = anchorX !== undefined && anchorX !== null;
  const hasY = anchorY !== undefined && anchorY !== null;
  if (hasX !== hasY) {
    errors.push("Anchor x and y must be supplied together.");
  }
  if (hasX && (typeof anchorX !== "number" || !Number.isFinite(anchorX) || anchorX < 0 || anchorX > 1)) {
    errors.push("Anchor x must be a number between 0 and 1.");
  }
  if (hasY && (typeof anchorY !== "number" || !Number.isFinite(anchorY) || anchorY < 0 || anchorY > 1)) {
    errors.push("Anchor y must be a number between 0 and 1.");
  }
  if (anchorText !== undefined && anchorText !== null) {
    if (typeof anchorText !== "string" || anchorText.length > MAX_ANCHOR_TEXT_LENGTH) {
      errors.push(`Anchor text must be at most ${MAX_ANCHOR_TEXT_LENGTH} characters.`);
    }
  }
}

export function validateRevisionInput(input) {
  const errors = [];
  if (!isValidRevisionCode(input?.revisionCode)) {
    errors.push("Revision code must be 1–40 characters, starting with a letter or digit and using plain text only.");
  }
  if (!isValidDocumentRef(input?.documentRef)) {
    errors.push("Document reference is required and must be at most 1000 characters.");
  }
  if (!isValidSha256(input?.contentSha256)) {
    errors.push("Content SHA-256 must be 64 hexadecimal characters.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateReviewInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.drawingRevisionId)) {
    errors.push("A drawing revision id is required.");
  }
  if (input?.reviewerId !== undefined && input?.reviewerId !== null
      && !isNonEmptyString(input.reviewerId)) {
    errors.push("Reviewer id must be a non-empty string when supplied.");
  }
  if (!isValidReason(input?.reason)) {
    errors.push(`Reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateRedlineInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.reviewId)) {
    errors.push("A review id is required.");
  }
  if (!isNonEmptyString(input?.drawingRevisionId)) {
    errors.push("A drawing revision id is required.");
  }
  if (!isValidComment(input?.comment)) {
    errors.push("Comment is required, at most 2000 characters, with no control characters or HTML.");
  }
  if (!REDLINE_SEVERITIES.includes(input?.severity)) {
    errors.push("Severity must be INFO or REQUIRED.");
  }
  validateAnchor(input ?? {}, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateRedlineResolveInput(input) {
  const errors = [];
  if (!isValidExpectedVersion(input?.expectedVersion)) {
    errors.push("Expected version must be a whole number (1 or more).");
  }
  if (input?.retire === true) {
    if (!isValidReason(input?.reason, { required: true })) {
      errors.push("A reason is required to retire a redline.");
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true };
  }
  if (!["RESOLVED", "ACCEPTED_AS_NOTED"].includes(input?.resolution)) {
    errors.push("Resolution must be RESOLVED or ACCEPTED_AS_NOTED.");
  }
  if (input?.resolutionNote !== undefined && input?.resolutionNote !== null) {
    if (typeof input.resolutionNote !== "string" || input.resolutionNote.length > MAX_RESOLUTION_NOTE_LENGTH) {
      errors.push(`Resolution note must be at most ${MAX_RESOLUTION_NOTE_LENGTH} characters.`);
    }
  }
  if (!isValidReason(input?.reason)) {
    errors.push(`Reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateReviewDecisionInput(input) {
  const errors = [];
  if (!isValidExpectedVersion(input?.expectedVersion)) {
    errors.push("Expected version must be a whole number (1 or more).");
  }
  if (!REVIEW_DECISIONS.includes(input?.decision)) {
    errors.push("Decision must be APPROVE, APPROVE_WITH_REDLINES, or RETURN_TO_DRAFTER.");
  }
  if (!isValidReason(input?.reason, { required: true })) {
    errors.push("A reason is required for the review decision.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateIfcReleaseInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.reviewId)) {
    errors.push("A review id is required.");
  }
  if (!isValidRevisionCode(input?.ifcRevisionCode)) {
    errors.push("Revision code must be 1–40 characters, starting with a letter or digit and using plain text only.");
  }
  // Fix round 1: a staged artifact is mandatory. An IFC release is
  // only ever issued from a verified staged PDF — caller-typed
  // documentRef/contentSha256 are never accepted, never required,
  // and never forwarded; the release derives both from the staged
  // artifact row. The typed release path is closed, not kept for
  // compatibility: any drawing can stage its IFC PDF first.
  if (!isNonEmptyString(input?.stagedArtifactId)) {
    errors.push("A staged IFC file is required — stage the IFC PDF first.");
  }
  if (!isValidReason(input?.reason)) {
    errors.push(`Reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Slice-7 PDF blockers: controlled PDF drawing intake.
// ---------------------------------------------------------------------------

// Mirrors the takeoff domain's DRAWING_TYPES (src/domains/work-management/
// takeoff.js) — the intake accepts the same three controlled types.
export const CONTROLLED_DRAWING_TYPES = Object.freeze(["isometric", "p_id", "cut_sheet"]);
export const MAX_PDF_BYTES = 26214400; // 25 MB, matches the controlled-drawings bucket
// Multipart framing overhead allowance for the request-body pre-check:
// an upload's declared Content-Length is the PDF bytes plus multipart
// boundaries and field text (a few KiB). Routes reject a declared body
// larger than the PDF limit + this allowance before parsing it.
export const MAX_UPLOAD_BYTES = MAX_PDF_BYTES + 1024 * 1024;
export const CONTROLLED_DRAWINGS_BUCKET = "controlled-drawings";
export const MAX_DRAWING_NUMBER_LENGTH = 120;
export const MAX_LINE_NUMBER_LENGTH = 120;
export const MAX_ISSUER_REF_LENGTH = 200;
export const MAX_DRAWING_TITLE_LENGTH = 200;
export const MAX_REQUEST_ID_LENGTH = 128;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Validates uploaded PDF bytes without a PDF parser: non-empty, within
 * the bucket size limit, starting with the %PDF- magic, and carrying a
 * %%EOF marker in the last 4 KiB (a truncated or non-PDF file fails).
 * The MIME type is advisory — the magic bytes are authoritative.
 */
export function validatePdfFile({ bytes, mimeType } = {}) {
  const errors = [];
  if (!bytes || typeof bytes.length !== "number" || bytes.length === 0) {
    errors.push("A PDF file is required.");
    return { ok: false, errors };
  }
  if (bytes.length > MAX_PDF_BYTES) {
    errors.push(`The PDF is too large (${bytes.length} bytes — 25 MB maximum).`);
  }
  if (mimeType != null && mimeType !== "" && mimeType !== "application/pdf") {
    errors.push("The file must be a PDF (application/pdf).");
  }
  const magicOk = PDF_MAGIC.every((byte, index) => bytes[index] === byte);
  if (!magicOk) {
    errors.push("The file is not a PDF (it does not start with %PDF-).");
  }
  const tail = bytes.slice(Math.max(0, bytes.length - 4096));
  const tailText = typeof TextDecoder === "undefined"
    ? ""
    : new TextDecoder("latin1").decode(tail);
  if (!tailText.includes("%%EOF")) {
    errors.push("The PDF looks truncated or malformed (no %%EOF marker near the end).");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

function isValidIssueDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateControlledDrawingIntakeInput(input) {
  const errors = [];
  if (!CONTROLLED_DRAWING_TYPES.includes(input?.drawingType)) {
    errors.push(`Drawing type must be one of: ${CONTROLLED_DRAWING_TYPES.join(", ")}.`);
  }
  if (!isNonEmptyString(input?.drawingNumber) || input.drawingNumber.length > MAX_DRAWING_NUMBER_LENGTH) {
    errors.push(`Drawing number is required and must be at most ${MAX_DRAWING_NUMBER_LENGTH} characters.`);
  }
  if (input?.lineNumber != null && input.lineNumber !== "") {
    if (typeof input.lineNumber !== "string" || input.lineNumber.trim().length === 0
        || input.lineNumber.length > MAX_LINE_NUMBER_LENGTH) {
      errors.push(`Line number must be at most ${MAX_LINE_NUMBER_LENGTH} characters.`);
    }
  }
  if (!isValidRevisionCode(input?.revisionCode)) {
    errors.push("Revision code must be 1–40 characters, starting with a letter or digit and using plain text only.");
  }
  if (!isValidIssueDate(input?.issueDate)) {
    errors.push("Issue date is required and must be a valid date (YYYY-MM-DD).");
  }
  if (input?.issuerRef != null && input.issuerRef !== "" && input.issuerRef.length > MAX_ISSUER_REF_LENGTH) {
    errors.push(`Issuer/drafter reference must be at most ${MAX_ISSUER_REF_LENGTH} characters.`);
  }
  if (input?.title != null && input.title !== "" && input.title.length > MAX_DRAWING_TITLE_LENGTH) {
    errors.push(`Title must be at most ${MAX_DRAWING_TITLE_LENGTH} characters.`);
  }
  if (input?.drawingType === "p_id" && isNonEmptyString(input?.pIdDrawingId)) {
    errors.push("pIdDrawingId must not be set on a p_id drawing — it always rolls up to itself.");
  }
  if (input?.pIdDrawingId != null && input.pIdDrawingId !== "" && !isNonEmptyString(input.pIdDrawingId)) {
    errors.push("P&ID parent id must be a non-empty string when supplied.");
  }
  if (!isNonEmptyString(input?.requestId) || input.requestId.length > MAX_REQUEST_ID_LENGTH) {
    errors.push(`Request id is required and must be at most ${MAX_REQUEST_ID_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

export function validateIfcStageInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.requestId) || input.requestId.length > MAX_REQUEST_ID_LENGTH) {
    errors.push(`Request id is required and must be at most ${MAX_REQUEST_ID_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

export function validateFieldRedlineInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.drawingRevisionId)) {
    errors.push("A drawing revision id is required.");
  }
  if (!isValidDocumentRef(input?.artifactRef)) {
    errors.push("Artifact reference is required and must be at most 1000 characters.");
  }
  if (!isValidSha256(input?.sha256)) {
    errors.push("Content SHA-256 must be 64 hexadecimal characters.");
  }
  if (!isValidReason(input?.fieldReason, { required: true })) {
    errors.push("A field reason is required and must be at most 1000 characters.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateFieldRedlineReconcileInput(input) {
  const errors = [];
  if (!isNonEmptyString(input?.reconciledRevisionId)) {
    errors.push("A reconciled revision id is required.");
  }
  if (!isValidReason(input?.reason)) {
    errors.push(`Reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateDrawingRetireInput(input) {
  const errors = [];
  if (!isValidReason(input?.reason, { required: true })) {
    errors.push("A reason is required to retire a drawing.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Derives one drawing's readiness badge from its latest revision,
 * latest review and ACTIVE IFC release. This is the single source of
 * truth for the badge strings — the migration's readiness snapshot
 * RPC implements the same rules in SQL, and the migration tests
 * assert both on the same fixtures.
 *
 * input: { retiredAt, packageStatus, latestRevision: { issuedAs } | null,
 *          latestReview: { state } | null, activeRelease: object | null }
 * returns: { badge, constructionUsable, preliminary }
 *
 * A terminal package (cancelled / verified closed) withdraws every
 * drawing that has a revision: the release (if any) is retired by the
 * package trigger, and the badge names the withdrawal. A drawing with
 * no revision at all keeps its own state — there is nothing to
 * withdraw. Retired still beats everything.
 */
export function deriveDrawingReadiness(input) {
  if (input?.retiredAt) {
    return { badge: "Retired", constructionUsable: false, preliminary: false };
  }
  const packageStatus = input?.packageStatus ?? null;
  const terminal = packageStatus === "cancelled" || packageStatus === "verified_closed";
  const hasRevision = input?.latestRevision != null;
  if (terminal && hasRevision) {
    return {
      badge: packageStatus === "cancelled"
        ? "Withdrawn — package cancelled"
        : "Withdrawn — package verified closed",
      constructionUsable: false,
      preliminary: false,
    };
  }
  if (input?.activeRelease) {
    return { badge: "IFC — Issued for construction", constructionUsable: true, preliminary: false };
  }
  const state = input?.latestReview?.state ?? null;
  if (state === "OPEN") {
    return { badge: "IFA — In review", constructionUsable: false, preliminary: hasRevision };
  }
  if (state === "RETURNED") {
    return { badge: "IFA — Returned to drafter", constructionUsable: false, preliminary: hasRevision };
  }
  if (state === "APPROVED" || state === "APPROVED_WITH_REDLINES") {
    return { badge: "IFA — Approved; IFC not issued", constructionUsable: false, preliminary: hasRevision };
  }
  if (hasRevision) {
    return { badge: "IFA — Awaiting review", constructionUsable: false, preliminary: true };
  }
  return { badge: "No issued revision", constructionUsable: false, preliminary: false };
}

/**
 * Step-view label for a linked drawing's readiness (brief §7): an IFA
 * drawing is planning context marked preliminary; an IFC-released
 * drawing is the construction issue. A retired drawing is named, never
 * silently dropped. A withdrawn drawing names the package state that
 * withdrew it.
 */
export function stepDrawingLabel(readiness) {
  if (!readiness) return "Drawing: readiness unknown";
  if (readiness.badge === "Retired") return "Retired drawing";
  if (typeof readiness.badge === "string" && readiness.badge.startsWith("Withdrawn")) {
    return `Drawing: ${readiness.badge.charAt(0).toLowerCase()}${readiness.badge.slice(1)}`;
  }
  if (readiness.constructionUsable) return "IFC — construction issue";
  if (readiness.preliminary) return "Drawing: IFA — preliminary";
  if (readiness.badge === "No issued revision") return "Drawing: no issued revision";
  return `Drawing: ${readiness.badge}`;
}

/**
 * Display-only PRE-IFC flag for a progress entry (brief §7): an entry
 * recorded against a preliminary (IFA) drawing carries the "PRE-IFC"
 * tag in the daily history display. It never changes any total —
 * historic actuals stay exactly as recorded, and an IFC-linked or
 * withdrawn entry carries no flag. Takes a readiness row as returned
 * by the snapshot (or derived by deriveDrawingReadiness); returns
 * "PRE-IFC" or null.
 */
export function preIfcTag(readiness) {
  return readiness?.preliminary === true ? "PRE-IFC" : null;
}
