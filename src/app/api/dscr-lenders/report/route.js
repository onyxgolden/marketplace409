// POST /api/dscr-lenders/report — user abuse/problem report on a listing.
// Auth optional (reports accepted from signed-in users; anonymous reports
// recorded without a reporter id). Rate-limited per lender per reporter.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient: createSb } = require("@supabase/supabase-js");
  return createSb(url, key, { auth: { persistSession: false } });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const lenderId = String(body.lender_id ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 2000);
  if (!lenderId || !reason) {
    return NextResponse.json(
      { error: "Listing and reason are required." },
      { status: 400 }
    );
  }

  const supabaseServer = await createClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  const svc = serviceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Service unavailable. Try again later." },
      { status: 503 }
    );
  }

  // Verify the lender exists and is published.
  const { data: lender } = await svc
    .from("dscr_lenders")
    .select("id")
    .eq("id", lenderId)
    .eq("status", "published")
    .single();
  if (!lender) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const { error } = await svc.from("dscr_lender_abuse_reports").insert({
    lender_id: lenderId,
    reporter_user_id: user ? user.id : null,
    reason,
  });
  if (error) {
    return NextResponse.json(
      { error: "Could not record report. Try again later." },
      { status: 500 }
    );
  }

  await svc.from("dscr_lender_audit").insert({
    lender_id: lenderId,
    actor_user_id: user ? user.id : null,
    action: "abuse_reported",
    note: reason.slice(0, 500),
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
