// FORGE Work Management — Work Package Planner, slice 5 application
// service. db-injected (a supabase-shaped `db` with `.from(table)`
// chains and `.rpc(name, args)`) so it unit-tests with mocks,
// mirroring craftAssignments.js's convention in this directory.
//
// Write-path discipline (slice-5 scope): every mutation goes through
// one of the migration's SECURITY DEFINER RPCs, which perform the
// step mutation AND the revision insert in a single transaction with
// an optimistic version guard (and, for reorder/retire, the shared
// sequence renumbering). The service never writes steps, revisions,
// links, or order rows directly — a direct write could not keep the
// audit atomic. Reads go through the RLS-gated client like slices
// 1–4, with the same parent-chain proofs before any row is returned
// (a step from another package addressed through this package's URL
// is a 404).
//
// The RPCs derive the audit actor from auth.uid() inside the database
// (slice 2's P1 lesson) — so, unlike takeoff.js, this service takes
// NO actor parameter at all: there is nothing caller-supplied that
// could forge an actor. The route's server-derived actor is the same
// authenticated user id, so legitimate callers see no change.
//
// Two scope §4 items are explicitly DEFERRED in this slice (see the
// migration header): assignment attribution (no work_step_id on
// slice-4 assignments) and takeoff links (no mapping table). This
// service must not fabricate either association — the steps panel
// shows package/date read-only assignment context from the existing
// craft-assignments read path, and no per-step progress attribution.
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the step
// tables and RPCs do not exist. List/history calls treat a missing
// table (42P01) as an empty list so the package screen keeps
// rendering; write calls report 503 with a plain-English "not applied
// yet" message instead of a raw database error. The package row
// itself exists (slice 1), so the package-existence proof still runs
// in the pre-migration window — only the step tables are missing, and
// only their queries are treated as empty.

import {
  validateWorkStepInput,
  validateWorkStepUpdateInput,
  validateWorkStepRetireInput,
  validateWorkStepReorderInput,
  validateWorkStepMoveInput,
  validateWorkStepLinkInput,
  validateWorkStepLinkRetireInput,
} from "@/domains/work-management/workSteps.js";

const NOT_APPLIED_ERROR = "Work steps aren't available yet — the database change for this feature hasn't been applied.";

function toCamelStep(row) {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    title: row.title,
    description: row.description ?? null,
    sequenceNo: row.sequence_no,
    craftKey: row.craft_key ?? null,
    craftLabel: row.craft_label ?? null,
    plannedDurationDays: row.planned_duration_days ?? null,
    plannedPersonHours: row.planned_person_hours == null ? null : Number(row.planned_person_hours),
    sourceNote: row.source_note ?? null,
    supersedesStepId: row.supersedes_step_id ?? null,
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
    stepId: row.step_id,
    version: row.version,
    actorId: row.actor_id,
    action: row.action,
    oldValues: row.old_values ?? null,
    newValues: row.new_values ?? null,
    reason: row.reason ?? null,
    recordedAt: row.recorded_at,
  };
}

function toCamelLink(row) {
  return {
    id: row.id,
    workPackageId: row.work_package_id,
    stepId: row.step_id,
    drawingId: row.drawing_id ?? null,
    originalDrawingId: row.original_drawing_id,
    refinementNote: row.refinement_note ?? null,
    version: row.version,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    drawing: row.drawing ?? null,
  };
}

