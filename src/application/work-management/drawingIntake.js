// FORGE Work Management — Slice-7 PDF blockers: controlled PDF drawing
// intake application service. db-injected (a supabase-shaped `db` with
// `.from(table)` chains, `.rpc(name, args)` and `.storage`), mirroring
// drawingReviews.js and workDocuments.js in this directory.
//
// Reserve / upload / verify / finalize (storage and PostgreSQL are not
// one transaction):
//   1. Validate the inputs + the PDF bytes in the domain module, and
//      compute the SHA-256 on the server from the actual bytes. The
//      client never supplies a hash.
//   2. Replay check: a finalized receipt for the same request id +
//      digest returns the original receipt; the same request id with a
//      different digest is a 409.
//   3. Upload the object FIRST (upsert: false) to the private
//      `controlled-drawings` bucket at
//      <owner_id>/<package_id>/<request_id>/<sha256>.pdf.
//   4. Finalize through the SECURITY DEFINER intake/stage RPC, which
//      resolves-or-creates the drawing envelope, creates the immutable
//      revision (IFA) or stages the IFC candidate, and records the
//      artifact row — the idempotent audit receipt — in one
//      transaction. The RPC's request-id unique index is the final
//      arbiter for a concurrent duplicate finalize.
//   5. On RPC failure the uploaded object is removed (the bucket's
//      orphan-cleanup storage policy permits removing only objects no
//      artifact row references), so a failed finalize never leaves an
//      orphaned file. If the object already exists from a crashed
//      earlier attempt, its bytes are re-downloaded and hash-verified
//      before proceeding.
//
// The RPCs derive the audit actor from auth.uid() inside the database,
// so — like drawingReviews.js — this service takes NO actor parameter:
// there is nothing caller-supplied that could forge an actor.
//
// Deployment-order note: the code deploys on merge while the migration
// applies on a separate word. Until the migration applies, the
// artifacts table, bucket and RPCs do not exist; write calls report 503
// with the plain-English "not applied yet" message, and list calls read
// as empty — the same convention as drawingReviews.js.

import { createHash } from "node:crypto";
import {
  CONTROLLED_DRAWINGS_BUCKET,
  validateControlledDrawingIntakeInput,
  validateIfcStageInput,
  validatePdfFile,
} from "@/domains/work-management/drawingReviews.js";
import { mapDrawingReviewRpcError } from "./drawingReviews.js";

const NOT_APPLIED_ERROR = "Controlled drawing intake isn't available yet — the database change for this feature hasn't been applied.";

export function computeSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function intakeObjectPath({ ownerId, packageId, requestId, sha256 }) {
  return `${ownerId}/${packageId}/${requestId}/${sha256}.pdf`;
}

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = String(error.message || error || "");
  return message.includes("forge_wp_drawing_artifacts") && message.includes("does not exist");
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

function isObjectExistsError(error) {
  if (!error) return false;
  if (error.statusCode === 409 || error.status === 409) return true;
  return /already exists/i.test(String(error.message || error || ""));
}

export function toCamelArtifact(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    drawingId: row.drawing_id,
    revisionId: row.revision_id ?? null,
    purpose: row.purpose,
    bucket: row.bucket,
    objectPath: row.object_path,
    originalFilename: row.original_filename ?? null,
    contentSha256: row.content_sha256,
    contentLength: row.content_length,
    requestId: row.request_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
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
    lineNumber: row.line_number ?? null,
    pIdDrawingId: row.p_id_drawing_id ?? null,
    retiredAt: row.retired_at ?? null,
    retiredBy: row.retired_by ?? null,
  };
}

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

function rpcRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Controlled drawing RPC returned no row.");
  return row;
}

async function findReceipt(db, { ownerId, requestId }) {
  const { data, error } = await db.from("forge_wp_drawing_artifacts")
    .select("*").eq("owner_id", ownerId).eq("request_id", requestId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { missing: true };
    throw error;
  }
  return { artifact: data || null };
}

async function readReceiptRows(db, { ownerId, artifact }) {
  let drawing = null;
  let revision = null;
  try {
    const { data: drawingRow } = await db.from("forge_work_drawings")
      .select("*").eq("owner_id", ownerId).eq("id", artifact.drawing_id).maybeSingle();
    if (drawingRow) drawing = toCamelDrawing(drawingRow);
  } catch {
    // The artifact row is the receipt; the drawing/revision reads are
    // convenience. A read failure never voids a finalized intake.
  }
  if (artifact.revision_id) {
    try {
      const { data: revisionRow } = await db.from("forge_wp_drawing_revisions")
        .select("*").eq("owner_id", ownerId).eq("id", artifact.revision_id).maybeSingle();
      if (revisionRow) revision = toCamelRevision(revisionRow);
    } catch {
      // See above.
    }
  }
  return { drawing, revision };
}

