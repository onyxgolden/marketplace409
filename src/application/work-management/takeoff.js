// FORGE Work Management — Work Package Planner, slice 1 application
// service. db-injected (a supabase-shaped `db` with `.from(table)`
// chains) so it unit-tests with mocks, mirroring packageCosts.js and
// workLinks.js's own convention in this directory.
//
// Deliberately does not touch forge_work_document_library or
// designer_projects — see the migration's own header comment for why.

import {
  validateDrawingInput,
  validateTakeoffLineInput,
  computePidTakeoffSummary,
} from "@/domains/work-management/takeoff.js";

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toCamelDrawing(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingNumber: row.drawing_number,
    drawingType: row.drawing_type,
    title: row.title ?? null,
    pIdDrawingId: row.p_id_drawing_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCamelLine(row) {
  return {
    id: row.id,
    drawingId: row.drawing_id,
    lineNo: row.line_no,
    description: row.description,
    materialSpec: row.material_spec ?? null,
    sizeLabel: row.size_label ?? null,
    quantity: Number(row.quantity),
    unit: row.unit,
    category: row.category,
    fabLocation: row.fab_location,
    fieldWeldCount: row.field_weld_count,
    requiresFieldFit: row.requires_field_fit,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Creates one drawing sheet (P&ID, cut sheet, or isometric) in a work package. */
export async function createDrawing(db, { ownerId, actor, input }) {
  const validation = validateDrawingInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };

  const { data: pkg, error: pkgError } = await db.from("forge_work_packages")
    .select("id").eq("owner_id", ownerId).eq("id", input.packageId).maybeSingle();
  if (pkgError) throw pkgError;
  if (!pkg) return { ok: false, httpStatus: 404, error: "Work package not found." };

  if (input.drawingType !== "p_id") {
    const { data: pidDrawing, error: pidError } = await db.from("forge_work_drawings")
      .select("id, drawing_type").eq("owner_id", ownerId).eq("id", input.pIdDrawingId).maybeSingle();
    if (pidError) throw pidError;
    if (!pidDrawing) return { ok: false, httpStatus: 400, error: "pIdDrawingId does not name an existing drawing." };
    if (pidDrawing.drawing_type !== "p_id") {
      return { ok: false, httpStatus: 400, error: "pIdDrawingId must name a drawing whose drawingType is p_id." };
    }
  }

  const id = newId("forge_wdwg");
  const now = new Date().toISOString();
  const { data, error } = await db.from("forge_work_drawings").insert({
    owner_id: ownerId,
    id,
    package_id: input.packageId,
    drawing_number: input.drawingNumber,
    drawing_type: input.drawingType,
    title: input.title || null,
    p_id_drawing_id: input.drawingType === "p_id" ? null : input.pIdDrawingId,
    created_by: actor,
    created_at: now,
    updated_at: now,
  }).select().single();
  if (error) {
    if (error.code === "23505") return { ok: false, httpStatus: 409, error: `A drawing numbered "${input.drawingNumber}" already exists in this package.` };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(data) };
}

/** Lists every drawing sheet in a work package, P&IDs first, then by drawing number. */
export async function listDrawingsForPackage(db, { ownerId, packageId }) {
  const { data, error } = await db.from("forge_work_drawings")
    .select("*").eq("owner_id", ownerId).eq("package_id", packageId)
    .order("drawing_type", { ascending: true }).order("drawing_number", { ascending: true });
  if (error) throw error;
  return { ok: true, drawings: (data || []).map(toCamelDrawing) };
}

/** Updates one drawing sheet in place (everything editable, per the slice's standing constraints). Only the number, title, and — for cut sheets/isometrics — the P&ID it rolls up to are editable: the drawing's type never changes here, since a type change would move the drawing to a different rollup graph. A type correction is a delete plus a re-add. */
export async function updateDrawing(db, { ownerId, drawingId, patch }) {
  // Only fields the caller actually sent are validated/written — a
  // partial-patch update must not require re-sending every field.
  // drawingType is deliberately not writable (see above).
  const writable = {};
  if (patch.drawingNumber !== undefined) writable.drawing_number = patch.drawingNumber;
  if (patch.title !== undefined) writable.title = patch.title || null;
  if (patch.pIdDrawingId !== undefined) writable.p_id_drawing_id = patch.pIdDrawingId;

  if (Object.keys(writable).length === 0) return { ok: false, httpStatus: 400, error: "No editable fields were supplied." };

  const { data: current, error: currentError } = await db.from("forge_work_drawings")
    .select("*").eq("owner_id", ownerId).eq("id", drawingId).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return { ok: false, httpStatus: 404, error: "Drawing not found." };

  const merged = {
    packageId: current.package_id,
    drawingNumber: patch.drawingNumber !== undefined ? patch.drawingNumber : current.drawing_number,
    drawingType: current.drawing_type,
    title: patch.title !== undefined ? (patch.title || null) : current.title,
    pIdDrawingId: patch.pIdDrawingId !== undefined ? patch.pIdDrawingId : current.p_id_drawing_id,
  };
  const validation = validateDrawingInput(merged);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };

  if (merged.drawingType !== "p_id" && patch.pIdDrawingId !== undefined) {
    const { data: pidDrawing, error: pidError } = await db.from("forge_work_drawings")
      .select("id, drawing_type").eq("owner_id", ownerId).eq("id", merged.pIdDrawingId).maybeSingle();
    if (pidError) throw pidError;
    if (!pidDrawing) return { ok: false, httpStatus: 400, error: "pIdDrawingId does not name an existing drawing." };
    if (pidDrawing.drawing_type !== "p_id") {
      return { ok: false, httpStatus: 400, error: "pIdDrawingId must name a drawing whose drawingType is p_id." };
    }
  }

  writable.updated_at = new Date().toISOString();
  const { data, error } = await db.from("forge_work_drawings")
    .update(writable).eq("owner_id", ownerId).eq("id", drawingId).select().single();
  if (error) {
    if (error.code === "23505") return { ok: false, httpStatus: 409, error: `A drawing numbered "${merged.drawingNumber}" already exists in this package.` };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(data) };
}

/** Deletes a drawing sheet. Refuses if any other drawing still rolls up to it, or it still has takeoff lines — both would be orphaned data, not a cascading convenience delete. */
export async function deleteDrawing(db, { ownerId, drawingId }) {
  const { data: children, error: childError } = await db.from("forge_work_drawings")
    .select("id").eq("owner_id", ownerId).eq("p_id_drawing_id", drawingId).limit(1);
  if (childError) throw childError;
  if (children && children.length > 0) {
    return { ok: false, httpStatus: 409, error: "This P&ID still has other drawings rolled up to it — remove those first." };
  }
  const { data: lines, error: linesError } = await db.from("forge_work_takeoff_lines")
    .select("id").eq("owner_id", ownerId).eq("drawing_id", drawingId).limit(1);
  if (linesError) throw linesError;
  if (lines && lines.length > 0) {
    return { ok: false, httpStatus: 409, error: "This drawing still has takeoff lines — remove those first." };
  }
  const { error } = await db.from("forge_work_drawings").delete().eq("owner_id", ownerId).eq("id", drawingId);
  if (error) throw error;
  return { ok: true };
}

/** Lists every takeoff line on exactly one drawing, in line-number order. */
export async function listTakeoffLinesForDrawing(db, { ownerId, drawingId }) {
  const { data, error } = await db.from("forge_work_takeoff_lines")
    .select("*").eq("owner_id", ownerId).eq("drawing_id", drawingId)
    .order("line_no", { ascending: true });
  if (error) throw error;
  return { ok: true, lines: (data || []).map(toCamelLine) };
}

/** Creates one takeoff line on a drawing. lineNo is assigned as one past the current max for that drawing unless the caller supplies it explicitly. */
export async function createTakeoffLine(db, { ownerId, actor, input }) {
  const { data: drawing, error: drawingError } = await db.from("forge_work_drawings")
    .select("id").eq("owner_id", ownerId).eq("id", input?.drawingId).maybeSingle();
  if (drawingError) throw drawingError;
  if (!drawing) return { ok: false, httpStatus: 404, error: "Drawing not found." };

  let lineNo = input.lineNo;
  if (lineNo == null) {
    const { data: existing, error: existingError } = await db.from("forge_work_takeoff_lines")
      .select("line_no").eq("owner_id", ownerId).eq("drawing_id", input.drawingId)
      .order("line_no", { ascending: false }).limit(1);
    if (existingError) throw existingError;
    lineNo = (existing && existing[0] ? existing[0].line_no : 0) + 1;
  }

  const validation = validateTakeoffLineInput({ ...input, lineNo });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };

  const id = newId("forge_wtol");
  const now = new Date().toISOString();
  const { data, error } = await db.from("forge_work_takeoff_lines").insert({
    owner_id: ownerId,
    id,
    drawing_id: input.drawingId,
    line_no: lineNo,
    description: input.description,
    material_spec: input.materialSpec || null,
    size_label: input.sizeLabel || null,
    quantity: input.quantity,
    unit: input.unit,
    category: input.category,
    fab_location: input.fabLocation,
    field_weld_count: input.fieldWeldCount ?? 0,
    requires_field_fit: input.requiresFieldFit ?? false,
    notes: input.notes || null,
    created_by: actor,
    created_at: now,
    updated_at: now,
  }).select().single();
  if (error) {
    if (error.code === "23505") return { ok: false, httpStatus: 409, error: `Line ${lineNo} already exists on this drawing.` };
    throw error;
  }
  return { ok: true, line: toCamelLine(data) };
}

