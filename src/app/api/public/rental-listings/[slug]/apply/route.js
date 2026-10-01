import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createPublicListingClient } from "@/lib/supabase/createPublicListingClient";
import {
  APPLICATION_RATE_LIMIT,
  isHoneypotTripped,
  validateApplicationPayload,
} from "@/domains/rental-listings/applicationForms";

export const runtime = "nodejs";

// Public (no login) application intake. Guards, in order:
//   1. slug-shaped URL + listing published (anything else → 404, same as the
//      listing page so unpublished listings are indistinguishable)
//   2. honeypot (bots fill "company") → silent 200, nothing stored
//   3. rate limit: APPLICATION_RATE_LIMIT per IP per listing, enforced by the
//      atomic record_application_submission_attempt RPC (advisory-lock
//      serialized, survives serverless restarts) → 429
//   4. payload validated against the listing's form → 400 with field errors
// Accepted applications land in rental_applications as pending — the owner's
// review queue is the in-app "new application" notification. No email is
// sent to the applicant (no outbound email without Jason's word); the fee is
// recorded, never collected (live collection is a follow-up slice).

function ipHash(request) {
  // Rate-limit trust rule (R21 CHANGES fix): trust the edge-established
  // address only. x-real-ip is set by the platform edge and cannot be forged
  // by the client; the first x-forwarded-for element IS client-supplied, so
  // preferring it would let a client mint a fresh rate-limit bucket on every
  // request by rotating a forged prefix.
  const ip = request.headers.get("x-real-ip")?.trim() || "unknown";
  return crypto.createHash("sha256").update(`r21-application:${ip}`).digest("hex");
}

export async function POST(request, { params }) {
  try {
    const slug = (await params).slug;
    if (!/^[a-zA-Z0-9]{12}$/.test(slug)) {
      return NextResponse.json({ error: "Listing was not found." }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    if (isHoneypotTripped(body)) {
      // Swallow spam silently: identical 200 to a real submit.
      return NextResponse.json({ success: true });
    }

    const supabase = createPublicListingClient();
    const { data: listing, error: listingError } = await supabase
      .from("rental_listings")
      .select("id, owner_id, title, listing_form_id")
      .eq("public_slug", slug).eq("status", "published").maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return NextResponse.json({ error: "Listing was not found." }, { status: 404 });

    let form = { sections: { personal_info: true, residence_history: true, employment: true, references: true }, customQuestions: [] };
    if (listing.listing_form_id) {
      const { data: formRow, error: formError } = await supabase
        .from("rental_listing_forms")
        .select("sections, custom_questions, fee_amount_cents")
        .eq("owner_id", listing.owner_id).eq("id", listing.listing_form_id).maybeSingle();
      if (formError) throw formError;
      if (formRow) {
        form = {
          sections: formRow.sections || form.sections,
          customQuestions: formRow.custom_questions || [],
          feeAmountCents: formRow.fee_amount_cents || 0,
        };
      }
    }

    const errors = validateApplicationPayload(form, body?.answers);
    if (errors.length) return NextResponse.json({ error: errors.join(" "), fieldErrors: errors }, { status: 400 });

    const hash = ipHash(request);
    // Atomic check-and-record: the RPC serializes attempts per
    // (owner, listing, ip) with an advisory lock, counts the in-window
    // attempts, and inserts the attempt row in the same transaction — a
    // double-submit race cannot slip two applications past the limit.
    const { data: allowed, error: attemptError } = await supabase.rpc(
      "record_application_submission_attempt",
      {
        p_owner_id: listing.owner_id,
        p_listing_id: listing.id,
        p_ip_hash: hash,
        p_window_seconds: Math.floor(APPLICATION_RATE_LIMIT.windowMs / 1000),
        p_max_submissions: APPLICATION_RATE_LIMIT.maxSubmissions,
      },
    );
    if (attemptError) throw attemptError;
    if (!allowed) {
      return NextResponse.json({ error: "Too many applications from this address. Please try again later." }, { status: 429 });
    }

    const timestamp = new Date().toISOString();
    const { data: application, error: insertError } = await supabase.from("rental_applications").insert({
      owner_id: listing.owner_id,
      listing_id: listing.id,
      form_id: listing.listing_form_id,
      status: "pending",
      answers: body.answers,
      fee_amount_cents: form.feeAmountCents || 0,
      fee_recorded: (form.feeAmountCents || 0) > 0,
      submitted_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    }).select("id, submitted_at").single();
    if (insertError) throw insertError;

    return NextResponse.json({ success: true, applicationId: application.id, submittedAt: application.submitted_at });
  } catch (error) {
    console.error("Public application submit error", error);
    return NextResponse.json({ error: "Unable to submit the application." }, { status: 500 });
  }
}
