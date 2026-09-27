import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// The parent event must be an owned, non-deleted manual event — edit history
// can never be read off a foreign or imported event id.
async function ownManualEvent(supabaseClient, effectiveOwnerId, eventId) {
  const { data, error } = await supabaseClient
    .from("financial_events")
    .select("id")
    .eq("owner_id", effectiveOwnerId)
    .eq("id", eventId)
    .eq("source_system", "manual")
    .eq("is_deleted", false)
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

// GET /api/rental/transaction-edits?eventId= — per-transaction edit history,
// newest first. Each row: { id, edited_at, edited_by, changes } where changes
// is { field: { from, to } } for the columns that changed in that edit.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;

    const eventId = new URL(request.url).searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId is required." }, { status: 400 });
    if (!(await ownManualEvent(authenticated.supabaseClient, authenticated.effectiveOwnerId, eventId))) {
      return NextResponse.json({ error: "Transaction was not found." }, { status: 404 });
    }

    const { data, error } = await authenticated.supabaseClient
      .from("financial_event_edits")
      .select("id, edited_at, edited_by, changes")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("event_id", eventId)
      .order("edited_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ success: true, edits: data || [] });
  } catch (error) {
    console.error("Transaction edit history query error", error);
    return NextResponse.json({ error: "Unable to load the edit history." }, { status: 500 });
  }
}
