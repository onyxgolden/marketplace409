// POST /api/dscr-lenders/admin/review — admin moderation transitions.
//
// DSCR-IMPL-001: implements the authorized moderation lifecycle —
// approve_submission / reject_submission / approve_version / reject_version /
// publish / unpublish / reconfirm / remove. The transition and its audit event
// are applied atomically in dscr_review_transition(); invalid transitions are
// rejected by both the route-level canTransition() check and the RPC.
//
// Admin-only: AdminAuthorizationApplication (jasonmorgan99@gmail.com).

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AdminAuthorizationApplication } from "@/application/business/AdminAuthorizationApplication";
import { MODERATION_ACTIONS, canTransition } from "@/lib/dscr/listings";

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

  const adminApp = new AdminAuthorizationApplication({ supabase: supabaseServer });
  const adminAuth = await adminApp.loadAdminAuthorization();
  if (!adminAuth.authorized) {
    return NextResponse.json({ error: "Directory admin access required." }, { status: 403 });
  }
  const actorId = adminAuth.user.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  const lenderId = String(body.lender_id ?? "").trim();
  const versionId = body.version_id ? String(body.version_id).trim() : null;
  const note = body.note ? String(body.note).slice(0, 1000) : null;

  if (!MODERATION_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: `Unknown action. Allowed: ${MODERATION_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!UUID_RE.test(lenderId)) {
    return NextResponse.json({ error: "Valid listing id is required." }, { status: 400 });
  }
  if (
    (action === "approve_version" || action === "reject_version") &&
    (!versionId || !UUID_RE.test(versionId))
  ) {
    return NextResponse.json(
      { error: "A valid version id is required for version review." },
      { status: 400 }
    );
  }

  const svc = serviceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Directory service unavailable. Try again later." },
      { status: 503 }
    );
  }

  // Route-level transition guard (the RPC enforces it again atomically).
  const { data: lender } = await svc
    .from("dscr_lenders")
    .select("id, status")
    .eq("id", lenderId)
    .single();
  if (!lender) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }
  if (!canTransition(lender.status, action)) {
    return NextResponse.json(
      { error: `Action "${action}" is not allowed from status "${lender.status}".` },
      { status: 409 }
    );
  }

  const { data, error } = await svc.rpc("dscr_review_transition", {
    p_actor_id: actorId,
    p_lender_id: lenderId,
    p_action: action,
    p_note: note,
    p_version_id: versionId,
  });

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("TRANSITION_INVALID")) {
      return NextResponse.json({ error: "Transition not allowed for the current state." }, { status: 409 });
    }
    if (msg.includes("TRANSITION_NOT_FOUND")) {
      return NextResponse.json({ error: "Listing or version not found." }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Could not apply transition. Try again later." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, action: data?.action, lender_id: data?.lender_id },
    { status: 200 }
  );
}
