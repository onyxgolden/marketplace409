// FORGE Work Management — Document library domain (Rung 5).
//
// Pure, deterministic domain logic: no DB, no network, no Date.now().
// The planner's own per-client document repository (table 49,
// forge_work_document_library). Kind is free text on purpose — the three
// base kinds below are UI suggestions, each client defines their own.

export const DOCUMENT_KIND_SUGGESTIONS = Object.freeze([
  "template",
  "filled_form",
  "reference",
]);

export const DOCUMENT_KIND_LABELS = Object.freeze({
  template: "Template (download, fill out, re-upload)",
  filled_form: "Filled form",
  reference: "Reference",
});

export const DOCUMENT_ALLOWED_MIME_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

export const DOCUMENT_MAX_BYTES = 26214400; // 25 MB

// Validate a document-upload input. Pure shape checks; the application
// layer verifies the workspace, the predecessor version, and the template
// source against the database.
export function validateDocumentInput(input) {
  const errors = [];
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) errors.push("Document name is required.");
  const kind = typeof input?.kind === "string" ? input.kind.trim() : "";
  if (!kind) errors.push("Document kind is required.");
  const mimeType = input?.mime_type;
  if (!DOCUMENT_ALLOWED_MIME_TYPES.includes(mimeType)) {
    errors.push(
      `mime_type must be one of: ${DOCUMENT_ALLOWED_MIME_TYPES.join(", ")}.`
    );
  }
  const byteSize = input?.byte_size;
  if (!Number.isInteger(byteSize) || byteSize <= 0) {
    errors.push("byte_size must be a positive integer.");
  } else if (byteSize > DOCUMENT_MAX_BYTES) {
    errors.push(`byte_size must not exceed ${DOCUMENT_MAX_BYTES} bytes (25 MB).`);
  }
  const originalFilename =
    typeof input?.original_filename === "string" ? input.original_filename.trim() : "";
  if (!originalFilename) errors.push("original_filename is required.");
  if (input?.template_source_id !== undefined && input?.template_source_id !== null &&
      (typeof input.template_source_id !== "string" || !input.template_source_id.trim())) {
    errors.push("template_source_id must be a non-empty string when provided.");
  }
  if (input?.version_of_document_id !== undefined && input?.version_of_document_id !== null &&
      (typeof input.version_of_document_id !== "string" || !input.version_of_document_id.trim())) {
    errors.push("version_of_document_id must be a non-empty string when provided.");
  }
  return { ok: errors.length === 0, errors };
}

// The next version number in a version family, given the highest existing
// version number (or 0 when this is the first version).
export function nextVersionNumber(highestExisting) {
  const n = Number.isInteger(highestExisting) && highestExisting >= 0 ? highestExisting : 0;
  return n + 1;
}

// Object path for the stored file: <owner_id>/<document_id>/<filename>.
// The first segment is the workspace owner so storage RLS can scope it.
export function documentObjectPath(ownerId, documentId, filename) {
  const safe = String(filename || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
  return `${ownerId}/${documentId}/${safe}`;
}
