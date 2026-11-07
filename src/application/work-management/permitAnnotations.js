// FORGE Work Management — Work Package Planner, slice 3 application
// service. db-injected (a supabase-shaped `db` with `.from(table)`
// chains and `.rpc(name, args)`) so it unit-tests with mocks,
// mirroring progress.js's convention in this directory.
//
// Write-path discipline (slice-3 scope): every mutation goes through
// one of the migration's SECURITY DEFINER RPCs, which perform the
// annotation mutation AND the revision insert in a single transaction
// with an optimistic version guard. The service never writes
// annotations or revisions directly — a direct write could not keep
// the audit atomic. Reads go through the RLS-gated client like slices
// 1 and 2, with the same parent-chain proofs before any row is
// returned (an annotation from another package addressed through this
// package's URL is a 404).
//
// The RPCs derive the audit actor from auth.uid() inside the database
// (slice 2's P1 lesson) — so, unlike takeoff.js, this service takes
// NO actor parameter at all: there is nothing caller-supplied that
// could forge an actor. The route's server-derived actor is the same
// authenticated user id, so legitimate callers see no change.
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the
// annotation tables and RPCs do not exist. List/history calls treat a
// missing table (42P01) as an empty list so the package and takeoff
// screens keep rendering; write calls report 503 with a plain-English
// "not applied yet" message instead of a raw database error. Drawing
// deletes keep the pre-migration direct-delete path as a fallback for
// the same window (see takeoff.js) — before the migration applies no
// annotation can exist, so the fallback can never orphan one.

import {
  validatePermitAnnotationInput,
  validatePermitAnnotationUpdateInput,
  validatePermitAnnotationRetireInput,
} from "@/domains/work-management/permitAnnotations.js";

const NOT_APPLIED_ERROR = "Permit links aren't available yet — the database change for this feature hasn't been applied.";

