// FORGE Capture Rung 5 — shared constants and helpers for the
// capture-library API (upload / library / delete).
//
// Upload/delete audit events are metadata-only: actor, object id, timestamp,
// action. Never captured content, pixels, OCR, or filenames of captured
// content. No share links / share events exist in this rung.

export const BUCKET = "capture-library";
// Single server-enforced cap for both screenshots and recordings.
export const MAX_BYTES = 25 * 1024 * 1024;
export const SIGNED_URL_SECONDS = 3600;

export const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/webm": "webm",
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TITLE_MAX = 200;

export function parsePositiveInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function parseCapturedAt(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

// Storage paths are server-derived: <owner_id>/capture/<capture_uuid>.<ext>.
// The first folder segment always equals the authenticated user's id, which
// is what the storage RLS policies check.
export function storagePathFor(ownerId, captureId, extension) {
  return `${ownerId}/capture/${captureId}.${extension}`;
}

export async function createLibrarySignedUrl(supabaseClient, storagePath) {
  const signed = await supabaseClient.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (signed.error) throw signed.error;
  return signed.data.signedUrl;
}

export function serializeLibraryItem(row, signedUrl) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    width: row.width,
    height: row.height,
    captured_at: row.captured_at,
    created_at: row.created_at,
    signedUrl,
  };
}

export async function recordCaptureAudit(supabaseClient, { ownerId, captureId, action, actorId, detail = {} }) {
  const { error } = await supabaseClient.from("capture_library_audit_log").insert({
    owner_id: ownerId,
    capture_id: captureId,
    action,
    actor_id: actorId,
    detail,
  });
  if (error) throw error;
}
