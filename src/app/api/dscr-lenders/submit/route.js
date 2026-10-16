// POST /api/dscr-lenders/submit — provider listing submission.
// Queues for admin review; NEVER goes live automatically.
//
// Security boundaries:
// - Requires an authenticated session (getUser). Anonymous submissions rejected.
// - NMLS format validated server-side (syntactic only — never a verification claim).
// - Duplicate NMLS check: an existing listing with the same NMLS flags for
//   admin review instead of creating a second row.
// - Rate limiting: max 3 submissions per user per 24h.
// - Writes go through the service-role client; RLS blocks direct public writes.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { validateNmlsFormat, nmlsConsumerAccessUrl } from "@/lib/dscr/listings";

export const runtime = "nodejs";

const SUBMIT_LIMIT_PER_DAY = 3;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Lazy import to keep the edge-safe path clean.
  const { createClient: createSb } = require("@supabase/supabase-js");
  return createSb(url, key, { auth: { persistSession: false } });
}

const ALLOWED_PROPERTY_TYPES = ["SFR", "2-4 unit", "5+ unit"];
const ALLOWED_TRANSACTION_TYPES = [
  "purchase",
  "rate-term refinance",
  "cash-out refinance",
];

function sanitizeArray(values, allowed) {
  if (!Array.isArray(values)) return [];
  return values.filter((v) => allowed.includes(v)).slice(0, 60);
}

export async function POST(request) {
  const supabaseServer = await createClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required to submit a listing." },
      { status: 401 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const companyName = String(body.company_name ?? "").trim();
  if (!companyName || companyName.length > 200) {
    return NextResponse.json(
      { error: "Company name is required (max 200 characters)." },
      { status: 400 }
    );
  }

  const nmls = validateNmlsFormat(body.nmls_number);
  if (!nmls.valid) {
    return NextResponse.json({ error: nmls.error }, { status: 400 });
  }

  const svc = serviceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Directory service unavailable. Try again later." },
      { status: 503 }
    );
  }

  // Rate limit: 3 submissions per user per 24h.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await svc
    .from("dscr_lenders")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", user.id)
    .gte("created_at", dayAgo);
  if ((recentCount ?? 0) >= SUBMIT_LIMIT_PER_DAY) {
    return NextResponse.json(
      { error: "Submission limit reached (3 per 24 hours)." },
      { status: 429 }
    );
  }

  // Duplicate NMLS: flag for admin review instead of a second listing.
  const { data: existing } = await svc
    .from("dscr_lenders")
    .select("id, company_name, status")
    .eq("nmls_number", nmls.normalized)
    .limit(1);
  if (existing && existing.length > 0) {
    await svc.from("dscr_lender_audit").insert({
      lender_id: existing[0].id,
      actor_user_id: user.id,
      action: "submitted",
      note: `Duplicate NMLS submission attempt for ${companyName} — flagged for admin review instead of creating a second listing.`,
    });
    return NextResponse.json(
      {
        ok: true,
        duplicate: true,
        message:
          "A listing with this NMLS number already exists. Your submission was flagged for directory review.",
      },
      { status: 200 }
    );
  }

  const row = {
    company_name: companyName,
    nmls_number: nmls.normalized,
    nmls_consumer_access_url: nmlsConsumerAccessUrl(nmls.normalized),
    identity_review_status: "pending",
    status: "pending_review",
    states_served: sanitizeArray(body.states_served, [
      "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
      "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
      "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
      "VA","WA","WV","WI","WY","DC",
    ]),
    min_loan_amount: body.min_loan_amount ?? null,
    max_loan_amount: body.max_loan_amount ?? null,
    property_types: sanitizeArray(body.property_types, ALLOWED_PROPERTY_TYPES),
    transaction_types: sanitizeArray(body.transaction_types, ALLOWED_TRANSACTION_TYPES),
    occupancy_entity_restrictions: String(body.occupancy_entity_restrictions ?? "").slice(0, 500) || null,
    max_ltv: body.max_ltv ?? null,
    min_credit_score_claim: body.min_credit_score_claim ?? null,
    prepayment_penalty_availability:
      String(body.prepayment_penalty_availability ?? "").slice(0, 500) || null,
    min_dscr_accepted: body.min_dscr_accepted ?? null,
    contact_name: String(body.contact_name ?? "").slice(0, 200) || null,
    contact_phone: String(body.contact_phone ?? "").slice(0, 50) || null,
    contact_email: String(body.contact_email ?? "").slice(0, 200) || null,
    application_url: String(body.application_url ?? "").slice(0, 500) || null,
    owner_user_id: user.id,
    terms_as_of_date: new Date().toISOString().slice(0, 10),
  };

  const { data: inserted, error } = await svc
    .from("dscr_lenders")
    .insert(row)
    .select("id")
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      { error: "Could not save submission. Try again later." },
      { status: 500 }
    );
  }

  await svc.from("dscr_lender_audit").insert({
    lender_id: inserted.id,
    actor_user_id: user.id,
    action: "submitted",
    note: "Provider submission queued for directory review.",
  });

  return NextResponse.json({ ok: true, id: inserted.id }, { status: 201 });
}
