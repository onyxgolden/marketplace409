import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { rowToNoticeLog } from "@/domains/rental-forms/noticeLibrary";

export const runtime = "nodejs";

// Rentec parity R15: the generated-notice log — a permanent record on the
// tenant of every notice the owner produced. GET is readable by every
// workspace member; logging (POST) is owner/co-owner only (403 read-only).

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { searchParams } = new URL(request.url);
    let query = authenticated.supabaseClient
      .from("rental_notice_log")
      .select("id, tenant_id, lease_id, form_id, form_name, rendered_body, created_at")
      .eq("owner_id", authenticated.effectiveOwnerId);
    const tenantId = searchParams.get("tenantId");
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return NextResponse.json({ success: true, notices: (data || []).map(rowToNoticeLog) });
  } catch (error) {
    console.error("Notice log load error", error);
    return NextResponse.json({ error: "Unable to load generated notices." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot log notices." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const tenantId = String(body.tenantId ?? "").trim();
  const formName = String(body.formName ?? "").trim();
  const renderedBody = String(body.renderedBody ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  if (!formName) return NextResponse.json({ error: "formName is required." }, { status: 400 });
  if (!renderedBody) return NextResponse.json({ error: "renderedBody is required." }, { status: 400 });
  if (renderedBody.length > 12000) {
    return NextResponse.json({ error: "The rendered notice must be 12,000 characters or fewer." }, { status: 400 });
  }
  try {
    const { data, error } = await authenticated.supabaseClient
      .from("rental_notice_log")
      .insert({
        owner_id: authenticated.effectiveOwnerId,
        tenant_id: tenantId,
        lease_id: body.leaseId ? String(body.leaseId).trim() : null,
        form_id: body.formId ? String(body.formId).trim() : null,
        form_name: formName,
        rendered_body: renderedBody,
        created_by: authenticated.user.id,
      })
      .select("id, tenant_id, lease_id, form_id, form_name, rendered_body, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, notice: rowToNoticeLog(data) }, { status: 201 });
  } catch (error) {
    console.error("Notice log error", error);
    return NextResponse.json({ error: "Unable to log the generated notice." }, { status: 500 });
  }
}
