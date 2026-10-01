import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { generatePublicSlug } from "@/domains/rental-listings/applicationForms";

export const runtime = "nodejs";

// Rentec parity R21 — public listings (free layer). GET is readable by every
// workspace member; POST/PUT/DELETE are owner/co-owner only (read-only 403).
// Listings point at vacant units (rental_units status 'available') and carry
// the public slug used by /rentals/<slug>.

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export function rowToListing(row) {
  return {
    id: row.id,
    unitId: row.unit_id,
    propertyId: row.property_id,
    publicSlug: row.public_slug,
    status: row.status,
    title: row.title,
    description: row.description,
    rentCents: row.rent_cents,
    bedsDisplay: row.beds_display,
    bathsDisplay: row.baths_display,
    squareFeet: row.square_feet,
    petPolicy: row.pet_policy,
    availableAt: row.available_at,
    photos: row.photos || [],
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    listingFormId: row.listing_form_id,
    viewCount: row.view_count,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function validateListingInput(input) {
  const errors = [];
  if (!input || typeof input !== "object") return ["Listing input is required."];
  if (!input.unitId || typeof input.unitId !== "string" || !input.unitId.trim()) errors.push("A unit is required.");
  if (!input.title || typeof input.title !== "string" || !input.title.trim()) errors.push("The listing needs a title.");
  if (input.rentCents !== undefined && input.rentCents !== null
    && (!Number.isSafeInteger(input.rentCents) || input.rentCents <= 0)) {
    errors.push("Rent must be a positive whole number of cents.");
  }
  if (input.contactEmail && !/^\S+@\S+\.\S+$/.test(input.contactEmail.trim())) errors.push("The contact email is invalid.");
  if (input.status && !["draft", "published", "unpublished"].includes(input.status)) errors.push("Invalid listing status.");
  return errors;
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { searchParams } = new URL(request.url);
    let query = authenticated.supabaseClient
      .from("rental_listings")
      .select("id, unit_id, property_id, public_slug, status, title, description, rent_cents, beds_display, baths_display, square_feet, pet_policy, available_at, photos, contact_email, contact_phone, listing_form_id, view_count, published_at, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId);
    const status = searchParams.get("status");
    if (status) query = query.eq("status", status);
    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ success: true, listings: (data || []).map(rowToListing) });
  } catch (error) {
    console.error("Listings load error", error);
    return NextResponse.json({ error: "Unable to load listings." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot create listings." }, { status: 403 });
    }
    const body = await request.json();
    const errors = validateListingInput(body?.listing);
    if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    const input = body.listing;
    // The listing must point at the workspace's own unit — a unit from
    // another workspace resolves to 404, never a 403 that leaks existence.
    const { data: unit, error: unitError } = await authenticated.supabaseClient
      .from("rental_units")
      .select("id, property_id, label, status, photo_bucket, photo_object_path, bedrooms, bathrooms, square_feet, available_at")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", input.unitId.trim()).maybeSingle();
    if (unitError) throw unitError;
    if (!unit) return NextResponse.json({ error: "Unit was not found." }, { status: 404 });

    let photos = Array.isArray(input.photos) ? input.photos : [];
    const publishing = input.status === "published";
    if (publishing && photos.length === 0 && unit.photo_object_path) {
      // Snapshot the unit photo so the public page never depends on the
      // unit row's current photo.
      photos = [{ bucket: unit.photo_bucket, path: unit.photo_object_path }];
    }
    const timestamp = new Date().toISOString();
    const { data, error } = await authenticated.supabaseClient.from("rental_listings").insert({
      owner_id: authenticated.effectiveOwnerId,
      unit_id: unit.id,
      property_id: unit.property_id,
      public_slug: generatePublicSlug(),
      status: input.status || "draft",
      title: input.title.trim(),
      description: typeof input.description === "string" ? input.description.trim() || null : null,
      rent_cents: input.rentCents ?? null,
      beds_display: typeof input.bedsDisplay === "string" ? input.bedsDisplay.trim() || null : null,
      baths_display: typeof input.bathsDisplay === "string" ? input.bathsDisplay.trim() || null : null,
      square_feet: input.squareFeet ?? unit.square_feet ?? null,
      pet_policy: typeof input.petPolicy === "string" ? input.petPolicy.trim() || null : null,
      available_at: input.availableAt || unit.available_at || null,
      photos,
      contact_email: typeof input.contactEmail === "string" ? input.contactEmail.trim().toLowerCase() || null : null,
      contact_phone: typeof input.contactPhone === "string" ? input.contactPhone.trim() || null : null,
      listing_form_id: input.listingFormId || null,
      published_at: publishing ? timestamp : null,
      created_by: authenticated.user.id,
      created_at: timestamp,
      updated_at: timestamp,
    }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ success: true, listing: rowToListing(data) });
  } catch (error) {
    console.error("Listing create error", error);
    return NextResponse.json({ error: "Unable to create the listing." }, { status: 500 });
  }
}
