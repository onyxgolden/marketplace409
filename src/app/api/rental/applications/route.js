import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

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

// POST — Controls-sweep follow-up G21 (O-11): landlord paper entry. The
// public form posts through the no-login apply route; this is the
// owner-authenticated equivalent for an applicant who applied on paper.
// No form validation (the landlord enters it, the public rate limit and
// honeypot do not apply), but the listing must be the owner's and the
// answers must name the applicant, so the queue row renders. Fee is
// recorded as none: a paper fee, if any, is collected offline.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if ((await getActiveWorkspaceRole({
      supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id,
    })) === "read_only") {
      return NextResponse.json({ error: "Read-only members cannot create applications." }, { status: 403 });
    }
    const body = await request.json();
    const listingId = typeof body?.listingId === "string" ? body.listingId.trim() : "";
    if (!listingId) return NextResponse.json({ error: "A listing is required." }, { status: 400 });
    const answers = body?.answers || {};
    const personal = answers.personal || {};
    const named = [personal.firstName, personal.lastName].filter(Boolean).join(" ").trim() || personal.email;
    if (!named) {
      return NextResponse.json({ error: "The applicant's name or email is required." }, { status: 400 });
    }
    const { data: listing, error: listingError } = await authenticated.supabaseClient
      .from("rental_listings").select("id")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", listingId).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
    const timestamp = new Date().toISOString();
    const { data, error } = await authenticated.supabaseClient.from("rental_applications").insert({
      owner_id: authenticated.effectiveOwnerId, listing_id: listing.id, form_id: null,
      status: "pending", answers, fee_amount_cents: 0, fee_recorded: false,
      submitted_at: timestamp, created_at: timestamp, updated_at: timestamp,
    }).select(APPLICATION_COLUMNS).single();
    if (error) throw error;
    return NextResponse.json({ success: true, application: rowToApplication(data) }, { status: 201 });
  } catch (error) {
    console.error("Application create error", error);
    return NextResponse.json({ error: "Unable to create the application." }, { status: 500 });
  }
}
