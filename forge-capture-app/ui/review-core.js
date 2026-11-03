// FORGE Capture — C2-P6A candidate-only review panel, pure logic (review-core.js).
//
// DOM-free: grouping, payload construction, error categorization, and highlight
// geometry. Unit-tested under vitest with no Tauri/DOM dependency. The DOM-owning
// half (review.js) imports this and never duplicates its decisions.
//
// Scope (results/chatgpt/capture-c2-p6a-frontend-ui-scope-review-2026-10-30.md):
// candidate-only. No new mutation/safety logic lives here or in review.js — every
// disposition change goes through the existing, already-reviewed
// `review_disposition_change` Tauri command unchanged. This module only decides
// what to show and what payload to send; the backend decides what is allowed.

export const DISPOSITIONS = Object.freeze({
  PENDING: "PENDING",
  REDACT: "REDACT",
  MARK_NON_SENSITIVE: "MARK_NON_SENSITIVE",
});

export class ReviewError extends Error {
  constructor(category, message) {
    super(message);
    this.name = "ReviewError";
    this.category = category;
  }
}

/**
 * Groups a snapshot's candidates by disposition, preserving each
 * disposition's original order — grouping is purely a presentation
 * concern, never a reinterpretation of what the backend returned.
 * Returns `{ PENDING: [...], REDACT: [...], MARK_NON_SENSITIVE: [...] }`,
 * always all three keys present (possibly empty), so a caller never has
 * to guess which groups exist.
 */
export function groupCandidatesByDisposition(candidates) {
  const groups = { PENDING: [], REDACT: [], MARK_NON_SENSITIVE: [] };
  for (const c of candidates || []) {
    if (groups[c.disposition]) {
      groups[c.disposition].push(c);
    } else {
      // An unrecognized disposition is never silently sorted into a
      // bucket it doesn't belong in — scope review: "Unknown
      // dispositions ... disable actions and show an error."
      (groups.UNKNOWN ||= []).push(c);
    }
  }
  return groups;
}

/**
 * Validates a reason for a MARK_NON_SENSITIVE submission. The backend
 * (`validate_review_action`) is the actual authority — this exists only
 * so the UI can refuse an obviously-blank reason before even attempting
 * the round trip, not as a substitute enforcement point.
 */
export function isBlankReason(reason) {
  return typeof reason !== "string" || reason.trim().length === 0;
}

/**
 * Builds the exact `review_disposition_change` invoke payload from one
 * immutable snapshot plus the action the reviewer chose — never from
 * whatever the panel's current mutable controls happen to show right
 * now. Scope review item 2: "Mutation always uses the exact snapshot
 * and selected IDs for which the reviewer submitted it, never current
 * mutable controls." `eventId`/`localTimestamp` are passed in (generated
 * fresh per submission by the caller, injectable here for testing)
 * rather than generated inside this pure function, so a test can assert
 * on an exact, known value.
 *
 * `snapshot` is the request context the panel used to load this view
 * (`workspaceRoot`, `sessionRelativePath`) merged with the
 * `ReviewCandidatesSnapshot` the backend returned for it
 * (`frameId`/`sessionRevision`/`policyVersion`/`modelManifestSha256`) —
 * review.js builds this merged object once, at load time, and holds it
 * immutable for the lifetime of that loaded view (see
 * `buildLoadedViewState` below).
 */
export function buildReviewActionPayload({ snapshot, candidateId, newDisposition, reason, eventId, localTimestamp }) {
  if (!snapshot) throw new ReviewError("unknown", "no snapshot to act against");
  if (!Object.values(DISPOSITIONS).includes(newDisposition)) {
    throw new ReviewError("unknown", `unrecognized disposition: ${newDisposition}`);
  }
  if (newDisposition === DISPOSITIONS.MARK_NON_SENSITIVE && isBlankReason(reason)) {
    throw new ReviewError("blank-reason", "a reason is required to mark a candidate not sensitive");
  }
  return {
    workspaceRoot: snapshot.workspaceRoot,
    sessionRelativePath: snapshot.sessionRelativePath,
    frameId: snapshot.frameId,
    candidateId,
    newDisposition,
    reason: newDisposition === DISPOSITIONS.MARK_NON_SENSITIVE ? reason.trim() : "",
    expectedSessionRevision: snapshot.sessionRevision,
    expectedPolicyVersion: snapshot.policyVersion,
    expectedModelManifestSha256: snapshot.modelManifestSha256,
    eventId,
    localTimestamp,
  };
}

/**
 * Builds the exact `get_review_candidates` invoke payload for one
 * workspace/session/frame context.
 */
export function buildSnapshotRequestPayload({ workspaceRoot, sessionRelativePath, frameId }) {
  return { workspaceRoot, sessionRelativePath, frameId };
}

