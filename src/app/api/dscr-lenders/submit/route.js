// POST /api/dscr-lenders/submit — provider listing submission.
// Queues for admin review; NEVER goes live automatically.
//
// Atomicity (DSCR-IMPL-002/003): the whole submit — 24h throttle check,
// duplicate-NMLS handling, listing insert, audit insert — runs inside the
// dscr_submit_lender() SECURITY DEFINER transaction. Concurrent requests
// cannot both pass the throttle or create duplicate NMLS rows:
//   - per-user submissions are serialized with pg_advisory_xact_lock,
//   - nmls_number has a UNIQUE database constraint,
//   - a duplicate NMLS is preserved as a reviewable staged version row,
//     never a second listing and never silently discarded.
//
// Security boundaries:
// - Requires an authenticated session (getUser). Anonymous submissions rejected.
// - NMLS format validated server-side (syntactic only — never a verification claim).
// - Writes go through the service-role client; RLS blocks direct public writes.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { validateNmlsFormat, nmlsConsumerAccessUrl } from "@/lib/dscr/listings";

export const runtime = "nodejs";

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
const ALLOWED_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function sanitizeArray(values, allowed) {
  if (!Array.isArray(values)) return [];
  return values.filter((v) => allowed.includes(v)).slice(0, 60);
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildTermPayload(body) {
  return {
    states_served: sanitizeArray(body.states_served, ALLOWED_STATES),
    min_loan_amount: toNumberOrNull(body.min_loan_amount),
    max_loan_amount: toNumberOrNull(body.max_loan_amount),
    property_types: sanitizeArray(body.property_types, ALLOWED_PROPERTY_TYPES),
    transaction_types: sanitizeArray(body.transaction_types, ALLOWED_TRANSACTION_TYPES),
    occupancy_entity_restrictions:
      String(body.occupancy_entity_restrictions ?? "").slice(0, 500) || null,
    max_ltv: toNumberOrNull(body.max_ltv),
    min_credit_score_claim: toNumberOrNull(body.min_credit_score_claim),
    prepayment_penalty_availability:
      String(body.prepayment_penalty_availability ?? "").slice(0, 500) || null,
    min_dscr_accepted: toNumberOrNull(body.min_dscr_accepted),
    contact_name: String(body.contact_name ?? "").slice(0, 200) || null,
    contact_phone: String(body.contact_phone ?? "").slice(0, 50) || null,
    contact_email: String(body.contact_email ?? "").slice(0, 200) || null,
    application_url: String(body.application_url ?? "").slice(0, 500) || null,
    terms_as_of_date: new Date().toISOString().slice(0, 10),
  };
}

export function buildSubmitPayload(body, nmls) {
  const companyName = String(body.company_name ?? "").trim();
  return {
    company_name: companyName,
    nmls_number: nmls.normalized,
    nmls_consumer_access_url: nmlsConsumerAccessUrl(nmls.normalized),
    ...buildTermPayload(body),
  };
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

  const payload = buildSubmitPayload(body, nmls);

  const { data, error } = await svc.rpc("dscr_submit_lender", {
    p_user_id: user.id,
    p_payload: payload,
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("SUBMIT_THROTTLED")) {
      return NextResponse.json(
        { error: "Submission limit reached (3 per 24 hours)." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Could not save submission. Try again later." },
      { status: 500 }
    );
  }

  if (data?.duplicate) {
    return NextResponse.json(
      {
        ok: true,
        duplicate: true,
        message:
          "A listing with this NMLS number already exists. Your submission was preserved as a staged claim for directory review — no second listing was created.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, id: data?.id }, { status: 201 });
}
