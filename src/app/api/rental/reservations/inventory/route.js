import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { normalizeReservationInventory } from "@/domains/reservations/availability";

function badRequest(message) { return NextResponse.json({ error: message }, { status: 400 }); }

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const ownerId = authenticated.effectiveOwnerId;
    const [units, settings, rates, blocks] = await Promise.all([
      authenticated.supabaseClient.from("rental_units").select("id,property_id,label,status")
        .eq("owner_id", ownerId).neq("status", "inactive").order("label"),
      authenticated.supabaseClient.from("reservation_inventory_settings").select("*")
        .eq("owner_id", ownerId).order("public_name"),
      authenticated.supabaseClient.from("reservation_rate_plans").select("*")
        .eq("owner_id", ownerId).eq("status", "active").order("effective_start_date"),
      authenticated.supabaseClient.from("reservation_calendar_blocks").select("*")
        .eq("owner_id", ownerId).order("start_date"),
    ]);
    const error = units.error || settings.error || rates.error || blocks.error;
    if (error) throw error;
    return NextResponse.json({ success: true, units: units.data || [], inventory: settings.data || [],
      ratePlans: rates.data || [], calendarBlocks: blocks.data || [] });
  } catch (error) {
    console.error("Reservation inventory query failed", { name: error?.name || "Error" });
    return NextResponse.json({ error: "Unable to load reservation inventory." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    if (body?.operation !== "save-inventory") return badRequest("A supported reservation inventory operation is required.");
    const ownerId = authenticated.effectiveOwnerId;
    const input = normalizeReservationInventory(body.inventory);
    if (!input.unitId) return badRequest("A Rental Manager unit is required.");
    const { data: unit, error: unitError } = await authenticated.supabaseClient.from("rental_units")
      .select("id").eq("owner_id", ownerId).eq("id", input.unitId).neq("status", "inactive").maybeSingle();
    if (unitError) throw unitError;
    if (!unit) return NextResponse.json({ error: "The selected Rental Manager unit was not found." }, { status: 404 });
    const { data: existing, error: existingError } = await authenticated.supabaseClient.from("reservation_inventory_settings")
      .select("created_by,created_at").eq("owner_id", ownerId).eq("unit_id", input.unitId).maybeSingle();
    if (existingError) throw existingError;
    const row = {
      owner_id: ownerId, unit_id: input.unitId, inventory_type: input.inventoryType,
      booking_status: input.bookingStatus, public_name: input.publicName,
      public_description: input.publicDescription, timezone: input.timezone,
      maximum_guests: input.maximumGuests, minimum_nights: input.minimumNights,
      maximum_nights: input.maximumNights, turnover_buffer_hours: input.turnoverBufferHours,
      cleaning_fee_cents: input.cleaningFeeCents, security_deposit_cents: input.securityDepositCents,
      lodging_tax_basis_points: input.lodgingTaxBasisPoints,
      amenities: input.amenities, created_by: existing?.created_by || authenticated.user.id,
      created_at: existing?.created_at || new Date().toISOString(), updated_by: authenticated.user.id,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await authenticated.supabaseClient.from("reservation_inventory_settings")
      .upsert(row, { onConflict: "owner_id,unit_id" }).select("*").single();
    if (error) throw error;
    if (input.nightlyRateCents > 0) {
      const { error: rateError } = await authenticated.supabaseClient.from("reservation_rate_plans").upsert({
        owner_id: ownerId, id: `reservation_rate_${input.unitId}_nightly_base`, unit_id: input.unitId,
        label: "Base nightly rate", cadence: "nightly", amount_cents: input.nightlyRateCents,
        currency_code: "USD", effective_start_date: new Date().toISOString().slice(0, 10),
        effective_end_date: null, day_of_week: null, minimum_nights_override: null,
        status: "active", created_by: authenticated.user.id,
      }, { onConflict: "owner_id,id" });
      if (rateError) throw rateError;
    }
    return NextResponse.json({ success: true, inventory: data });
  } catch (error) {
    if (error instanceof Error && /required|supported|positive|minimum|maximum|turnover/i.test(error.message)) {
      return badRequest(error.message);
    }
    console.error("Reservation inventory save failed", { name: error?.name || "Error" });
    return NextResponse.json({ error: "Unable to save reservation inventory." }, { status: 500 });
  }
}
