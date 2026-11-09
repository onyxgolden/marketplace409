import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// GET /api/rental/receptionist/alerts — owner-scoped emergency alert
// timeline with provider receipts. Provider-accepted is never presented
// as delivered or human-acknowledged.
export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const { data: alerts, error } = await supabaseClient
      .from("forge_rental_receptionist_alerts")
      .select("id, emergency_event_id, hazard, detected_at, human_ack_at, ack_method, backup_attempted_at, resolution_state")
      .eq("owner_id", effectiveOwnerId)
      .order("detected_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ success: true, alerts: alerts || [] });
  } catch (error) {
    console.error("Receptionist alerts error", error);
    return NextResponse.json({ error: "Unable to load receptionist alerts." }, { status: 500 });
  }
}
