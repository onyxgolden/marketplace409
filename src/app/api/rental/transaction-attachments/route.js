import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

const BUCKET = "rental-ledger-attachments";
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_BYTES = 10 * 1024 * 1024;
const safe = (value) => String(value || "file").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change transaction attachments." }, { status: 403 });
  }
  return null;
}

// The event must belong to the workspace — attachments can never be hung on a
// foreign event id.
async function ownEvent(supabaseClient, effectiveOwnerId, eventId) {
  const { data, error } = await supabaseClient
    .from("financial_events")
    .select("id")
    .eq("owner_id", effectiveOwnerId)
    .eq("id", eventId)
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

// GET /api/rental/transaction-attachments?eventId= — list attachments.
// GET /api/rental/transaction-attachments?attachmentId=&action=download — signed URL.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId");
    const attachmentId = url.searchParams.get("attachmentId");

    if (attachmentId) {
      const { data: row, error } = await authenticated.supabaseClient
        .from("financial_event_attachments")
        .select("id, event_id, bucket, object_path, filename")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("id", attachmentId)
        .limit(1);
      if (error) throw error;
      if (!row || row.length === 0) return NextResponse.json({ error: "Attachment was not found." }, { status: 404 });
      const signed = await authenticated.supabaseClient.storage
        .from(row[0].bucket)
        .createSignedUrl(row[0].object_path, 600, url.searchParams.get("action") === "download" ? { download: true } : undefined);
      if (signed.error) throw signed.error;
      return NextResponse.json({ success: true, url: signed.data.signedUrl });
    }

    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });
    if (!(await ownEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId))) {
      return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });
    }
    const { data, error } = await authenticated.supabaseClient
      .from("financial_event_attachments")
      .select("id, filename, mime_type, size_bytes, created_at")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, attachments: data || [] });
  } catch (error) {
    console.error("Transaction attachment query error", error);
    return NextResponse.json({ error: "Unable to load attachments." }, { status: 500 });
  }
}

// POST /api/rental/transaction-attachments — multipart: eventId + file.
// Uploads to the private rental-ledger-attachments bucket and records the row.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const form = await request.formData();
    const eventId = String(form.get("eventId") || "").trim();
    const file = form.get("file");
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "A file is required." }, { status: 400 });
    if (!TYPES.has(file.type) || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Use a PDF, JPG, or PNG no larger than 10 MB." }, { status: 400 });
    }
    if (!(await ownEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId))) {
      return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });
    }

    const objectPath = `${authenticated.effectiveOwnerId}/${eventId}/${Date.now()}-${safe(file.name)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = await authenticated.supabaseClient.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: file.type, upsert: false,
    });
    if (upload.error) throw upload.error;

    const { data, error } = await authenticated.supabaseClient
      .from("financial_event_attachments")
      .insert({
        owner_id: authenticated.effectiveOwnerId,
        event_id: eventId,
        bucket: BUCKET,
        object_path: objectPath,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select("id, filename, mime_type, size_bytes, created_at")
      .limit(1);
    if (error) {
      await authenticated.supabaseClient.storage.from(BUCKET).remove([objectPath]);
      throw error;
    }
    return NextResponse.json({ success: true, attachment: (data || [])[0] || null });
  } catch (error) {
    console.error("Transaction attachment upload error", error);
    return NextResponse.json({ error: "Unable to upload the attachment." }, { status: 500 });
  }
}

// DELETE /api/rental/transaction-attachments?attachmentId= — removes the row and
// the storage object.
export async function DELETE(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const attachmentId = new URL(request.url).searchParams.get("attachmentId");
    if (!attachmentId) return NextResponse.json({ error: "attachmentId is required." }, { status: 400 });
    const { data: rows, error: lookupError } = await authenticated.supabaseClient
      .from("financial_event_attachments")
      .select("id, bucket, object_path")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", attachmentId)
      .limit(1);
    if (lookupError) throw lookupError;
    if (!rows || rows.length === 0) return NextResponse.json({ error: "Attachment was not found." }, { status: 404 });

    const { error: deleteError } = await authenticated.supabaseClient
      .from("financial_event_attachments")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", attachmentId);
    if (deleteError) throw deleteError;
    await authenticated.supabaseClient.storage.from(rows[0].bucket).remove([rows[0].object_path]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Transaction attachment delete error", error);
    return NextResponse.json({ error: "Unable to remove the attachment." }, { status: 500 });
  }
}
