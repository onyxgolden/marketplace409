// FORGE Work Management — Work Package Planner, slice 7 application
// service. db-injected (a supabase-shaped `db` with `.from(table)`
// chains and `.rpc(name, args)`) so it unit-tests with mocks,
// mirroring workSteps.js's convention in this directory.
//
// Write-path discipline (slice-7 scope): every mutation goes through
// one of the migration's SECURITY DEFINER RPCs, which perform the
// mutation AND the audit-event insert in a single transaction with an
// optimistic version guard where the row is versioned. The service
// never writes revisions, reviews, redlines, events, releases or
// field redlines directly — a direct write could not keep the audit
// atomic. Reads go through the RLS-gated client like slices 1–6,
// with the same parent-chain proofs before any row is returned (a
// review from another package addressed through this package's URL is
// a 404).
//
// The RPCs derive the audit actor from auth.uid() inside the database
// (slice 2's P1 lesson) — so, like workSteps.js, this service takes
// NO actor parameter at all: there is nothing caller-supplied that
// could forge an actor.
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the slice-7
// tables and RPCs do not exist. List calls treat a missing table
// (42P01) as an empty list so the package screen keeps rendering;
// write calls report 503 with a plain-English "not applied yet"
// message instead of a raw database error. The package and drawing
// rows themselves exist (slices 1–2), so the parent-chain proofs
// still run in the pre-migration window — only the slice-7 tables
// are missing, and only their queries are treated as empty.

import {
  validateRevisionInput,
  validateReviewInput,
  validateRedlineInput,
  validateRedlineResolveInput,
  validateReviewDecisionInput,
  validateIfcReleaseInput,
  validateFieldRedlineInput,
  validateFieldRedlineReconcileInput,
  validateDrawingRetireInput,
} from "@/domains/work-management/drawingReviews.js";

const NOT_APPLIED_ERROR = "Drawing reviews aren't available yet — the database change for this feature hasn't been applied.";

function toCamelRevision(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingId: row.drawing_id,
    revisionCode: row.revision_code,
    documentRef: row.document_ref,
    contentSha256: row.content_sha256,
    issuedAs: row.issued_as,
    issuedAt: row.issued_at,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
  };
}

function toCamelReview(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingId: row.drawing_id,
    drawingRevisionId: row.drawing_revision_id,
    roundNo: row.round_no,
    state: row.state,
    reviewerId: row.reviewer_id ?? null,
    openedBy: row.opened_by ?? null,
    openedAt: row.opened_at,
    closedBy: row.closed_by ?? null,
    closedAt: row.closed_at ?? null,
    decisionReason: row.decision_reason ?? null,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
  };
}

function toCamelRedline(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    reviewId: row.review_id,
    drawingId: row.drawing_id,
    drawingRevisionId: row.drawing_revision_id,
    stepId: row.step_id ?? null,
    anchorPage: row.anchor_page ?? null,
    anchorX: row.anchor_x == null ? null : Number(row.anchor_x),
    anchorY: row.anchor_y == null ? null : Number(row.anchor_y),
    anchorText: row.anchor_text ?? null,
    comment: row.comment,
    severity: row.severity,
    resolution: row.resolution,
    resolutionNote: row.resolution_note ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
  };
}

function toCamelEvent(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    reviewId: row.review_id ?? null,
    drawingId: row.drawing_id ?? null,
    actorId: row.actor_id ?? null,
    eventType: row.event_type,
    beforeState: row.before_state ?? null,
    afterState: row.after_state ?? null,
    payload: row.payload_minimal ?? null,
    occurredAt: row.occurred_at,
  };
}

function toCamelFieldRedline(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingId: row.drawing_id,
    drawingRevisionId: row.drawing_revision_id,
    reviewId: row.review_id ?? null,
    artifactRef: row.artifact_ref,
    sha256: row.sha256,
    capturedBy: row.captured_by ?? null,
    capturedAt: row.captured_at,
    fieldReason: row.field_reason,
    recordState: row.record_state,
    reconciledRevisionId: row.reconciled_revision_id ?? null,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
  };
}

function toCamelRelease(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingId: row.drawing_id,
    ifcRevisionId: row.ifc_revision_id,
    reviewId: row.review_id,
    releasedBy: row.released_by ?? null,
    releasedAt: row.released_at,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
  };
}

