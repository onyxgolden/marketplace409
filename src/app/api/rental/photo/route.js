import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

const BUCKET = "rental-photos";
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5242880;
const ENTITY_TABLES = { unit: "rental_units", tenant: "rental_tenants" };

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;

    const form = await request.formData();
    const file = form.get("file");
    const entityType = String(form.get("entityType") || "");
    const entityId = String(form.get("entityId") || "").trim();
    const table = ENTITY_TABLES[entityType];

    if (!table) return NextResponse.json({ error: "entityType must be unit or tenant." }, { status: 400 });
    if (!entityId) return NextResponse.json({ error: "entityId is required." }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "A photo file is required." }, { status: 400 });
    const extension = TYPES[file.type];
    if (!extension) return NextResponse.json({ error: "Use a JPG, PNG, or WEBP image." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photo must be 5 MB or smaller." }, { status: 400 });

    const { data: entity, error: entityError } = await authenticated.supabaseClient
      .from(table).select("id").eq("owner_id", authenticated.user.id).eq("id", entityId).maybeSingle();
    if (entityError) throw entityError;
    if (!entity) return NextResponse.json({ error: `${entityType === "unit" ? "Unit" : "Tenant"} was not found.` }, { status: 404 });

    const objectPath = `${authenticated.user.id}/${entityType}s/${entityId}/${crypto.randomUUID()}.${extension}`;
    const upload = await authenticated.supabaseClient.storage.from(BUCKET)
      .upload(objectPath, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;

    const updated = await authenticated.supabaseClient.from(table)
      .update({ photo_bucket: BUCKET, photo_object_path: objectPath, updated_at: new Date().toISOString() })
      .eq("owner_id", authenticated.user.id).eq("id", entityId).select("id").maybeSingle();
    if (updated.error) {
      await authenticated.supabaseClient.storage.from(BUCKET).remove([objectPath]);
      throw updated.error;
    }

    const signed = await authenticated.supabaseClient.storage.from(BUCKET).createSignedUrl(objectPath, 3600);
    if (signed.error) throw signed.error;

    return NextResponse.json({ success: true, photoUrl: signed.data.signedUrl });
  } catch (error) {
    console.error("Rental photo upload error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to upload the photo." }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;

    const body = await request.json();
    const entityType = String(body.entityType || "");
    const entityId = String(body.entityId || "").trim();
    const table = ENTITY_TABLES[entityType];

    if (!table) return NextResponse.json({ error: "entityType must be unit or tenant." }, { status: 400 });
    if (!entityId) return NextResponse.json({ error: "entityId is required." }, { status: 400 });

    const { data: entity, error: entityError } = await authenticated.supabaseClient
      .from(table).select("photo_bucket, photo_object_path").eq("owner_id", authenticated.user.id).eq("id", entityId).maybeSingle();
    if (entityError) throw entityError;
    if (!entity) return NextResponse.json({ error: `${entityType === "unit" ? "Unit" : "Tenant"} was not found.` }, { status: 404 });
    if (!entity.photo_object_path) return NextResponse.json({ success: true });

    const updated = await authenticated.supabaseClient.from(table)
      .update({ photo_bucket: null, photo_object_path: null, updated_at: new Date().toISOString() })
      .eq("owner_id", authenticated.user.id).eq("id", entityId).select("id").maybeSingle();
    if (updated.error) throw updated.error;

    const removal = await authenticated.supabaseClient.storage.from(entity.photo_bucket).remove([entity.photo_object_path]);
    if (removal.error) console.error("Rental photo storage cleanup error", removal.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Rental photo removal error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove the photo." }, { status: 500 });
  }
}
