import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// GET /api/rental/receptionist/calls?filter=emergency|unacknowledged|needs-review|all
// Owner-scoped list for the Brandy-facing Calls/Receptionist inbox.
// AI-captured claims are labelled unverified; nothing here is a verified
// tenant fact.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const filter = new URL(request.url).searchParams.get("filter") || "all";

    let query = supabaseClient
      .from("forge_rental_receptionist_calls")
      .select("id, provider_call_sid, started_at, ended_at, intent, caller_ani_masked, name_claimed, need_excerpt, callback_confirmed, emergency_event_id, processing_state, policy_version")
      .eq("owner_id", effectiveOwnerId)
      .order("started_at", { ascending: false })
      .limit(100);
    if (filter === "emergency") query = query.eq("intent", "EMERGENCY");
    if (filter === "needs-review") query = query.eq("processing_state", "INCOMPLETE");
    const { data: calls, error } = await query;
    if (error) throw error;

    let unacknowledged = new Set();
    if (filter === "unacknowledged") {
      const { data: alerts, error: alertError } = await supabaseClient
        .from("forge_rental_receptionist_alerts")
        .select("emergency_event_id")
        .eq("owner_id", effectiveOwnerId)
        .eq("resolution_state", "UNRESOLVED");
      if (alertError) throw alertError;
      unacknowledged = new Set((alerts || []).map((a) => a.emergency_event_id));
    }
    const shaped = (calls || [])
      .filter((c) => filter !== "unacknowledged" || unacknowledged.has(c.emergency_event_id))
      .map((c) => ({ ...c, unacknowledged: unacknowledged.has(c.emergency_event_id) }));
    return NextResponse.json({ success: true, calls: shaped });
  } catch (error) {
    console.error("Receptionist calls error", error);
    return NextResponse.json({ error: "Unable to load receptionist calls." }, { status: 500 });
  }
}