/** Updates one takeoff line in place (everything editable, per the slice's standing constraints). */
export async function updateTakeoffLine(db, { ownerId, lineId, patch }) {
  const merged = { ...patch, drawingId: patch.drawingId ?? "unused-for-validation-only", lineNo: patch.lineNo ?? 1 };
  // Only fields the caller actually sent are validated/written — a
  // partial-patch update must not require re-sending every field.
  const writable = {};
  if (patch.description !== undefined) writable.description = patch.description;
  if (patch.materialSpec !== undefined) writable.material_spec = patch.materialSpec || null;
  if (patch.sizeLabel !== undefined) writable.size_label = patch.sizeLabel || null;
  if (patch.quantity !== undefined) writable.quantity = patch.quantity;
  if (patch.unit !== undefined) writable.unit = patch.unit;
  if (patch.category !== undefined) writable.category = patch.category;
  if (patch.fabLocation !== undefined) writable.fab_location = patch.fabLocation;
  if (patch.fieldWeldCount !== undefined) writable.field_weld_count = patch.fieldWeldCount;
  if (patch.requiresFieldFit !== undefined) writable.requires_field_fit = patch.requiresFieldFit;
  if (patch.notes !== undefined) writable.notes = patch.notes || null;

  if (Object.keys(writable).length === 0) return { ok: false, httpStatus: 400, error: "No editable fields were supplied." };

  const { data: current, error: currentError } = await db.from("forge_work_takeoff_lines")
    .select("*").eq("owner_id", ownerId).eq("id", lineId).maybeSingle();
  if (currentError) throw currentError;
  if (!current) return { ok: false, httpStatus: 404, error: "Takeoff line not found." };

  const validation = validateTakeoffLineInput({
    drawingId: current.drawing_id,
    lineNo: current.line_no,
    description: writable.description ?? current.description,
    quantity: writable.quantity ?? Number(current.quantity),
    unit: writable.unit ?? current.unit,
    category: writable.category ?? current.category,
    fabLocation: writable.fab_location ?? current.fab_location,
    fieldWeldCount: writable.field_weld_count ?? current.field_weld_count,
    requiresFieldFit: writable.requires_field_fit ?? current.requires_field_fit,
  });
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };

  writable.updated_at = new Date().toISOString();
  const { data, error } = await db.from("forge_work_takeoff_lines")
    .update(writable).eq("owner_id", ownerId).eq("id", lineId).select().single();
  if (error) throw error;
  return { ok: true, line: toCamelLine(data) };
}

