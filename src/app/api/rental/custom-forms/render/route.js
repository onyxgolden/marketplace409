import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { renderNoticeTemplate } from "@/domains/rental-forms/formPlaceholders";
import { resolveNoticeContext } from "@/domains/rental-forms/noticeContext";

export const runtime = "nodejs";

// Rentec parity R15: render a notice/form against a real record.
//   POST { formId | body, tenantId, leaseId? } ->
//        { text, missing, unknown } — the rendered notice plus the
//        placeholders the context could not fill (missing) and the
//        placeholder paths the engine does not know (unknown).
// This is a read-only render (no persistence); every workspace member may
// render. Generated notices are persisted separately via /api/rental/notices.

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json().catch(() => ({}));
  const tenantId = String(body.tenantId ?? "").trim();
  const leaseId = body.leaseId ? String(body.leaseId).trim() : null;
  if (!tenantId) return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  try {
    let templateBody = body.body;
    if (body.formId) {
      const { data: form, error: formError } = await authenticated.supabaseClient
        .from("rental_custom_forms")
        .select("body")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("id", body.formId)
        .maybeSingle();
      if (formError) throw formError;
      if (!form) return NextResponse.json({ error: "Form was not found." }, { status: 404 });
      templateBody = form.body;
    }
    if (!String(templateBody ?? "").trim()) {
      return NextResponse.json({ error: "A form or body is required." }, { status: 400 });
    }
    const context = await resolveNoticeContext({
      supabaseClient: authenticated.supabaseClient,
      ownerId: authenticated.effectiveOwnerId,
      tenantId,
      leaseId,
    });
    const rendered = renderNoticeTemplate(templateBody, context);
    return NextResponse.json({
      success: true,
      text: rendered.text,
      missing: rendered.missing,
      unknown: rendered.unknown,
    });
  } catch (error) {
    console.error("Notice render error", error);
    return NextResponse.json({ error: "Unable to render the notice." }, { status: 500 });
  }
}
