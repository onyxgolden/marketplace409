// FORGE Capture Rung 5 — GET /api/capture/library
//
// The owner's capture rows, newest first, each with a 1-hour signed URL.
// API-only this rung: no web library UI page.
import { NextResponse } from "next/server";
import { guardCaptureRequest } from "../_lib/auth.js";
import { createLibrarySignedUrl, serializeLibraryItem } from "../_lib/captureLib.js";

const ROW_COLUMNS = "id, title, kind, mime_type, byte_size, width, height, storage_path, captured_at, created_at";
const PAGE_LIMIT = 100;

export async function GET(request) {
  const auth = await guardCaptureRequest(request);
  if (auth.response) return auth.response;
  const { user, supabaseClient } = auth;

  try {
    const { data: rows, error } = await supabaseClient
      .from("capture_library")
      .select(ROW_COLUMNS)
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT);
    if (error) throw error;

    const items = [];
    for (const row of rows || []) {
      const signedUrl = await createLibrarySignedUrl(supabaseClient, row.storage_path);
      items.push(serializeLibraryItem(row, signedUrl));
    }
    return NextResponse.json({ success: true, items });
  } catch (error) {
    console.error("Capture library error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the library." }, { status: 500 });
  }
}