export async function deleteTakeoffLine(db, { ownerId, lineId }) {
  const { error } = await db.from("forge_work_takeoff_lines").delete().eq("owner_id", ownerId).eq("id", lineId);
  if (error) throw error;
  return { ok: true };
}

/**
 * The one quantity summary per P&ID the slice brief asks for: resolves
 * the P&ID's own takeoff lines plus every drawing whose pIdDrawingId
 * points at it, then hands the combined set to the pure summary builder.
 */
export async function getPidTakeoffSummary(db, { ownerId, pIdDrawingId }) {
  const { data: pidDrawing, error: pidError } = await db.from("forge_work_drawings")
    .select("id, drawing_type, package_id").eq("owner_id", ownerId).eq("id", pIdDrawingId).maybeSingle();
  if (pidError) throw pidError;
  if (!pidDrawing) return { ok: false, httpStatus: 404, error: "P&ID drawing not found." };
  if (pidDrawing.drawing_type !== "p_id") {
    return { ok: false, httpStatus: 400, error: "This drawing is not a P&ID — summaries are built per P&ID." };
  }

  const { data: childDrawings, error: childError } = await db.from("forge_work_drawings")
    .select("id").eq("owner_id", ownerId).eq("p_id_drawing_id", pIdDrawingId);
  if (childError) throw childError;
  const drawingIds = [pIdDrawingId, ...(childDrawings || []).map((d) => d.id)];

  const { data: lineRows, error: linesError } = await db.from("forge_work_takeoff_lines")
    .select("*").eq("owner_id", ownerId).in("drawing_id", drawingIds)
    .order("drawing_id", { ascending: true }).order("line_no", { ascending: true });
  if (linesError) throw linesError;

  const summary = computePidTakeoffSummary({
    pIdDrawingId,
    lines: (lineRows || []).map(toCamelLine),
  });
  return { ok: true, summary: { ...summary, packageId: pidDrawing.package_id } };
}
