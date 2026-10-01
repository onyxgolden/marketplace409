import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

export const runtime = "nodejs";

// Rentec parity R21 — the application review queue. Readable by every
// workspace member (the queue itself is the in-app "new application"
// notification); decisions go through POST .../[id]/decision.

export function rowToApplication(row, listingById = {}) {
  const listing = listingById[row.listing_id] || null;
  return {
    id: row.id,
    listingId: row.listing_id,
    formId: row.form_id,
    status: row.status,
    answers: row.answers || {},
    feeAmountCents: row.fee_amount_cents,
    feeRecorded: row.fee_recorded,
    denialReason: row.denial_reason,
    tenantId: row.tenant_id,
    leaseId: row.lease_id,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    submittedAt: row.submitted_at,
    listing: listing ? { id: listing.id, title: listing.title, publicSlug: listing.public_slug } : null,
  };
}

export const APPLICATION_COLUMNS = "id, listing_id, form_id, status, answers, fee_amount_cents, fee_recorded, denial_reason, tenant_id, lease_id, decided_by, decided_at, submitted_at";

export async function loadApplicationsWithListings({ supabaseClient, ownerId, status, listingId } = {}) {
  let query = supabaseClient.from("rental_applications").select(APPLICATION_COLUMNS).eq("owner_id", ownerId);
  if (status) query = query.eq("status", status);
  if (listingId) query = query.eq("listing_id", listingId);
  const { data, error } = await query.order("submitted_at", { ascending: false });
  if (error) throw error;
  const listingIds = [...new Set((data || []).map((row) => row.listing_id).filter(Boolean))];
  let listingById = {};
  if (listingIds.length) {
    const { data: listings, error: listingsError } = await supabaseClient
      .from("rental_listings").select("id, title, public_slug")
      .eq("owner_id", ownerId).in("id", listingIds);
    if (listingsError) throw listingsError;
    listingById = Object.fromEntries((listings || []).map((listing) => [listing.id, listing]));
  }
  return (data || []).map((row) => rowToApplication(row, listingById));
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    if (status && !["pending", "approved", "denied", "withdrawn"].includes(status)) {
      return NextResponse.json({ error: "Invalid application status." }, { status: 400 });
    }
    const applications = await loadApplicationsWithListings({
      supabaseClient: authenticated.supabaseClient,
      ownerId: authenticated.effectiveOwnerId,
      status,
      listingId: searchParams.get("listingId"),
    });
    return NextResponse.json({ success: true, applications });
  } catch (error) {
    console.error("Applications queue error", error);
    return NextResponse.json({ error: "Unable to load applications." }, { status: 500 });
  }
}
