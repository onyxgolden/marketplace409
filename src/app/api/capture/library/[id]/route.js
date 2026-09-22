// FORGE Capture Rung 5 — DELETE /api/capture/library/[id]
//
// Owner-scoped delete: removes the library row, then the storage object.
// Idempotent — deleting an already-gone capture still succeeds. A
// metadata-only 'deleted' audit event is recorded (the audit table has no
// foreign key to capture_library, so the event survives the row's deletion).
import { NextResponse } from "next/server";
import { guardCaptureRequest } from "../../_lib/auth.js";
import { BUCKET, UUID_RE, recordCaptureAudit } from "../../_lib/captureLib.js";

export async function DELETE(request, { params }) {
  const auth = await guardCaptureRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const id = String(params?.id || "").trim();
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
