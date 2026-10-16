// GET /api/dscr-lenders/admin/queue — admin moderation queue.
// Admin-only. Returns pending submissions, pending staged versions,
// all listings (for publish/unpublish/reconfirm/remove), and recent audit.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AdminAuthorizationApplication } from "@/application/business/AdminAuthorizationApplication";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient: createSb } = require("@supabase/supabase-js");
  return createSb(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const supabaseServer = await createClient();

  const adminApp = new AdminAuthorizationApplication({ supabase: supabaseServer });
  const adminAuth = await adminApp.loadAdminAuthorization();
  if (!adminAuth.authorized) {
    return NextResponse.json({ error: "Directory admin access required." }, { status: 403 });
  }

  const svc = serviceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "Directory service unavailable. Try again later." },
      { status: 503 }
    );
  }

  const [pendingSubmissions, pendingVersions, listings, audit] = await Promise.all([
    svc
      .from("dscr_lenders")
      .select("id, company_name, nmls_number, status, identity_review_status, created_at, owner_user_id")
      .eq("status", "pending_review")
      .order("created_at", { ascending: true }),
    svc
      .from("dscr_lender_versions")
      .select("id, lender_id, version_number, request_type, payload, submitted_by, created_at, dscr_lenders(company_name)")
      .eq("review_status", "pending")
      .order("created_at", { ascending: true }),
    svc
      .from("dscr_lenders")
      .select("id, company_name, nmls_number, status, identity_review_status, last_directory_reviewed_at, abuse_report_count")
      .order("company_name", { ascending: true }),
    svc
      .from("dscr_lender_audit")
      .select("id, lender_id, action, note, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json(
    {
      pending_submissions: pendingSubmissions.data ?? [],
      pending_versions: pendingVersions.data ?? [],
      listings: listings.data ?? [],
      recent_audit: audit.data ?? [],
    },
    { status: 200 }
  );
}
