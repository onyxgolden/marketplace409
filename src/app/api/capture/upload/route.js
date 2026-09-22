// FORGE Capture Rung 5 — POST /api/capture/upload
//
// Opt-in cloud destination for the desktop app's "Save to FORGE" button.
// Local-first is unchanged: nothing reaches this route without the user's
// explicit action.
//
// Idempotency (ChatGPT required change): the client generates a capture UUID
// and sends it as captureId; the server uses it as the row's primary key.
// A retry with the same id returns the existing artifact with a fresh signed
// URL instead of creating a duplicate — no silent background retries.
import { NextResponse } from "next/server";
import { guardCaptureRequest } from "../_lib/auth.js";
import {
  BUCKET,
  MAX_BYTES,
  MIME_EXTENSIONS,
  TITLE_MAX,
  UUID_RE,
  createLibrarySignedUrl,
  parseCapturedAt,
  parsePositiveInt,
  recordCaptureAudit,
  serializeLibraryItem,
  storagePathFor,
} from "../_lib/captureLib.js";

const ROW_COLUMNS = "id, title, kind, mime_type, byte_size, width, height, storage_path, captured_at, created_at";

function kindFor(mimeType, requested) {
  if (requested === "screenshot" || requested === "recording") return requested;
  return mimeType.startsWith("video/") ? "recording" : "screenshot";
}

export async function POST(request) {
  const auth = await guardCaptureRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const form = await request.formData();
    const file = form.get("file");
    const captureId = String(form.get("captureId") || "").trim();

    if (!UUID_RE.test(captureId)) {
      return NextResponse.json({ error: "captureId must be a UUID." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "A capture file is required." }, { status: 400 });
    }
    const extension = MIME_EXTENSIONS[file.type];
    if (!extension) {
      return NextResponse.json({ error: "Use a PNG, JPEG, or WebM capture." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Capture must be 25 MB or smaller." }, { status: 400 });
    }

    // Idempotent retry: the row already exists for this owner → hand back a
    // fresh signed URL without re-uploading.
    const { data: existing, error: existingError } = await supabaseClient
      .from("capture_library")
      .select(ROW_COLUMNS)
      .eq("owner_id", user.id)
      .eq("id", captureId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      const signedUrl = await createLibrarySignedUrl(supabaseClient, existing.storage_path);
      return NextResponse.json({ success: true, id: existing.id, signedUrl, duplicate: true });
    }

    const title = String(form.get("title") || "").trim().slice(0, TITLE_MAX) || null;
    const kind = kindFor(file.type, String(form.get("kind") || "").trim());
    const width = parsePositiveInt(form.get("width"));
    const height = parsePositiveInt(form.get("height"));
    const capturedAt = parseCapturedAt(form.get("capturedAt"));

    const storagePath = storagePathFor(user.id, captureId, extension);
    const upload = await supabaseClient.storage
      .from(BUCKET)
      .upload(storagePath, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;

    const { error: insertError } = await supabaseClient.from("capture_library").insert({
      id: captureId,
      owner_id: user.id,
      title,
      kind,
      mime_type: file.type,
      byte_size: file.size,
      width,
      height,
      storage_path: storagePath,
      captured_at: capturedAt,
    });
    if (insertError) {
      // Never leave an orphaned storage object when the row write fails.
      await supabaseClient.storage.from(BUCKET).remove([storagePath]);
      // Lost race: a concurrent retry with the same id won the insert.
      // Return the winner instead of an error.
      if (insertError.code === "23505") {
        const { data: winner } = await supabaseClient
          .from("capture_library")
          .select(ROW_COLUMNS)
          .eq("owner_id", user.id)
          .eq("id", captureId)
          .maybeSingle();
        if (winner) {
          const signedUrl = await createLibrarySignedUrl(supabaseClient, winner.storage_path);
          return NextResponse.json({ success: true, id: winner.id, signedUrl, duplicate: true });
        }
      }
      throw insertError;
    }

    // Metadata-only audit: no captured content, pixels, OCR, or filenames.
    await recordCaptureAudit(supabaseClient, {
      ownerId: user.id,
      captureId,
      action: "uploaded",
      actorId: user.id,
      detail: { kind, mime_type: file.type, byte_size: file.size },
    });

    const signedUrl = await createLibrarySignedUrl(supabaseClient, storagePath);
    const item = serializeLibraryItem(
      {
        id: captureId, title, kind, mime_type: file.type, byte_size: file.size,
        width, height, captured_at: capturedAt, created_at: new Date().toISOString(),
      },
      signedUrl,
    );
    return NextResponse.json({ success: true, id: item.id, signedUrl: item.signedUrl });
  } catch (error) {
    console.error("Capture upload error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save the capture." }, { status: 500 });
  }
}
