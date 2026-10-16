// POST /api/dscr-lenders/report — user abuse/problem report on a listing.
//
// DSCR-IMPL-005 (fail closed):
// - Authentication REQUIRED. Anonymous reports are rejected (no IP tracking,
//   no spam vector through the service-role client).
// - Reason validated: 10–2000 chars.
// - Rate limits enforced atomically in dscr_report_abuse(): 1 report per
//   user per lender per 24h, 10 per user per 24h globally.
// - The report row, the lender's abuse_report_count bump, and the audit
//   event are one transaction — success is never returned without the audit.
// - The UI must honor non-OK statuses (see LenderCards.submitReport).

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { validateReport } from "@/lib/dscr/listings";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient: createSb } = require("@supabase/supabase-js");
  return createSb(url, key, { auth: { persistSession: false } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  const supabaseServer = await createClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in required to report a problem with a listing." },
      { status: 401 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const lenderId = String(body.lender_id ?? "").trim();
  if (!UUID_RE.test(lenderId)) {
    return NextResponse.json({ error: "Valid listing id is required." }, { status: 400 });
  }

  const check = validateReport(body.reason);
  if (!check.valid) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const reason = String(body.reason).trim();

  const svc = serviceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Service unavailable. Try again later." },
      { status: 503 }
    );
  }

  const { error } = await svc.rpc("dscr_report_abuse", {
    p_user_id: user.id,
    p_lender_id: lenderId,
    p_reason: reason,
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("REPORT_NOT_FOUND")) {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }
    if (msg.includes("REPORT_THROTTLED")) {
      return NextResponse.json(
        { error: "Report limit reached. You can report this listing again in 24 hours." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Could not record report. Try again later." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
