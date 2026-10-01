import { NextResponse } from "next/server";
import { createPublicListingClient } from "@/lib/supabase/createPublicListingClient";

export const runtime = "nodejs";

// Public (no login) listing page data. Scoped to the random public_slug and
// only for published listings — nothing else in the workspace is visible.
// Rate limits responses implicitly: view_count increments are best-effort
// and never block the read.

export async function GET(request, { params }) {
  try {
    const slug = (await params).slug;
    if (!/^[a-zA-Z0-9]{12}$/.test(slug)) {
      return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
    }
    const supabase = createPublicListingClient();
    const { data: listing, error } = await supabase
      .from("rental_listings")
      .select("id, title, description, rent_cents, beds_display, baths_display, square_feet, pet_policy, available_at, photos, contact_email, contact_phone, listing_form_id, public_slug, owner_id, view_count")
      .eq("public_slug", slug).eq("status", "published").maybeSingle();
    if (error) throw error;
    if (!listing) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });

    let form = null;
    if (listing.listing_form_id) {
      const { data: formRow } = await supabase
        .from("rental_listing_forms")
        .select("id, name, sections, custom_questions, fee_amount_cents, consent_text")
        .eq("owner_id", listing.owner_id).eq("id", listing.listing_form_id).maybeSingle();
      form = formRow || null;
    }

    // Best-effort view count; never fails the public read.
    try {
      await supabase.from("rental_listings")
        .update({ view_count: (listing.view_count || 0) + 1 })
        .eq("owner_id", listing.owner_id).eq("id", listing.id);
    } catch { /* best effort only */ }

    return NextResponse.json({
      success: true,
      listing: {
        title: listing.title,
        description: listing.description,
        rentCents: listing.rent_cents,
        bedsDisplay: listing.beds_display,
        bathsDisplay: listing.baths_display,
        squareFeet: listing.square_feet,
        petPolicy: listing.pet_policy,
        availableAt: listing.available_at,
        photos: (listing.photos || []).map((photo, index) => ({ index, url: `/api/public/rental-listings/${slug}/photo?path=${encodeURIComponent(photo.path || "")}` })),
        contactEmail: listing.contact_email,
        contactPhone: listing.contact_phone,
        slug: listing.public_slug,
      },
      form: form ? {
        id: form.id,
        name: form.name,
        sections: form.sections,
        customQuestions: form.custom_questions || [],
        feeAmountCents: form.fee_amount_cents,
        consentText: form.consent_text,
      } : null,
    });
  } catch (error) {
    console.error("Public listing error", error);
    return NextResponse.json({ error: "Unable to load the listing." }, { status: 500 });
  }
}
