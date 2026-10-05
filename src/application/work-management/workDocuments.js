// FORGE Work Management — Document library application service (Rung 5).
//
// db-injected orchestration over forge_work_document_library and the
// 'work-documents' storage bucket. All functions take a supabase-shaped
// `db` so they unit-test with mocks. The authenticated API routes resolve
// owner_id via workAuth (workspace model) and pass the acting user as
// actor — attribution is never isolation.

import {
  validateDocumentInput, documentObjectPath,
} from "@/domains/work-management/workDocuments.js";

const TABLE = "forge_work_document_library";
const BUCKET = "work-documents";

function newId() {
  return `work_document_${crypto.randomUUID()}`;
}

// List the workspace's documents, current versions first. Optional kind
// filter; pass includeSuperseded to see old versions too. Soft-deleted
// rows are never listed — history is preserved, not destroyed.
export async function listDocuments(db, ownerId, { kind = null, includeSuperseded = false } = {}) {
  let query = db.from(TABLE).select("*").eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (kind) query = query.eq("kind", kind);
  if (!includeSuperseded) query = query.eq("is_current_version", true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Upload a new document (or a new version of an existing one).
// file: { name, type, size, bytes: Uint8Array }.
// Version creation is atomic: the database function locks the version
// family, computes the next version, supersedes the old current, and
// inserts — one transaction, so overlapping uploads can never leave zero
// (or two) current versions. Returns the inserted row. On failure the
// uploaded object is removed so storage never holds orphaned files.
//
// uploaded_by is stamped by the database trigger from auth.uid(), never
// from the actor argument — the parameter stays for signature stability.
export async function uploadDocument(db, ownerId, actor, file, fields = {}) {
  const validation = validateDocumentInput({
    name: fields.name, kind: fields.kind, mime_type: file.type,
    byte_size: file.size, original_filename: file.name,
    template_source_id: fields.templateSourceId ?? null,
    version_of_document_id: fields.versionOfDocumentId ?? null,
  });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  // Friendly 400s before the atomic write: predecessor must exist (its
  // template link is inherited), and a named template source must exist.
  let templateSourceId = fields.templateSourceId || null;
  if (fields.versionOfDocumentId) {
    const { data: predecessor, error: predecessorError } = await db.from(TABLE)
      .select("id, template_source_id")
      .eq("owner_id", ownerId).eq("id", fields.versionOfDocumentId)
      .is("deleted_at", null).maybeSingle();
    if (predecessorError) throw predecessorError;
    if (!predecessor) return { ok: false, errors: ["The document to version does not exist."] };
    if (!templateSourceId) templateSourceId = predecessor.template_source_id || null;
  }

  if (templateSourceId) {
    const { data: template, error: templateError } = await db.from(TABLE)
      .select("id").eq("owner_id", ownerId).eq("id", templateSourceId)
      .is("deleted_at", null).maybeSingle();
    if (templateError) throw templateError;
    if (!template) return { ok: false, errors: ["The template this copy was made from does not exist."] };
  }

  const id = newId();
  const objectPath = documentObjectPath(ownerId, id, file.name);
  const { error: uploadError } = await db.storage.from(BUCKET)
    .upload(objectPath, file.bytes, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data: rpcData, error: rpcError } = await db.rpc(
    "forge_work_create_document_version", {
      p_owner_id: ownerId, p_id: id,
      p_name: String(fields.name).trim(),
      p_kind: String(fields.kind).trim(),
      p_description: fields.description ? String(fields.description).trim() : null,
      p_mime_type: file.type, p_byte_size: file.size,
      p_bucket: BUCKET, p_object_path: objectPath,
      p_original_filename: file.name,
      p_version_of_document_id: fields.versionOfDocumentId || null,
      p_template_source_id: templateSourceId,
    });
  if (rpcError) {
    await db.storage.from(BUCKET).remove([objectPath]);
    // Backstop: a uniqueness conflict means two writers raced on this
    // version family — either past the advisory lock (version-number index)
    // or via a direct write outside the RPC (one-current-version index).
    // Either way the retry re-runs the atomic RPC, which supersedes cleanly.
    // The storage cleanup above is now permitted by the orphan-cleanup
    // policy (objects no document row references); referenced files stay
    // protected.
    if (rpcError.code === "23505") {
      return {
        ok: false, retryable: true,
        errors: ["Another version was uploaded at the same time — please retry."],
      };
    }
    throw rpcError;
  }
  const document = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  return { ok: true, document };
}

// Signed download/preview URL for one document in this workspace.
// Soft-deleted documents are not servable.
export async function getDocumentUrl(db, ownerId, documentId, { download = false } = {}) {
  const { data: doc, error } = await db.from(TABLE)
    .select("bucket, object_path, original_filename").eq("owner_id", ownerId)
    .eq("id", documentId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!doc) return { ok: false, error: "Document not found." };
  const { data: signed, error: signError } = await db.storage.from(doc.bucket)
    .createSignedUrl(doc.object_path, 3600,
      download ? { download: doc.original_filename } : undefined);
  if (signError) throw signError;
  return { ok: true, url: signed.signedUrl };
}

// "Delete" a document: soft-delete only. The row and its file stay, so
// version history is never destroyed — the library is an audit trail.
export async function deleteDocument(db, ownerId, documentId) {
  const { data: doc, error } = await db.from(TABLE)
    .select("id").eq("owner_id", ownerId)
    .eq("id", documentId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!doc) return { ok: false, error: "Document not found." };
  const { error: deleteError } = await db.from(TABLE)
    .update({ deleted_at: new Date().toISOString(), is_current_version: false })
    .eq("owner_id", ownerId).eq("id", documentId);
  if (deleteError) throw deleteError;
  return { ok: true };
}
