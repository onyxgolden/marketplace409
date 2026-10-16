// POST /api/dscr-lenders/edit — provider stages an edit (or a removal request).
//
// DSCR-IMPL-001: a provider edit NEVER silently replaces the live version.
// The edit is stored as a pending row in dscr_lender_versions; the last
// reviewed public version stays live until an admin approves the version.
// The version insert + its audit event are atomic in dscr_stage_version().
//
// Authorization: the caller must own the listing (owner_user_id) or be an admin.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AdminAuthorizationApplication } from "@/application/business/AdminAuthorizationApplication";
import { buildTermPayload } from "@/app/api/dscr-lenders/submit/route";

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
      { error: "Sign in required to propose an edit." },
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
  const removalRequested = body.removal_requested === true;

  const svc = serviceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Directory service unavailable. Try again later." },
      { status: 503 }
    );
  }

  const { data: lender } = await svc
    .from("dscr_lenders")
    .select("id, owner_user_id, status")
    .eq("id", lenderId)
    .single();
  if (!lender) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const adminApp = new AdminAuthorizationApplication({ supabase: supabaseServer });
  const adminAuth = await adminApp.loadAdminAuthorization();
  const isOwner = lender.owner_user_id === user.id;
  if (!isOwner && !adminAuth.authorized) {
    return NextResponse.json(
      { error: "Only the listing owner or a directory admin can propose edits." },
      { status: 403 }
    );
  }

  // Build the staged payload from the same sanitizers as submission.
  // Identity fields (company name, NMLS) are NOT editable here — they require
  // a fresh identity review through the submission flow.
  const staged = buildTermPayload(body);

  const { data, error } = await svc.rpc("dscr_stage_version", {
    p_user_id: user.id,
    p_lender_id: lenderId,
    p_payload: staged,
    p_removal_requested: removalRequested,
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("VERSION_LENDER_NOT_FOUND")) {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Could not stage edit. Try again later." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      staged: true,
      version_id: data?.version_id,
      message: removalRequested
        ? "Removal request staged for directory review. The listing stays live until an admin approves."
        : "Edit staged for directory review. The current live version stays public until an admin approves your changes.",
    },
    { status: 201 }
  );
}
