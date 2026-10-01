import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { rowToApplication } from "../route";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { data: application, error } = await authenticated.supabaseClient
      .from("rental_applications").select("*")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", (await params).id).maybeSingle();
    if (error) throw error;
    if (!application) return NextResponse.json({ error: "Application was not found." }, { status: 404 });

    const { data: listing, error: listingError } = await authenticated.supabaseClient
      .from("rental_listings").select("id, title, public_slug, unit_id, property_id, rent_cents")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", application.listing_id).maybeSingle();
    if (listingError) throw listingError;

    let form = null;
    if (application.form_id) {
      const { data: formRow, error: formError } = await authenticated.supabaseClient
        .from("rental_listing_forms")
        .select("id, name, sections, custom_questions, fee_amount_cents, consent_text")
        .eq("owner_id", authenticated.effectiveOwnerId).eq("id", application.form_id).maybeSingle();
      if (formError) throw formError;
      form = formRow;
    }

    const { data: decisions, error: decisionsError } = await authenticated.supabaseClient
      .from("rental_application_decisions")
      .select("id, action, reason, actor_user_id, tenant_id, lease_id, created_at")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("application_id", application.id)
      .order("created_at", { ascending: true });
    if (decisionsError) throw decisionsError;

    return NextResponse.json({
      success: true,
      application: rowToApplication(application, listing ? { [listing.id]: listing } : {}),
      listing: listing ? {
        id: listing.id, title: listing.title, publicSlug: listing.public_slug,
        unitId: listing.unit_id, propertyId: listing.property_id, rentCents: listing.rent_cents,
      } : null,
      form,
      decisions: decisions || [],
    });
  } catch (error) {
    console.error("Application detail error", error);
    return NextResponse.json({ error: "Unable to load the application." }, { status: 500 });
  }
}
