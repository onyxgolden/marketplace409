// FORGE Capture Rung 5 — DELETE /api/capture/library/[id]
//
// Owner-scoped delete: removes the library row, then the storage object.
// Idempotent — deleting an already-gone capture still succeeds. A
// metadata-only 'deleted' audit event is recorded (the audit table has no
// foreign key to capture_library, so the event survives the row's deletion).
import { NextResponse } from "next/server";
import { guardCaptureRequest } from "../../_lib/auth.js";
import { BUCKET, TITLE_MAX, UUID_RE, recordCaptureAudit } from "../../_lib/captureLib.js";

// Rung 6 — Next 15+ hands route handlers `params` as a promise.
async function captureIdFrom(params) {
  const resolved = await params;
  return String(resolved?.id || "").trim();
}

export async function DELETE(request, { params }) {
  const auth = await guardCaptureRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const id = await captureIdFrom(params);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "A valid capture id is required." }, { status: 400 });
    }

    const { data: row, error: lookupError } = await supabaseClient
      .from("capture_library")
      .select("id, storage_path, byte_size, mime_type")
      .eq("owner_id", user.id)
      .eq("id", id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!row) return NextResponse.json({ success: true });

    const { error: deleteError } = await supabaseClient
      .from("capture_library")
      .delete()
      .eq("owner_id", user.id)
      .eq("id", id);
    if (deleteError) throw deleteError;

    const removal = await supabaseClient.storage.from(BUCKET).remove([row.storage_path]);
    if (removal.error) console.error("Capture library storage cleanup error", removal.error);

    await recordCaptureAudit(supabaseClient, {
      ownerId: user.id,
      captureId: id,
      action: "deleted",
      actorId: user.id,
      detail: { mime_type: row.mime_type, byte_size: row.byte_size },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Capture library delete error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete the capture." }, { status: 500 });
  }
}

// FORGE Capture Rung 6 — PATCH /api/capture/library/[id]
//
// Title-only rename. The body is allowlisted: only `title` may change —
// attempts to modify owner_id, storage_path, mime_type, kind, byte_size, or
// captured_at are rejected. Owner-scoped: another owner's row is not
// visible (404), never updated. No audit event: the audit table's action
// check constraint only permits 'uploaded'/'deleted' and a rename changes
// no stored bytes.
export async function PATCH(request, { params }) {
  const auth = await guardCaptureRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const id = await captureIdFrom(params);
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "A valid capture id is required." }, { status: 400 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "A JSON body with a title is required." }, { status: 400 });
    }
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    if (keys.length === 0 || keys.some((key) => key !== "title")) {
      return NextResponse.json({ error: "Only the title may be updated." }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "A non-empty title is required." }, { status: 400 });
    }
    if (title.length > TITLE_MAX) {
      return NextResponse.json({ error: `The title must be at most ${TITLE_MAX} characters.` }, { status: 400 });
    }

    const { data: row, error: updateError } = await supabaseClient
      .from("capture_library")
      .update({ title })
      .eq("owner_id", user.id)
      .eq("id", id)
      .select("id, title")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!row) {
      return NextResponse.json({ error: "Capture not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: row.id, title: row.title });
  } catch (error) {
    console.error("Capture library rename error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to rename the capture." }, { status: 500 });
  }
}
