import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { renderMessageTemplate } from "@/domains/rental-messaging/messageTemplates";
import { resolveLetterTemplateContext } from "@/domains/rental-mailing/letterContext";

export const runtime = "nodejs";

// Renders one mailing template against server-resolved merge fields for a
// single tenant — the composer preview. The composer never renders
// client-side, so the preview and the queued letters share this single
// server-side renderer. Readable by every workspace member: rendering
// changes nothing.
//
// Response: { success, subject, body, missingFields, unknownFields }.
// missingFields names catalog fields with no value (rendered as ""); the
// composer surfaces them so the sender can fix data before queueing.

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json().catch(() => ({}));
  if (!body.templateId || typeof body.templateId !== "string") {
    return NextResponse.json({ error: "A templateId is required." }, { status: 400 });
  }
  if (!body.tenantId || typeof body.tenantId !== "string") {
    return NextResponse.json({ error: "A tenantId is required." }, { status: 400 });
  }
  try {
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const { data: template, error } = await supabaseClient
      .from("rental_message_templates")
      .select("id, subject, body, kind")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", body.templateId)
      .maybeSingle();
    if (error) throw error;
    if (!template) return NextResponse.json({ error: "The letter template was not found." }, { status: 404 });
    if (template.kind !== "mailing") {
      return NextResponse.json({ error: "That template is not a mailing template." }, { status: 400 });
    }

    const { fields } = await resolveLetterTemplateContext({
      supabaseClient,
      ownerId: effectiveOwnerId,
      tenantId: body.tenantId,
    });
    if (body.returnAddress && String(body.returnAddress).trim()) {
      fields.owner_return_address = String(body.returnAddress).trim();
    }
    if (body.recipientAddress && String(body.recipientAddress).trim()) {
      fields.tenant_address = String(body.recipientAddress).trim();
    }

    const renderedBody = renderMessageTemplate(template.body, fields);
    const renderedSubject = template.subject ? renderMessageTemplate(template.subject, fields) : null;
    const missing = new Set([...renderedBody.missing, ...(renderedSubject?.missing || [])]);
    const unknown = new Set([...renderedBody.unknown, ...(renderedSubject?.unknown || [])]);
    return NextResponse.json({
      success: true,
      subject: renderedSubject ? renderedSubject.text : null,
      body: renderedBody.text,
      missingFields: [...missing],
      unknownFields: [...unknown],
    });
  } catch (error) {
    console.error("Mailing template render error", error);
    return NextResponse.json({ error: "Unable to render the letter template." }, { status: 500 });
  }
}
