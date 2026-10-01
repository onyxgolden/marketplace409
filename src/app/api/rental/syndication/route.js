import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import {
  buildCopyPastePack,
  buildListingFeedXml,
  listSyndicationStatus,
  submitListingToSite,
} from "@/domains/rental-listings/syndication";

export const runtime = "nodejs";

// Rentec parity R21 — syndication (design layer, HARD GATE).
// Free, usable today:
//   GET ?format=feed        → RSS 2.0 of published listings (XML)
//   GET ?listingId=<id>     → copy-paste pack (ad copy + schema.org JSON-LD)
//   GET (no params)         → per-site status catalog
// Gated: POST attempts an auto-post — the stub ALWAYS answers 501 with
// { status: "not_connected" } and performs no network I/O. Auto-posting any
// site needs Jason's word (site + cost) under the build-spend doctrine.

function baseUrl(request) {
  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { searchParams } = new URL(request.url);
    const ownerId = authenticated.effectiveOwnerId;

    if (searchParams.get("format") === "feed") {
      const { data, error } = await authenticated.supabaseClient
        .from("rental_listings")
        .select("public_slug, title, description, rent_cents, beds_display, baths_display, square_feet, pet_policy, available_at, published_at")
        .eq("owner_id", ownerId).eq("status", "published").order("published_at", { ascending: false });
      if (error) throw error;
      const base = baseUrl(request);
      const listings = (data || []).map((row) => ({
        publicSlug: row.public_slug,
        title: row.title,
        description: row.description,
        rentCents: row.rent_cents,
        bedsDisplay: row.beds_display,
        bathsDisplay: row.baths_display,
        squareFeet: row.square_feet,
        petPolicy: row.pet_policy,
        availableAt: row.available_at,
        publishedAt: row.published_at,
        applyUrl: base ? `${base}/rentals/${row.public_slug}/apply` : null,
      }));
      return new NextResponse(buildListingFeedXml({ listings, baseUrl: base }), {
        status: 200,
        headers: { "content-type": "application/rss+xml; charset=utf-8" },
      });
    }

    const listingId = searchParams.get("listingId");
    if (listingId) {
      const { data, error } = await authenticated.supabaseClient
        .from("rental_listings")
        .select("title, description, rent_cents, beds_display, baths_display, square_feet, pet_policy, available_at, public_slug, contact_email, contact_phone")
        .eq("owner_id", ownerId).eq("id", listingId).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
      const base = baseUrl(request);
      return NextResponse.json({
        success: true,
        pack: buildCopyPastePack({
          title: data.title,
          description: data.description,
          rentCents: data.rent_cents,
          bedsDisplay: data.beds_display,
          bathsDisplay: data.baths_display,
          squareFeet: data.square_feet,
          petPolicy: data.pet_policy,
          availableAt: data.available_at,
          applyUrl: base ? `${base}/rentals/${data.public_slug}/apply` : null,
          contactEmail: data.contact_email,
          contactPhone: data.contact_phone,
        }),
      });
    }

    return NextResponse.json({ success: true, sites: listSyndicationStatus() });
  } catch (error) {
    console.error("Syndication error", error);
    return NextResponse.json({ error: "Unable to load syndication info." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    // HARD GATE: the stub never posts. This endpoint exists so the UI and
    // future adapters share one call surface; every response is 501.
    const result = submitListingToSite({ siteKey: body?.siteKey });
    return NextResponse.json(
      { success: false, ...result, gate: "Auto-posting is disabled. See src/domains/rental-listings/SYNDICATION_GATE.md." },
      { status: 501 },
    );
  } catch (error) {
    console.error("Syndication post error", error);
    return NextResponse.json({ error: "Unable to reach the syndication stub." }, { status: 500 });
  }
}