// Uploads the bytes, verifying a pre-existing object at the same path
// (a crashed earlier attempt) by re-downloading and hashing it.
async function uploadVerifiedObject(db, { objectPath, bytes, sha256 }) {
  const bucket = db.storage.from(CONTROLLED_DRAWINGS_BUCKET);
  const { error } = await bucket.upload(objectPath, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (!error) return { ok: true };
  if (!isObjectExistsError(error)) {
    return { ok: false, httpStatus: 503, error: "The controlled drawing file could not be stored — try again." };
  }
  const { data: existing, error: downloadError } = await bucket.download(objectPath);
  if (downloadError || !existing) {
    return { ok: false, httpStatus: 409, error: "A different file already exists at this upload's storage path — use a new request id." };
  }
  const existingBytes = existing instanceof Uint8Array
    ? existing
    : new Uint8Array(await existing.arrayBuffer());
  if (computeSha256(existingBytes) !== sha256) {
    return { ok: false, httpStatus: 409, error: "A different file already exists at this upload's storage path — use a new request id." };
  }
  return { ok: true, preExisting: true };
}

async function removeObject(db, objectPath) {
  try {
    await db.storage.from(CONTROLLED_DRAWINGS_BUCKET).remove([objectPath]);
  } catch {
    // Cleanup is best-effort: the orphan-cleanup storage policy also
    // lets a later retry remove an unreferenced object.
  }
}

/**
 * Uploads one controlled PDF as an immutable IFA revision. Creates the
 * drawing envelope when the (owner, package, drawing number) has none
 * yet; otherwise attaches the revision to the existing envelope. The
 * file bytes are verified server-side and the SHA-256 is computed here
 * — the client hash is never trusted.
 */
export async function uploadControlledDrawing(db, { ownerId, packageId, input, file }) {
  const validation = validateControlledDrawingIntakeInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const bytes = file?.bytes;
  const fileValidation = validatePdfFile({ bytes, mimeType: file?.mimeType });
  if (!fileValidation.ok) return { ok: false, httpStatus: 400, error: fileValidation.errors.join(" ") };
  const sha256 = computeSha256(bytes);
  const objectPath = intakeObjectPath({ ownerId, packageId, requestId: input.requestId, sha256 });

  const receipt = await findReceipt(db, { ownerId, requestId: input.requestId });
  if (receipt?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (receipt?.artifact) {
    // Fix round 1: the request id binds ONE operation to ONE semantic
    // target. A receipt is only a replay when it names this operation
    // (purpose ifa_issued), this package, this drawing (number/type/
    // revision code) and this digest. A same-id, same-digest call for
    // a different package, drawing, revision or operation is refused
    // (409) instead of silently returning the first operation's
    // artifact. A receipt whose drawing/revision cannot be loaded
    // fails closed the same way — the target cannot be verified.
    const row = receipt.artifact;
    const digestMatches = row.content_sha256.toLowerCase() === sha256;
    const operationMatches = row.purpose === "ifa_issued" && row.package_id === packageId;
    if (!digestMatches || !operationMatches) {
      return { ok: false, httpStatus: 409, error: "This request was already used for a different upload — use a new request id." };
    }
    const artifact = toCamelArtifact(row);
    const { drawing, revision } = await readReceiptRows(db, { ownerId, artifact: row });
    const targetMatches =
      drawing !== null && revision !== null
      && drawing.drawingNumber === input.drawingNumber
      && drawing.drawingType === input.drawingType
      && revision.revisionCode === input.revisionCode
      && (drawing.lineNumber === null || input.lineNumber == null
        || drawing.lineNumber === input.lineNumber);
    if (!targetMatches) {
      return { ok: false, httpStatus: 409, error: "This request was already used for a different upload — use a new request id." };
    }
    return { ok: true, replayed: true, artifact, drawing, revision };
  }

  const uploaded = await uploadVerifiedObject(db, { objectPath, bytes, sha256 });
  if (!uploaded.ok) return uploaded;

  const issuedAt = input.issueDate ? new Date(`${input.issueDate}T12:00:00Z`).toISOString() : null;
  const { data, error } = await db.rpc("forge_wp_drawing_controlled_intake", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_number: input.drawingNumber,
    p_drawing_type: input.drawingType,
    p_revision_code: input.revisionCode,
    p_object_path: objectPath,
    p_content_sha256: sha256,
    p_content_length: bytes.length,
    p_request_id: input.requestId,
    p_line_number: input.lineNumber || null,
    p_issued_at: issuedAt,
    p_issuer_ref: input.issuerRef || null,
    p_title: input.title || null,
    p_p_id_drawing_id: input.pIdDrawingId || null,
    p_original_filename: file.originalFilename || null,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      await removeObject(db, objectPath);
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
    }
    await removeObject(db, objectPath);
    return mapDrawingReviewRpcError(error);
  }
  const artifact = toCamelArtifact(rpcRow(data));
  const { drawing, revision } = await readReceiptRows(db, { ownerId, artifact: rpcRow(data) });
  return { ok: true, replayed: false, artifact, drawing, revision };
}

/**
 * Stages a drafter-issued PDF as an IFC candidate for one drawing. No
 * revision is created: the bytes stay pending until the IFC release
 * attaches them. The staged bytes must differ from the latest issued
 * revision (enforced by the RPC).
 */
export async function stageIfcArtifact(db, { ownerId, packageId, drawingId, input, file }) {
  const validation = validateIfcStageInput(input);
  if (!validation.ok) return { ok: false, httpStatus: 400, error: validation.errors.join(" ") };
  const bytes = file?.bytes;
  const fileValidation = validatePdfFile({ bytes, mimeType: file?.mimeType });
  if (!fileValidation.ok) return { ok: false, httpStatus: 400, error: fileValidation.errors.join(" ") };
  const sha256 = computeSha256(bytes);
  const objectPath = intakeObjectPath({ ownerId, packageId, requestId: input.requestId, sha256 });

  const receipt = await findReceipt(db, { ownerId, requestId: input.requestId });
  if (receipt?.missing) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  if (receipt?.artifact) {
    // Fix round 1: same binding as the intake replay — the receipt
    // must name this operation (purpose ifc_candidate), this package
    // and this exact drawing, with the same digest. A same-id call
    // for a different operation, package or drawing is refused (409),
    // never replayed as the first operation's artifact.
    const row = receipt.artifact;
    const replayMatches =
      row.content_sha256.toLowerCase() === sha256
      && row.purpose === "ifc_candidate"
      && row.package_id === packageId
      && row.drawing_id === drawingId;
    if (!replayMatches) {
      return { ok: false, httpStatus: 409, error: "This request was already used for a different staging — use a new request id." };
    }
    return { ok: true, replayed: true, artifact: toCamelArtifact(row) };
  }

  const uploaded = await uploadVerifiedObject(db, { objectPath, bytes, sha256 });
  if (!uploaded.ok) return uploaded;

  const { data, error } = await db.rpc("forge_wp_drawing_ifc_stage", {
    p_owner_id: ownerId,
    p_package_id: packageId,
    p_drawing_id: drawingId,
    p_object_path: objectPath,
    p_content_sha256: sha256,
    p_content_length: bytes.length,
    p_request_id: input.requestId,
    p_original_filename: file.originalFilename || null,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      await removeObject(db, objectPath);
      return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
    }
    await removeObject(db, objectPath);
    return mapDrawingReviewRpcError(error);
  }
  return { ok: true, replayed: false, artifact: toCamelArtifact(rpcRow(data)) };
}

/** Lists a drawing's stored artifacts (issued + staged), newest first. A missing table reads as an empty list. */
export async function listArtifacts(db, { ownerId, packageId, drawingId }) {
  const { data: drawing, error: drawingError } = await db.from("forge_work_drawings")
    .select("*").eq("owner_id", ownerId).eq("id", drawingId).maybeSingle();
  if (drawingError) {
    if (isMissingTableError(drawingError)) return { ok: true, drawing: null, artifacts: [] };
    throw drawingError;
  }
  if (!drawing || drawing.package_id !== packageId) {
    return { ok: false, httpStatus: 404, error: "Drawing not found in this package." };
  }
  const { data, error } = await db.from("forge_wp_drawing_artifacts")
    .select("*").eq("owner_id", ownerId).eq("drawing_id", drawingId)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return { ok: true, drawing: toCamelDrawing(drawing), artifacts: [] };
    throw error;
  }
  return { ok: true, drawing: toCamelDrawing(drawing), artifacts: (data || []).map(toCamelArtifact) };
}

/** Mints a short-lived signed read/preview URL for one stored artifact. */
export async function getArtifactPreviewUrl(db, { ownerId, packageId, drawingId, artifactId }) {
  const { data, error } = await db.from("forge_wp_drawing_artifacts")
    .select("*").eq("owner_id", ownerId).eq("id", artifactId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
    throw error;
  }
  if (!data || data.package_id !== packageId || data.drawing_id !== drawingId) {
    return { ok: false, httpStatus: 404, error: "Controlled drawing file not found." };
  }
  const { data: signed, error: signedError } = await db.storage
    .from(CONTROLLED_DRAWINGS_BUCKET)
    .createSignedUrl(data.object_path, 3600);
  if (signedError || !signed?.signedUrl) {
    return { ok: false, httpStatus: 503, error: "The controlled drawing preview could not be prepared — try again." };
  }
  return { ok: true, url: signed.signedUrl, expiresInSeconds: 3600, artifact: toCamelArtifact(data) };
}