function toCamelLinkRevision(row) {
  return {
    id: row.id,
    linkId: row.link_id,
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
  return message.includes("forge_work_step") && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

/**
 * Maps a slice-5 RPC failure to a plain-English { ok, httpStatus,
 * error } result. Unknown failures throw, like progress.js — the
 * route turns them into a 500.
 */
export function mapWorkStepRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("WPP5_WORKSPACE_FORBIDDEN")) {
    return { ok: false, httpStatus: 404, error: "Work step not found." };
  }
  if (message.includes("WPP5_PACKAGE_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work package not found." };
  }
  if (message.includes("WPP5_STEP_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Work step not found." };
  }
  if (message.includes("WPP5_LINK_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Drawing link not found." };
  }
  if (message.includes("WPP5_DRAWING_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  }
  if (message.includes("WPP5_VERSION_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This work step was changed by someone else — refresh and try again." };
  }
  if (message.includes("WPP5_RETIRED")) {
    return { ok: false, httpStatus: 409, error: "Retired work steps cannot be changed." };
  }
  if (message.includes("WPP5_DUPLICATE")) {
    return { ok: false, httpStatus: 409, error: "This step is already linked to that drawing." };
  }
  if (message.includes("WPP5_PACKAGE_TERMINAL")) {
    return { ok: false, httpStatus: 409, error: "This work package is closed — new steps cannot be added, and only corrections to existing steps are allowed." };
  }
  if (message.includes("WPP5_INVALID_ORDER")) {
    return { ok: false, httpStatus: 400, error: "The new order must list every active step exactly once." };
  }
  if (message.includes("WPP5_INVALID_SUPERSEDES")) {
    return { ok: false, httpStatus: 400, error: "A replacement step must point at a retired step in this same package." };
  }
  if (message.includes("WPP5_INVALID_POSITION")) {
    return { ok: false, httpStatus: 400, error: "Insert position must be within the current step list." };
  }
  if (message.includes("WPP5_INVALID_TITLE")) {
    return { ok: false, httpStatus: 400, error: "Title must be 1–160 characters, starting with a letter or digit and using plain text only." };
  }
  if (message.includes("WPP5_INVALID_DESCRIPTION")) {
    return { ok: false, httpStatus: 400, error: "Description must be at most 4000 characters, with no control characters or HTML." };
  }
  if (message.includes("WPP5_INVALID_CRAFT")) {
    return { ok: false, httpStatus: 400, error: "Craft must be 1–80 characters, using letters, numbers, spaces, hyphens and common punctuation." };
  }
  if (message.includes("WPP5_INVALID_DURATION")) {
    return { ok: false, httpStatus: 400, error: "Planned duration must be a whole number between 1 and 366 days." };
  }
  if (message.includes("WPP5_INVALID_HOURS")) {
    return { ok: false, httpStatus: 400, error: "Planned person-hours must be more than 0 and at most 1,000,000, with at most two decimal places." };
  }
  if (message.includes("WPP5_INVALID_NOTE")) {
    return { ok: false, httpStatus: 400, error: "Note must be at most 1,000 characters." };
  }
  if (message.includes("WPP5_REASON_REQUIRED")) {
    return { ok: false, httpStatus: 400, error: "A reason is required for this change." };
  }
  if (message.includes("WPP5_REASON_TOO_LONG")) {
    return { ok: false, httpStatus: 400, error: "Reason must be at most 1,000 characters." };
  }
  throw error;
}

/** Normalizes an RPC row result: PostgREST may return the single row bare or in a one-element array. */
function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Work step RPC returned no row.");
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

/** Proves a step belongs to the package named in the URL. */
async function requireStepInPackage(db, { ownerId, packageId, stepId }) {
  const { data: step, error } = await db.from("forge_work_steps")
    .select("*").eq("owner_id", ownerId).eq("id", stepId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!step || step.work_package_id !== packageId) return null;
  return { step };
}

/** Proves a drawing link belongs to the step named in the URL. */
async function requireLinkInStep(db, { ownerId, packageId, stepId, linkId }) {
  const { data: link, error } = await db.from("forge_work_step_drawing_links")
    .select("*").eq("owner_id", ownerId).eq("id", linkId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  if (!link || link.work_package_id !== packageId || link.step_id !== stepId) return null;
  return { link };
}

/** Creates one planned work step, appended at the end unless insertAt positions it. */
export async function createWorkStep(db, { ownerId, packageId, input }) {
  const validation = validateWorkStepInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_work_step_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_title: input.title,
    p_description: input.description ?? null,
    p_craft_label: input.craftLabel ?? null,
    p_planned_duration_days: input.plannedDurationDays ?? null,
    p_planned_person_hours: input.plannedPersonHours ?? null,
    p_source_note: input.sourceNote ?? null,
    p_supersedes_step_id: input.supersedesStepId ?? null,
    p_insert_at: input.insertAt ?? null,
    p_reason: input.reason ?? null,
  });
  if (error) return mapWorkStepRpcError(error);
  return { ok: true, step: toCamelStep(rpcRow(data)) };
}

/**
 * Updates one step (title, description, craft, estimates, source
 * note). Guarded by the caller's expected version. Presence
 * semantics: description/craftLabel/plannedDurationDays/
 * plannedPersonHours/sourceNote use explicit null to clear; every
 * other supplied field must be a valid value. supersedesStepId is
 * immutable and never accepted here.
 */
export async function updateWorkStep(db, { ownerId, packageId, stepId, patch }) {
  const validation = validateWorkStepUpdateInput(patch);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireStepInPackage(db, { ownerId, packageId, stepId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Work step not found." };

  const { data, error } = await db.rpc("forge_work_step_update", {
    p_owner_id: ownerId,
    p_step_id: stepId,
    p_expected_version: patch.expectedVersion,
    p_title: patch.title ?? null,
    p_description: patch.description ?? null,
    p_craft_label: patch.craftLabel ?? null,
    p_planned_duration_days: patch.plannedDurationDays ?? null,
    p_planned_person_hours: patch.plannedPersonHours ?? null,
    p_source_note: patch.sourceNote ?? null,
    p_set_description: patch.description !== undefined,
    p_set_craft_label: patch.craftLabel !== undefined,
    p_set_duration_days: patch.plannedDurationDays !== undefined,
    p_set_person_hours: patch.plannedPersonHours !== undefined,
    p_set_source_note: patch.sourceNote !== undefined,
    p_historical_correction: patch.historicalCorrection === true,
    p_reason: patch.reason ?? null,
  });
  if (error) return mapWorkStepRpcError(error);
  return { ok: true, step: toCamelStep(rpcRow(data)) };
}

/**
 * Reorders the active steps of a package to exactly the caller's
 * permutation, guarded by the sequence generation the caller listed
 * against. Returns the reordered active steps plus the new
 * generation.
 */
export async function reorderWorkSteps(db, { ownerId, packageId, stepIds, expectedGeneration, reason }) {
  const validation = validateWorkStepReorderInput({ stepIds, expectedGeneration, reason });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_work_step_reorder", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_step_ids: stepIds,
    p_expected_generation: expectedGeneration,
    p_reason: reason ?? null,
  });
  if (error) return mapWorkStepRpcError(error);
  const steps = (Array.isArray(data) ? data : []).map(toCamelStep);
  const generation = await readOrderGeneration(db, { ownerId, packageId });
  return { ok: true, steps, generation };
}

/**
 * Moves one active step to a target position (1..N), guarded by the
 * sequence generation the caller listed against. Unlike a full
 * reorder, a move never needs the caller to enumerate the active
 * set — the new order is computed inside the transaction from the
 * live active steps. Returns the reordered active steps plus the new
 * generation.
 */
export async function moveWorkStep(db, { ownerId, packageId, stepId, targetSequenceNo, expectedGeneration, reason }) {
  const validation = validateWorkStepMoveInput({ stepId, targetSequenceNo, expectedGeneration, reason });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  const { data, error } = await db.rpc("forge_work_step_move", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_step_id: stepId,
    p_target_sequence_no: targetSequenceNo,
    p_expected_generation: expectedGeneration,
    p_reason: reason ?? null,
  });
  if (error) return mapWorkStepRpcError(error);
  const steps = (Array.isArray(data) ? data : []).map(toCamelStep);
  const generation = await readOrderGeneration(db, { ownerId, packageId });
  return { ok: true, steps, generation };
}

