import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { rowToListing } from "../route";

export const runtime = "nodejs";

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

async function loadListing(authenticated, id) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_listings").select("*")
    .eq("owner_id", authenticated.effectiveOwnerId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const listing = await loadListing(authenticated, (await params).id);
    if (!listing) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
    return NextResponse.json({ success: true, listing: rowToListing(listing) });
  } catch (error) {
    console.error("Listing detail error", error);
    return NextResponse.json({ error: "Unable to load the listing." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot edit listings." }, { status: 403 });
    }
    const listing = await loadListing(authenticated, (await params).id);
    if (!listing) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
    const body = await request.json();
    const input = body?.listing || {};
    const patch = {};
    const asText = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
    if (input.title !== undefined) {
      if (!asText(input.title)) return NextResponse.json({ error: "The listing needs a title." }, { status: 400 });
      patch.title = input.title.trim();
    }
    if (input.description !== undefined) patch.description = asText(input.description);
    if (input.rentCents !== undefined) {
      if (input.rentCents !== null && (!Number.isSafeInteger(input.rentCents) || input.rentCents <= 0)) {
        return NextResponse.json({ error: "Rent must be a positive whole number of cents." }, { status: 400 });
      }
      patch.rent_cents = input.rentCents;
    }
    if (input.status !== undefined) {
      if (!["draft", "published", "unpublished"].includes(input.status)) {
        return NextResponse.json({ error: "Invalid listing status." }, { status: 400 });
      }
      patch.status = input.status;
      // First publish stamps published_at; republishing after unpublish
      // refreshes it.
      if (input.status === "published" && listing.status !== "published") {
        patch.published_at = new Date().toISOString();
        const currentPhotos = listing.photos || [];
        if (currentPhotos.length === 0) {
          const { data: unit, error: unitError } = await authenticated.supabaseClient
            .from("rental_units").select("photo_bucket, photo_object_path")
            .eq("owner_id", authenticated.effectiveOwnerId).eq("id", listing.unit_id).maybeSingle();
          if (unitError) throw unitError;
          if (unit?.photo_object_path) patch.photos = [{ bucket: unit.photo_bucket, path: unit.photo_object_path }];
        }
      }
      if (input.status !== "published") patch.published_at = null;
    }
    if (input.bedsDisplay !== undefined) patch.beds_display = asText(input.bedsDisplay);
    if (input.bathsDisplay !== undefined) patch.baths_display = asText(input.bathsDisplay);
    if (input.squareFeet !== undefined) patch.square_feet = input.squareFeet;
    if (input.petPolicy !== undefined) patch.pet_policy = asText(input.petPolicy);
    if (input.availableAt !== undefined) patch.available_at = input.availableAt || null;
    if (input.photos !== undefined) patch.photos = Array.isArray(input.photos) ? input.photos : [];
    if (input.contactEmail !== undefined) {
      const email = asText(input.contactEmail)?.toLowerCase() || null;
      if (email && !/^\S+@\S+\.\S+$/.test(email)) {
        return NextResponse.json({ error: "The contact email is invalid." }, { status: 400 });
      }
      patch.contact_email = email;
    }
    if (input.contactPhone !== undefined) patch.contact_phone = asText(input.contactPhone);
    if (input.listingFormId !== undefined) {
      const formId = asText(input.listingFormId);
      if (formId) {
        const { data: form, error: formError } = await authenticated.supabaseClient
          .from("rental_listing_forms").select("id").eq("owner_id", authenticated.effectiveOwnerId).eq("id", formId).maybeSingle();
        if (formError) throw formError;
        if (!form) return NextResponse.json({ error: "Application form was not found." }, { status: 404 });
      }
      patch.listing_form_id = formId;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ success: true, listing: rowToListing(listing) });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await authenticated.supabaseClient
      .from("rental_listings").update(patch)
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", listing.id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ success: true, listing: rowToListing(data) });
  } catch (error) {
    console.error("Listing update error", error);
    return NextResponse.json({ error: "Unable to update the listing." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot delete listings." }, { status: 403 });
    }
    const listing = await loadListing(authenticated, (await params).id);
    if (!listing) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
    // Restrict delete on rental_applications protects listings with history.
    const { error } = await authenticated.supabaseClient
      .from("rental_listings").delete()
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", listing.id);
    if (error) {
      if (error.code === "23503") {
        return NextResponse.json({ error: "This listing has applications and cannot be deleted — unpublish it instead." }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Listing delete error", error);
    return NextResponse.json({ error: "Unable to delete the listing." }, { status: 500 });
  }
}