function toCamelAnnotation(row) {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    targetKind: row.target_kind,
    drawingId: row.drawing_id ?? null,
    originalDrawingId: row.original_drawing_id ?? null,
    label: row.label,
    url: row.url,
    permitReference: row.permit_reference ?? null,
    note: row.note ?? null,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelRevision(row) {
  return {
    id: row.id,
    annotationId: row.annotation_id,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    reason: row.reason ?? null,
    recordedAt: row.recorded_at,
  };
}

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return message.includes("forge_work_permit_annotation") && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

/**
 * Maps a slice-3 RPC failure to a plain-English { ok, httpStatus,
 * error } result. Unknown failures throw, like progress.js — the
 * route turns them into a 500. Exported so takeoff.js's rewired
 * deleteDrawing (which calls the slice-3 delete RPC) maps the same
 * codes the same way.
 */
export function mapPermitAnnotationRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP3_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Permit link not found." };
  }
  if (message.includes("WPP3_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP3_ANNOTATION_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Permit link not found." };
  }
  if (message.includes("WPP3_DRAWING_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  }
  if (message.includes("WPP3_DRAWING_HAS_CHILDREN")) {
    return { ok: false, httpStatus: 409, error: "This P&ID still has other drawings rolled up to it — remove those first." };
  }
  if (message.includes("WPP3_DRAWING_HAS_LINES")) {
    return { ok: false, httpStatus: 409, error: "This drawing still has takeoff lines — remove those first." };
  }
  if (message.includes("WPP3_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This permit link was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP3_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired permit links cannot be changed." };
  }
  if (message.includes("WPP3_INVALID_TARGET")) {
    return { ok: false, httpStatus: 400, error: "Permit links attach to a package or a drawing." };
  }
  if (message.includes("WPP3_INVALID_LABEL")) {
    return { ok: false, httpStatus: 400, error: "Label must be 1–160 characters." };
  }
  if (message.includes("WPP3_INVALID_URL")) {
    return { ok: false, httpStatus: 400, error: "Enter a valid secure (https) web address." };
  }
  if (message.includes("WPP3_REFERENCE_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Permit reference must be at most 120 characters." };
  }
  if (message.includes("WPP3_NOTE_TOO_LONG") || message.includes("WPP3_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Note or reason is too long (2,000 characters maximum)." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Permit annotation RPC returned no row.");
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

/**
 * Proves a drawing belongs to the package named in the URL. Returns
 * the drawing row or null when the chain does not hold. Never trusts
 * a caller-supplied drawing id — the drawing comes from its own row.
 */
async function requireDrawingInPackage(db, { ownerId, packageId, drawingId }) {
  if (!drawingId) return null;
  const { data, error } = await db.from("forge_work_drawings").select("*")
    .eq("owner_id", ownerId).eq("id", drawingId).maybeSingle();
  if (error) throw error;
  if (!data || data.package_id !== packageId) return null;
  return data;
}

/**
 * Proves an annotation belongs to the package named in the URL.
 * Returns the annotation row or null when the chain does not hold.
 */
async function requireAnnotationInPackage(db, { ownerId, packageId, annotationId }) {
  const { data, error } = await db.from("forge_work_permit_annotations").select("*")
    .eq("owner_id", ownerId).eq("id", annotationId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  if (!data || data.work_package_id !== packageId) return null;
  return data;
}

/**
 * Lists annotations on a package, newest first. Filters: targetKind
 * ("package" or "drawing"), drawingId (proves the drawing is in this
 * package first — a drawing from another package is a 404),
 * includeRetired (default false: active only).
 */
export async function listPermitAnnotations(db, { ownerId, packageId, targetKind, drawingId, includeRetired = false, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  if (drawingId) {
    const drawing = await requireDrawingInPackage(db, { ownerId, packageId, drawingId });
    if (!drawing) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  }
  let query = db.from("forge_work_permit_annotations").select("*")
    .eq("owner_id", ownerId).eq("work_package_id", packageId);
  if (targetKind) query = query.eq("target_kind", targetKind);
  if (drawingId) query = query.eq("drawing_id", drawingId);
  if (!includeRetired) query = query.is("retired_at", null);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, annotations: [] };
    throw error;
  }
  return { ok: true, annotations: (data || []).map(toCamelAnnotation) };
}

/** Creates one annotation on a package or one of its drawings. Domain validation runs before any database call. */
export async function createPermitAnnotation(db, { ownerId, packageId, input }) {
  const validation = validatePermitAnnotationInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  if (input?.targetKind === "drawing") {
    const drawing = await requireDrawingInPackage(db, { ownerId, packageId, drawingId: input.drawingId });
    if (!drawing) return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  }
  const { data, error } = await db.rpc("forge_work_permit_annotation_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_target_kind: input.targetKind,
    p_drawing_id: input.targetKind === "drawing" ? input.drawingId : null,
    p_label: validation.values.label,
    p_url: validation.values.url,
    p_permit_reference: validation.values.permitReference,
    p_note: validation.values.note,
  });
  if (error) return mapPermitAnnotationRpcError(error);
  return { ok: true, annotation: toCamelAnnotation(rpcRow(data)) };
}

/** Updates one annotation's label/URL/reference/note, guarded by the caller's expected version. Never retargets. */
export async function updatePermitAnnotation(db, { ownerId, packageId, annotationId, patch }) {
  const validation = validatePermitAnnotationUpdateInput(patch);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireAnnotationInPackage(db, { ownerId, packageId, annotationId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Permit link not found." };
  const { data, error } = await db.rpc("forge_work_permit_annotation_update", {
    p_owner_id: ownerId,
    p_annotation_id: annotationId,
    p_expected_version: patch.expectedVersion,
    p_label: validation.values.label ?? null,
    p_url: validation.values.url ?? null,
    p_permit_reference: validation.values.permitReference ?? null,
    p_note: validation.values.note ?? null,
    p_reason: validation.values.reason ?? null,
    // Presence is separate from value: a supplied field (even an
    // explicit null/empty, which clears it) sets its flag; an absent
    // field leaves the flag false and the RPC preserves the value.
    // validation.values holds only supplied fields, so `undefined`
    // here means "absent" and `null` means "explicitly cleared".
    p_set_reference: validation.values.permitReference !== undefined,
    p_set_note: validation.values.note !== undefined,
  });
  if (error) return mapPermitAnnotationRpcError(error);
  return { ok: true, annotation: toCamelAnnotation(rpcRow(data)) };
}

/** Retires one annotation (soft delete), guarded by the caller's expected version. No restore in this slice. */
export async function retirePermitAnnotation(db, { ownerId, packageId, annotationId, input }) {
  const validation = validatePermitAnnotationRetireInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireAnnotationInPackage(db, { ownerId, packageId, annotationId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Permit link not found." };
  const { data, error } = await db.rpc("forge_work_permit_annotation_retire", {
    p_owner_id: ownerId,
    p_annotation_id: annotationId,
    p_expected_version: input.expectedVersion,
    p_reason: validation.values.reason,
  });
  if (error) return mapPermitAnnotationRpcError(error);
  return { ok: true, annotation: toCamelAnnotation(rpcRow(data)) };
}

/** Returns one annotation's full immutable revision history, oldest first. */
export async function getPermitAnnotationHistory(db, { ownerId, packageId, annotationId }) {
  const proof = await requireAnnotationInPackage(db, { ownerId, packageId, annotationId });
  if (!proof) return { ok: false, httpStatus: 404, error: "Permit link not found." };
  const { data, error } = await db.from("forge_work_permit_annotation_revisions").select("*")
    .eq("owner_id", ownerId).eq("annotation_id", annotationId)
    .order("version", { ascending: true });
  if (error) {
    if (isMissingTableError(error)) return { ok: true, revisions: [] };
    throw error;
  }
  return { ok: true, revisions: (data || []).map(toCamelRevision) };
}