/** Retires one step (excluded from the active sequence, kept in history). */
export async function retireWorkStep(db, { ownerId, packageId, stepId, expectedVersion, reason, historicalCorrection }) {
  const validation = validateWorkStepRetireInput({ expectedVersion, reason });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireStepInPackage(db, { ownerId, packageId, stepId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Work step not found." };

  const { data, error } = await db.rpc("forge_work_step_retire", {
    p_owner_id: ownerId,
    p_step_id: stepId,
    p_expected_version: expectedVersion,
    p_reason: reason,
    p_historical_correction: historicalCorrection === true,
  });
  if (error) return mapWorkStepRpcError(error);
  return { ok: true, step: toCamelStep(rpcRow(data)) };
}

/** Reads the package's current sequence generation (0 when no order row exists yet). */
async function readOrderGeneration(db, { ownerId, packageId }) {
  const { data, error } = await db.from("forge_work_step_order")
    .select("generation").eq("owner_id", ownerId).eq("work_package_id", packageId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return 0;
    throw error;
  }
  return data?.generation ?? 0;
}

/**
 * Lists the steps of a package in schedule order (active first, by
 * sequence, then retired). A missing table (pre-migration window)
 * reads as an empty list — never a 500 — so the package screen keeps
 * rendering before the migration applies.
 *
 * Active and retired are fetched separately by the panel: active with
 * includeRetired=false (paged, exhaustively, so a schedule longer
 * than one page is never silently truncated) and retired with
 * retiredOnly=true (paged separately, so retired rows can never crowd
 * active rows — or supersession candidates — out of a page).
 */
export async function listWorkSteps(db, { ownerId, packageId, includeRetired, retiredOnly, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const pkg = await requirePackage(db, { ownerId, packageId });
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  let query = db.from("forge_work_steps")
    .select("*").eq("owner_id", ownerId).eq("work_package_id", packageId);
  if (retiredOnly === true) query = query.not("retired_at", "is", null);
  else if (includeRetired === false) query = query.is("retired_at", null);
  const { data, error } = await query
    .order("retired_at", { ascending: true, nullsFirst: true })
    .order("sequence_no", { ascending: true })
    .order("id", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: true, steps: [], generation: 0, packageStatus: pkg.status };
    }
    throw error;
  }
  const generation = await readOrderGeneration(db, { ownerId, packageId });
  return {
    ok: true,
    steps: (data || []).map(toCamelStep),
    generation,
    packageStatus: pkg.status,
  };
}

/** Reads one step's full audit history, oldest revision first. */
export async function listWorkStepRevisions(db, { ownerId, packageId, stepId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireStepInPackage(db, { ownerId, packageId, stepId });
  if (proof?.missing) return { ok: true, step: null, revisions: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Work step not found." };
  const { data, error } = await db.from("forge_work_step_revisions")
    .select("*").eq("owner_id", ownerId).eq("step_id", stepId)
    .order("version", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, step: toCamelStep(proof.step), revisions: [] };
    throw error;
  }
  return { ok: true, step: toCamelStep(proof.step), revisions: (data || []).map(toCamelRevision) };
}

/** Links one controlled drawing to a step as planning context (never edits the drawing). */
export async function createStepDrawingLink(db, { ownerId, packageId, stepId, input }) {
  const validation = validateWorkStepLinkInput({ stepId, drawingId: input?.drawingId, refinementNote: input?.refinementNote, reason: input?.reason });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireStepInPackage(db, { ownerId, packageId, stepId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Work step not found." };

  const { data, error } = await db.rpc("forge_work_step_link_drawing_create", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_step_id: stepId,
    p_drawing_id: input.drawingId,
    p_refinement_note: input.refinementNote ?? null,
    p_reason: input.reason ?? null,
  });
  if (error) return mapWorkStepRpcError(error);
  return { ok: true, link: toCamelLink(rpcRow(data)) };
}

/** Retires one step-drawing link (kept in link history). */
export async function retireStepDrawingLink(db, { ownerId, packageId, stepId, linkId, expectedVersion, reason }) {
  const validation = validateWorkStepLinkRetireInput({ expectedVersion, reason });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const proof = await requireLinkInStep(db, { ownerId, packageId, stepId, linkId });
  if (proof?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing link not found." };

  const { data, error } = await db.rpc("forge_work_step_link_drawing_retire", {
    p_owner_id: ownerId,
    p_link_id: linkId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) return mapWorkStepRpcError(error);
  return { ok: true, link: toCamelLink(rpcRow(data)) };
}

/**
 * Lists a step's drawing links with the linked drawing's display
 * info merged in (drawing number/type/title). A link whose drawing
 * was deleted carries drawing: null and is identified by its
 * originalDrawingId. A missing table (pre-migration window) reads as
 * an empty list.
 */
export async function listStepDrawings(db, { ownerId, packageId, stepId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireStepInPackage(db, { ownerId, packageId, stepId });
  if (proof?.missing) return { ok: true, step: null, links: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Work step not found." };
  const { data, error } = await db.from("forge_work_step_drawing_links")
    .select("*").eq("owner_id", ownerId).eq("work_package_id", packageId).eq("step_id", stepId)
    .order("created_at", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, step: toCamelStep(proof.step), links: [] };
    throw error;
  }
  const links = data || [];
  const drawingIds = [...new Set(links.map((link) => link.drawing_id).filter(Boolean))];
  let drawingsById = {};
  if (drawingIds.length > 0) {
    const { data: drawings, error: drawingsError } = await db.from("forge_work_drawings")
      .select("id, drawing_number, drawing_type, title").eq("owner_id", ownerId).in("id", drawingIds);
    if (drawingsError) throw drawingsError;
    drawingsById = Object.fromEntries((drawings || []).map((drawing) => [drawing.id, {
      id: drawing.id,
      drawingNumber: drawing.drawing_number,
      drawingType: drawing.drawing_type,
      title: drawing.title ?? null,
    }]));
  }
  return {
    ok: true,
    step: toCamelStep(proof.step),
    links: links.map((link) => toCamelLink({ ...link, drawing: link.drawing_id ? (drawingsById[link.drawing_id] ?? null) : null })),
  };
}

/** Reads one drawing link's full audit history, oldest revision first. */
export async function listStepDrawingLinkRevisions(db, { ownerId, packageId, stepId, linkId, limit, offset }) {
  const paging = resolvePaging({ limit, offset });
  if (paging.error) return { ok: false, httpStatus: 400, error: paging.error };
  const proof = await requireLinkInStep(db, { ownerId, packageId, stepId, linkId });
  if (proof?.missing) return { ok: true, link: null, revisions: [] };
  if (!proof) return { ok: false, httpStatus: 404, error: "Drawing link not found." };
  const { data, error } = await db.from("forge_work_step_drawing_link_revisions")
    .select("*").eq("owner_id", ownerId).eq("link_id", linkId)
    .order("version", { ascending: true })
    .range(paging.offset, paging.offset + paging.limit - 1);
  if (error) {
    if (isMissingTableError(error)) return { ok: true, link: toCamelLink(proof.link), revisions: [] };
    throw error;
  }
  return { ok: true, link: toCamelLink(proof.link), revisions: (data || []).map(toCamelLinkRevision) };
}
