import { NextResponse } from "next/server";
import { buildReservationOperationalDashboard } from "@/domains/reservations/operationalDashboard";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const periodDays = Number(new URL(request.url).searchParams.get("days") || 90);
    if (![30, 90, 365].includes(periodDays)) return NextResponse.json({ error: "Dashboard period must be 30, 90, or 365 days." }, { status: 400 });
    const ownerId = authenticated.effectiveOwnerId;
    const [inventory, reservations, blocks] = await Promise.all([
      authenticated.supabaseClient.from("reservation_inventory_settings").select("unit_id,inventory_type,booking_status,public_name").eq("owner_id", ownerId),
      authenticated.supabaseClient.from("reservations").select("unit_id,status,check_in_date,check_out_date,total_due_cents").eq("owner_id", ownerId),
      authenticated.supabaseClient.from("reservation_calendar_blocks").select("unit_id,start_date,end_date,block_type").eq("owner_id", ownerId),
    ]);
    const error = inventory.error || reservations.error || blocks.error;
    if (error) throw error;
    const dashboard = buildReservationOperationalDashboard({ inventory: inventory.data || [], reservations: reservations.data || [], calendarBlocks: blocks.data || [], today: new Date().toISOString().slice(0, 10), periodDays });
    return NextResponse.json({ success: true, dashboard });
  } catch (error) {
    console.error("Reservation operations dashboard query failed", { name: error?.name || "Error" });
    return NextResponse.json({ error: "Unable to load the reservation operations dashboard." }, { status: 500 });
  }
}