// --- error categorization ---------------------------------------------------
//
// The backend returns a plain String error (matching the existing
// `review_disposition_change` convention — see sop_review.rs). Rather than
// changing that already-reviewed command's error format, this sniffs the
// known, stable Rust Debug-format tokens and message prefixes each backend
// error path actually produces, into a small fixed set of UI-actionable
// categories. Order matters: more specific tokens are checked before
// generic ones.

const CATEGORY_PATTERNS = [
  ["stale-revision", /StaleSessionRevision|PolicyVersionMismatch|ModelManifestMismatch/],
  ["confirmation-declined", /MissingExplicitConfirmation/],
  ["blank-reason", /MissingReason/],
  ["protected-credential", /ProtectedCredentialNonOverridable/],
  ["not-found", /UnknownFrame|UnknownCandidate|no session exists yet|no frame with id/],
  ["review-limit", /review-limit refused/],
  ["malformed", /not a valid session|cannot stat session file|cannot read session file/],
  ["duplicate-event", /already exists in this session's edit log/],
];

/**
 * Maps a raw backend error string (from `review_disposition_change` or
 * `get_review_candidates`) to one of a small fixed set of UI categories:
 * "stale-revision", "confirmation-declined", "blank-reason",
 * "protected-credential", "not-found", "review-limit", "malformed",
 * "duplicate-event", or "unknown" (the fallback — never invented from
 * nothing, and never displayed as raw parse/debug content per the scope
 * review's "safe display" requirement; the caller chooses the
 * human-facing wording per category, this function only classifies).
 */
export function categorizeError(message) {
  const text = String(message ?? "");
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "unknown";
}

const CATEGORY_LABELS = Object.freeze({
  "stale-revision": "This frame changed since you loaded it. Reload and try again — your action was not applied.",
  "confirmation-declined": "The confirmation dialog was cancelled. Nothing was changed.",
  "blank-reason": "A reason is required to mark a candidate not sensitive.",
  "protected-credential": "This candidate is a protected credential type and cannot be marked not sensitive.",
  "not-found": "This frame or candidate could not be found — it may have been removed.",
  "review-limit": "This frame has too much review data to load here.",
  malformed: "The session file could not be read.",
  "duplicate-event": "That action was already recorded — reload to see the current state.",
  unknown: "The action could not be completed.",
});

/** The safe, fixed, actionable label for a backend error category. Never
 * the raw backend string — this codebase's own safe-display rule. */
export function describeErrorCategory(category) {
  return CATEGORY_LABELS[category] || CATEGORY_LABELS.unknown;
}

// --- selection / async response binding ---------------------------------------
//
// Scope review item 2: a response for an old selection must not replace a
// newer panel or enable actions on it. `RequestGenerationTracker` is the one
// place that decides "is this response still the one we're waiting for" —
// review.js never makes that decision itself from, e.g., comparing context
// fields by hand.

export class RequestGenerationTracker {
  constructor() {
    this.current = 0;
  }

  /** Call when starting a new load/action; returns the generation token
   * to carry alongside that in-flight request. */
  begin() {
    this.current += 1;
    return this.current;
  }

  /** True if `generation` is still the latest one started — false means
   * a newer load/action has superseded it and its response must be
   * discarded, not applied. */
  isCurrent(generation) {
    return generation === this.current;
  }
}

/**
 * Merges the request context (what the panel asked for) with the
 * backend's validated snapshot (what it got back) into the one immutable
 * object every subsequent action for this loaded view is built from —
 * see `buildReviewActionPayload`'s own doc comment. Never mutated in
 * place after this; a new load produces a new one.
 */
export function buildLoadedViewState({ workspaceRoot, sessionRelativePath, snapshot }) {
  return Object.freeze({ workspaceRoot, sessionRelativePath, ...snapshot });
}

// --- highlight geometry -------------------------------------------------------
//
// Box tuples are `[x, y, w, h]` in frame pixels (top-left origin) — see
// `forge_capture_core::sop_redaction::expand_box`/`clip_box_to_frame`. This
// is a coordinate-view diagram, not a pixel preview: it never needs the
// raster itself, only the frame's declared width/height and the returned
// boxes.

/**
 * Scales a `[x, y, w, h]` frame-pixel box into display pixels for a
 * diagram rendered at `displayWidth` x `displayHeight`, given the frame's
 * real `frameWidth`/`frameHeight`. Returns `null` for a degenerate frame
 * (zero width/height) rather than dividing by zero.
 */
export function boxToDisplayRect(box, frameWidth, frameHeight, displayWidth, displayHeight) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!frameWidth || !frameHeight) return null;
  const [x, y, w, h] = box;
  const scaleX = displayWidth / frameWidth;
  const scaleY = displayHeight / frameHeight;
  return {
    left: x * scaleX,
    top: y * scaleY,
    width: w * scaleX,
    height: h * scaleY,
  };
}