function toCamelDrawing(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingNumber: row.drawing_number,
    drawingType: row.drawing_type,
    title: row.title ?? null,
    pIdDrawingId: row.p_id_drawing_id ?? null,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelReadinessDrawing(row) {
  return {
    drawingId: row.drawing_id,
    drawingNumber: row.drawing_number,
    drawingType: row.drawing_type,
    title: row.title ?? null,
    retiredAt: row.retired_at ?? null,
    latestRevisionId: row.latest_revision_id ?? null,
    latestRevisionCode: row.latest_revision_code ?? null,
    latestIssuedAs: row.latest_issued_as ?? null,
    latestDocumentRef: row.latest_document_ref ?? null,
    latestContentSha256: row.latest_content_sha256 ?? null,
    latestIssuedAt: row.latest_issued_at ?? null,
    latestReviewId: row.latest_review_id ?? null,
    latestReviewRoundNo: row.latest_review_round_no ?? null,
    latestReviewState: row.latest_review_state ?? null,
    latestReviewOpenedAt: row.latest_review_opened_at ?? null,
    latestReviewClosedAt: row.latest_review_closed_at ?? null,
    latestReviewDecisionReason: row.latest_review_decision_reason ?? null,
    activeReleaseId: row.active_release_id ?? null,
    activeIfcRevisionId: row.active_ifc_revision_id ?? null,
    activeReleaseReviewId: row.active_release_review_id ?? null,
    activeReleaseReleasedAt: row.active_release_released_at ?? null,
    openRequiredRedlines: row.open_required_redlines ?? 0,
    pendingFieldRedlines: row.pending_field_redlines ?? 0,
    badge: row.badge,
    // Added by fix round 1: the snapshot derives preliminary from
    // the same rules as the domain module. Rows from a pre-fix
    // snapshot (no preliminary column) read as not preliminary.
    preliminary: row.preliminary ?? false,
    constructionUsable: row.construction_usable === true,
  };
}

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return message.includes("forge_wp_drawing") && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

/**
 * Maps a slice-7 RPC failure to a plain-English { ok, httpStatus,
 * error } result. Unknown failures throw, like progress.js — the
 * route turns them into a 500.
 */
export function mapDrawingReviewRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP7_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Drawing review not found." };
  }
  if (message.includes("WPP7_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP7_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — drawing reviews cannot change." };
  }
  if (message.includes("WPP7_DRAWING_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  }
  if (message.includes("WPP7_DRAWING_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "This drawing is retired — drawing reviews cannot change." };
  }
  if (message.includes("WPP7_REVISION_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Drawing revision not found." };
  }
  if (message.includes("WPP7_REVISION_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "This drawing revision is retired." };
  }
  if (message.includes("WPP7_REVISION_NOT_IFA")) {
    return { ok: false, httpStatus: 409, error: "Reviews open only on IFA revisions." };
  }
  if (message.includes("WPP7_REVISION_MISMATCH")) {
    return { ok: false, httpStatus: 409, error: "The revision does not match the review." };
  }
  if (message.includes("WPP7_SAME_REVISION")) {
    return { ok: false, httpStatus: 400, error: "The reconciled revision must be a different revision of the same drawing." };
  }
  if (message.includes("WPP7_DUPLICATE_REVISION")) {
    return { ok: false, httpStatus: 409, error: "A revision with this code already exists for the drawing." };
  }
  if (message.includes("WPP7_DUPLICATE_OPEN_REVIEW")) {
    return { ok: false, httpStatus: 409, error: "This revision already has an open review." };
  }
  if (message.includes("WPP7_IDEMPOTENCY_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This request was already used for a different review or redline — use a new idempotency key." };
  }
  if (message.includes("WPP7_REVIEW_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Review not found." };
  }
  if (message.includes("WPP7_REVIEW_CLOSED")) {
    return { ok: false, httpStatus: 409, error: "This review is closed — open a new round to continue." };
  }
  if (message.includes("WPP7_DECISION_FORBIDDEN")) {
    return { ok: false, httpStatus: 403, error: "Only the assigned reviewer can decide this review — the person who opened the round cannot close it when a different reviewer is assigned." };
  }
  if (message.includes("WPP7_REVIEW_NOT_APPROVED")) {
    return { ok: false, httpStatus: 409, error: "Only an approved review can issue an IFC revision." };
  }
  if (message.includes("WPP7_REVIEW_STALE")) {
    return { ok: false, httpStatus: 409, error: "A newer revision was issued after this review was approved — review the latest revision." };
  }
  if (message.includes("WPP7_REVIEW_MISMATCH")) {
    return { ok: false, httpStatus: 409, error: "The review does not belong to this drawing." };
  }
  if (message.includes("WPP7_OPEN_REVIEW_EXISTS")) {
    return { ok: false, httpStatus: 409, error: "Another review of this drawing is still open." };
  }
  if (message.includes("WPP7_OPEN_REQUIRED_REDLINES")) {
    return { ok: false, httpStatus: 409, error: "Resolve or accept every open REQUIRED redline before approving with redlines." };
  }
  if (message.includes("WPP7_OPEN_REDLINES")) {
    return { ok: false, httpStatus: 409, error: "Resolve every open redline before approving." };
  }
  if (message.includes("WPP7_REDLINE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Redline not found." };
  }
  if (message.includes("WPP7_REDLINE_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "This redline is retired." };
  }
  if (message.includes("WPP7_REDLINE_RESOLVED")) {
    return { ok: false, httpStatus: 409, error: "This redline is already resolved." };
  }
  if (message.includes("WPP7_FIELD_REDLINE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Field redline not found." };
  }
  if (message.includes("WPP7_FIELD_REDLINE_STATE")) {
    return { ok: false, httpStatus: 409, error: "This field redline is already reconciled." };
  }
  if (message.includes("WPP7_FIELD_REDLINE_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "This field redline is retired." };
  }
  if (message.includes("WPP7_STEP_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work step not found." };
  }
  if (message.includes("WPP7_STEP_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired work steps cannot be linked." };
  }
  if (message.includes("WPP7_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This record was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP7_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP7_REASON_TOO_LONG") || message.includes("WPP7_RESOLUTION_NOTE_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Reason or note is too long (1,000 characters maximum)." };
  }
  if (message.includes("WPP7_RESOLUTION_NOTE_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A resolution note is required for REQUIRED redlines." };
  }
  if (message.includes("WPP7_INVALID_REVISION_CODE")) {
    return { ok: false, httpStatus: 400, error: "Revision code must be 1–40 characters, starting with a letter or digit and using plain text only." };
  }
  if (message.includes("WPP7_INVALID_DOCUMENT_REF")) {
    return { ok: false, httpStatus: 400, error: "Document reference is required and must be at most 1000 characters." };
  }
  if (message.includes("WPP7_INVALID_SHA256")) {
    return { ok: false, httpStatus: 400, error: "Content SHA-256 must be 64 hexadecimal characters." };
  }
  if (message.includes("WPP7_INVALID_COMMENT")) {
    return { ok: false, httpStatus: 400, error: "Comment is required, at most 2000 characters, with no control characters or HTML." };
  }
  if (message.includes("WPP7_INVALID_SEVERITY")) {
    return { ok: false, httpStatus: 400, error: "Severity must be INFO or REQUIRED." };
  }
  if (message.includes("WPP7_INVALID_ANCHOR")) {
    return { ok: false, httpStatus: 400, error: "Anchor must be a page (1 or more) with x and y together between 0 and 1, or a short text reference." };
  }
  if (message.includes("WPP7_INVALID_RESOLUTION")) {
    return { ok: false, httpStatus: 400, error: "Resolution must be RESOLVED or ACCEPTED_AS_NOTED." };
  }
  if (message.includes("WPP7_INVALID_DECISION")) {
    return { ok: false, httpStatus: 400, error: "Decision must be APPROVE, APPROVE_WITH_REDLINES, or RETURN_TO_DRAFTER." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Drawing review RPC returned no row.");
  return row;
}

function resolvePaging({ limit, offset }) {
  const parsedLimit = limit == null ? 100 : Number(limit);
  const parsedOffset = offset == null ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    return { error: "limit must be a whole number between 1 and 200." };
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return { error: "offset must be a nonnegative whole number." };
  }
  return { limit: parsedLimit, offset: parsedOffset };
}

/** Proves a package exists for this owner and returns its status (or null). */
async function requirePackage(db, { ownerId, packageId }) {
  const { data: pkg, error } = await db.from("forge_work_packages")
    .select("id, status").eq("owner_id", ownerId).eq("id", packageId).maybeSingle();
  if (error) throw error;
  return pkg || null;
}

/** Proves a drawing belongs to the package named in the URL. */
async function requireDrawingInPackage(db, { ownerId, packageId, drawingId }) {
  const { data, error } = await db.from("forge_work_drawings")
    .select("*").eq("owner_id", ownerId).eq("id", drawingId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!data || data.package_id !== packageId) return null;
  return { drawing: data };
}

/** Proves a review belongs to the drawing named in the URL. */
async function requireReviewInDrawing(db, { ownerId, packageId, drawingId, reviewId }) {
  const { data, error } = await db.from("forge_wp_drawing_reviews")
    .select("*").eq("owner_id", ownerId).eq("id", reviewId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!data || data.package_id !== packageId || data.drawing_id !== drawingId) return null;
  return { review: data };
}

/** Proves a redline belongs to the review named in the URL. */
async function requireRedlineInReview(db, { ownerId, packageId, drawingId, reviewId, redlineId }) {
  const { data, error } = await db.from("forge_wp_drawing_redlines")
    .select("*").eq("owner_id", ownerId).eq("id", redlineId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!data || data.package_id !== packageId || data.drawing_id !== drawingId || data.review_id !== reviewId) return null;
  return { redline: data };
}

/** Proves a field redline belongs to the drawing named in the URL. */
async function requireFieldRedlineInDrawing(db, { ownerId, packageId, drawingId, fieldRedlineId }) {
  const { data, error } = await db.from("forge_wp_drawing_field_redlines")
    .select("*").eq("owner_id", ownerId).eq("id", fieldRedlineId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!data || data.package_id !== packageId || data.drawing_id !== drawingId) return null;
  return { fieldRedline: data };
}

/** Creates one immutable IFA revision envelope for a drawing. */
export async function createRevision(db, { ownerId, packageId, drawingId, input }) {
  const validation = validateRevisionInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_revision_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_id: drawingId,
    p_revision_code: input.revisionCode,
    p_document_ref: input.documentRef,
    p_content_sha256: input.contentSha256,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, revision: toCamelRevision(rpcRow(data)) };
}

/** Lists a drawing's revisions, newest issued first. A missing table reads as an empty list. */
export async function listRevisions(db, { ownerId, packageId, drawingId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireDrawingInPackage(db, { ownerId, packageId, drawingId });
  if (proof?.missing) return { ok: true, drawing: null, revisions: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  const { data, error } = await db.from("forge_wp_drawing_revisions")
    .select("*").eq("owner_id", ownerId).eq("drawing_id", drawingId)
    .order("issued_at", { ascending: false }).order("id", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, drawing: toCamelDrawing(proof.drawing), revisions: [] };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(proof.drawing), revisions: (data || []).map(toCamelRevision) };
}

/** Opens one review round on an exact IFA revision. */
export async function createReview(db, { ownerId, packageId, drawingId, input }) {
  const validation = validateReviewInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_review_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_id: drawingId,
    p_drawing_revision_id: input.drawingRevisionId,
    p_reviewer_id: input.reviewerId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_reason: input.reason ?? null,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, review: toCamelReview(rpcRow(data)) };
}

/** Lists a drawing's review rounds, newest first. */
export async function listReviews(db, { ownerId, packageId, drawingId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireDrawingInPackage(db, { ownerId, packageId, drawingId });
  if (proof?.missing) return { ok: true, drawing: null, reviews: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  const { data, error } = await db.from("forge_wp_drawing_reviews")
    .select("*").eq("owner_id", ownerId).eq("drawing_id", drawingId)
    .order("opened_at", { ascending: false }).order("id", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, drawing: toCamelDrawing(proof.drawing), reviews: [] };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(proof.drawing), reviews: (data || []).map(toCamelReview) };
}

/** Reads one review with its redlines and audit events, oldest event first. */
export async function getReviewDetail(db, { ownerId, packageId, drawingId, reviewId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireReviewInDrawing(db, { ownerId, packageId, drawingId, reviewId });
  if (proof?.missing) return { ok: true, review: null, redlines: [], events: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Review not found." };
  const { data: redlines, error: redlinesError } = await db.from("forge_wp_drawing_redlines")
    .select("*").eq("owner_id", ownerId).eq("review_id", reviewId)
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (redlinesError) {
    if (isMissingTableError(redlinesError)) return { ok: true, review: toCamelReview(proof.review), redlines: [], events: [] };
    throw redlinesError;
  }
  const { data: events, error: eventsError } = await db.from("forge_wp_drawing_review_events")
    .select("*").eq("owner_id", ownerId).eq("review_id", reviewId)
    .order("occurred_at", { ascending: true }).order("id", { ascending: true });
  if (eventsError) {
    if (isMissingTableError(eventsError)) return { ok: true, review: toCamelReview(proof.review), redlines: (redlines || []).map(toCamelRedline), events: [] };
    throw eventsError;
  }
  return {
    ok: true,
    review: toCamelReview(proof.review),
    redlines: (redlines || []).map(toCamelRedline),
    events: (events || []).map(toCamelEvent),
  };
}

/** Adds one anchored comment to an OPEN review. */
export async function createRedline(db, { ownerId, packageId, drawingId, reviewId, input }) {
  const validation = validateRedlineInput({ ...input, reviewId });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireReviewInDrawing(db, { ownerId, packageId, drawingId, reviewId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Review not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_redline_create", {
    p_owner_id: ownerId,
    p_review_id: reviewId,
    p_drawing_revision_id: input.drawingRevisionId,
    p_comment: input.comment,
    p_severity: input.severity,
    p_step_id: input.stepId ?? null,
    p_anchor_page: input.anchorPage ?? null,
    p_anchor_x: input.anchorX ?? null,
    p_anchor_y: input.anchorY ?? null,
    p_anchor_text: input.anchorText ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, redline: toCamelRedline(rpcRow(data)) };
}

/** Resolves (or soft-retires) one open redline, guarded by its version. */
export async function resolveRedline(db, { ownerId, packageId, drawingId, reviewId, redlineId, input }) {
  const validation = validateRedlineResolveInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireRedlineInReview(db, { ownerId, packageId, drawingId, reviewId, redlineId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Redline not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_redline_resolve", {
    p_owner_id: ownerId,
    p_redline_id: redlineId,
    p_expected_version: input.expectedVersion,
    p_resolution: input.resolution ?? null,
    p_resolution_note: input.resolutionNote ?? null,
    p_retire: input.retire === true,
    p_reason: input.reason ?? null,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, redline: toCamelRedline(rpcRow(data)) };
}

/** Closes an OPEN review: approve, approve with redlines, or return to drafter. */
export async function decideReview(db, { ownerId, packageId, drawingId, reviewId, input }) {
  const validation = validateReviewDecisionInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireReviewInDrawing(db, { ownerId, packageId, drawingId, reviewId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Review not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_review_decide", {
    p_owner_id: ownerId,
    p_review_id: reviewId,
    p_expected_version: input.expectedVersion,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, review: toCamelReview(rpcRow(data)) };
}

/**
 * Issues one revision for construction. Atomically creates the
 * distinct IFC revision envelope, retires any previous ACTIVE release
 * for the drawing, and records the release. Approval alone never
 * makes a drawing construction-usable — only this release does.
 */
export async function createIfcRelease(db, { ownerId, packageId, drawingId, input }) {
  const validation = validateIfcReleaseInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_ifc_release", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_id: drawingId,
    p_review_id: input.reviewId,
    p_ifc_revision_code: input.ifcRevisionCode,
    p_document_ref: input.documentRef,
    p_content_sha256: input.contentSha256,
    p_reason: input.reason ?? null,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, release: toCamelRelease(rpcRow(data)) };
}

/** Lists a drawing's IFC releases, newest first (retired releases stay on file). */
export async function listIfcReleases(db, { ownerId, packageId, drawingId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireDrawingInPackage(db, { ownerId, packageId, drawingId });
  if (proof?.missing) return { ok: true, drawing: null, releases: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  const { data, error } = await db.from("forge_wp_drawing_ifc_releases")
    .select("*").eq("owner_id", ownerId).eq("drawing_id", drawingId)
    .order("released_at", { ascending: false }).order("id", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, drawing: toCamelDrawing(proof.drawing), releases: [] };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(proof.drawing), releases: (data || []).map(toCamelRelease) };
}

/** Captures one field hand-redline as immutable evidence. */
export async function createFieldRedline(db, { ownerId, packageId, drawingId, input }) {
  const validation = validateFieldRedlineInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_field_redline_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_id: drawingId,
    p_drawing_revision_id: input.drawingRevisionId,
    p_artifact_ref: input.artifactRef,
    p_sha256: input.sha256,
    p_field_reason: input.fieldReason,
    p_review_id: input.reviewId ?? null,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, fieldRedline: toCamelFieldRedline(rpcRow(data)) };
}

/** Lists a drawing's field hand-redlines, newest capture first. */
export async function listFieldRedlines(db, { ownerId, packageId, drawingId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireDrawingInPackage(db, { ownerId, packageId, drawingId });
  if (proof?.missing) return { ok: true, drawing: null, fieldRedlines: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  const { data, error } = await db.from("forge_wp_drawing_field_redlines")
    .select("*").eq("owner_id", ownerId).eq("drawing_id", drawingId)
    .order("captured_at", { ascending: false }).order("id", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, drawing: toCamelDrawing(proof.drawing), fieldRedlines: [] };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(proof.drawing), fieldRedlines: (data || []).map(toCamelFieldRedline) };
}

/**
 * Links a drafter-issued corrected revision to a pending field
 * hand-redline. The evidence artifact is retained — reconciliation
 * records the link, it never replaces or deletes the capture.
 */
export async function reconcileFieldRedline(db, { ownerId, packageId, drawingId, fieldRedlineId, input }) {
  const validation = validateFieldRedlineReconcileInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireFieldRedlineInDrawing(db, { ownerId, packageId, drawingId, fieldRedlineId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Field redline not found." };

  const { data, error } = await db.rpc("forge_wp_drawing_field_redline_reconcile", {
    p_owner_id: ownerId,
    p_field_redline_id: fieldRedlineId,
    p_reconciled_revision_id: input.reconciledRevisionId,
    p_reason: input.reason ?? null,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, fieldRedline: toCamelFieldRedline(rpcRow(data)) };
}

/**
 * Logically retires a drawing: open reviews are cancelled, the ACTIVE
 * IFC release (if any) is retired, and the drawing row carries
 * retired_at — the rounds, redlines and evidence stay on file.
 */
export async function retireDrawing(db, { ownerId, packageId, drawingId, input }) {
  const validation = validateDrawingRetireInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireDrawingInPackage(db, { ownerId, packageId, drawingId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };

  const { data, error } = await db.rpc("forge_wp_drawing_retire", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_id: drawingId,
    p_reason: input.reason,
  });
  if (error) return mapDrawingReviewRpcError(error);
  return { ok: true, drawing: toCamelDrawing(rpcRow(data)) };
}

/**
 * Reads the package's derived drawing readiness from the single
 * snapshot RPC: every drawing with its latest revision, latest review,
 * ACTIVE IFC release and open-required-redline count, plus package
 * counts. A missing table/RPC (pre-migration window) reads as an
 * empty snapshot, never a 500, so the package screen keeps rendering.
 */
export async function getDrawingReadiness(db, { ownerId, packageId }) {
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };
  const { data, error } = await db.rpc("forge_wp_drawing_readiness_snapshot", {
    p_owner_id: ownerId,
    p_package_id: packageId,
  });
  if (error) {
    if (isMissingRpcError(error) || isMissingTableError(error)) {
      return {
        ok: true,
        packageId,
        packageStatus: pkg.status,
        drawings: [],
        counts: {
          drawingsTotal: 0, ifcReleased: 0, pendingReview: 0,
          returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0,
        },
      };
    }
    return mapDrawingReviewRpcError(error);
  }
  const snapshot = rpcRow(data);
  return {
    ok: true,
    packageId: snapshot.package_id ?? snapshot.packageId ?? packageId,
    packageStatus: snapshot.package_status ?? snapshot.packageStatus ?? pkg.status,
    drawings: (snapshot.drawings || []).map(toCamelReadinessDrawing),
    counts: {
      drawingsTotal: snapshot.counts?.drawings_total ?? snapshot.counts?.drawingsTotal ?? 0,
      ifcReleased: snapshot.counts?.ifc_released ?? snapshot.counts?.ifcReleased ?? 0,
      pendingReview: snapshot.counts?.pending_review ?? snapshot.counts?.pendingReview ?? 0,
      returned: snapshot.counts?.returned ?? 0,
      openRequiredRedlines: snapshot.counts?.open_required_redlines ?? snapshot.counts?.openRequiredRedlines ?? 0,
      pendingFieldRedlines: snapshot.counts?.pending_field_redlines ?? snapshot.counts?.pendingFieldRedlines ?? 0,
    },
  };
}
